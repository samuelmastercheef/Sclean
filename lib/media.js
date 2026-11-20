'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { walk, DAY } = require('./util');

const IMG = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.tif', '.tiff', '.webp', '.nef', '.cr2', '.cr3', '.arw', '.dng', '.raw'];
const VID = ['.mov', '.mp4', '.m4v', '.mkv', '.avi', '.webm', '.mts'];
const BIG_VIDEO = 100 * 1024 * 1024;

const SCREENSHOT = /^(Screenshot|Screen Shot|Ảnh chụp màn hình|Capture d.écran|Bildschirmfoto)/i;
const SCREENREC = /^(Screen Recording|Bản ghi màn hình|Recording|Enregistrement de l.écran|Bildschirmaufnahme)/i;

// Phân loại một file: trả về null nếu không phải ảnh/video
function classify(file, size, atime, mtime, now = Date.now()) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);
  const isImg = IMG.includes(ext);
  const isVid = VID.includes(ext);
  if (!isImg && !isVid) return null;
  const tags = [];
  if (isVid) {
    if (size >= BIG_VIDEO) tags.push('bigvideo');
    if (SCREENREC.test(name)) tags.push('screenrec');
  } else {
    if (SCREENSHOT.test(name)) tags.push('screenshot');
  }
  if (now - Math.max(atime, mtime) > 365 * DAY) tags.push('old');
  return { kind: isVid ? 'video' : (tags.includes('screenshot') ? 'screen' : 'photo'), tags };
}

// ---- dHash: 9x8 xám -> 64 bit (2 số 32 bit) ----
function dhashFromBGRA(buf, w = 9, h = 8) {
  const gray = [];
  for (let i = 0; i < w * h; i++) {
    const b = buf[i * 4], g = buf[i * 4 + 1], r = buf[i * 4 + 2];
    gray.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  let hi = 0, lo = 0, bit = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v = gray[y * w + x] < gray[y * w + x + 1] ? 1 : 0;
      if (bit < 32) hi = ((hi << 1) | v) >>> 0; else lo = ((lo << 1) | v) >>> 0;
      bit++;
    }
  }
  return { hi, lo };
}

function popcount32(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
const hamming = (a, b) => popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);

// items có thuộc tính hash {hi,lo}; trả về mảng nhóm (mỗi nhóm >= 2 phần tử)
function clusterSimilar(items, maxDist = 6) {
  const parent = items.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < items.length; i++) {
    if (!items[i].hash) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].hash) continue;
      if (hamming(items[i].hash, items[j].hash) <= maxDist) parent[find(j)] = find(i);
    }
  }
  const map = new Map();
  items.forEach((it, i) => { const r = find(i); (map.get(r) || map.set(r, []).get(r)).push(it); });
  return [...map.values()].filter((g) => g.length > 1);
}

// roots: thư mục cần quét. hashFn(path) -> {hi,lo}|null (do main cung cấp, dùng thumbnail của macOS)
async function scan(roots, opts = {}, onProgress = () => {}, isCancelled = () => false, hashFn = null) {
  const items = [];
  let n = 0;
  for (const root of roots) {
    for await (const file of walk(root, { isCancelled })) {
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      const c = classify(file, st.size, st.atimeMs, st.mtimeMs);
      if (!c) continue;
      if (st.size < (opts.minSize ?? 200 * 1024)) continue;
      n++;
      if (n % 100 === 0) onProgress({ scope: 'media', text: `Đã thấy ${n} ảnh/video...` });
      items.push({ path: file, name: path.basename(file), dir: path.dirname(file), size: st.size, mtime: st.mtimeMs,
        atime: st.atimeMs, kind: c.kind, tags: c.tags });
    }
  }
  if (isCancelled()) return { cancelled: true, items: [] };

  if (hashFn) {
    const photos = items.filter((i) => i.kind === 'photo' || i.kind === 'screen').slice(0, opts.maxHash ?? 3000);
    let done = 0;
    for (const p of photos) {
      if (isCancelled()) return { cancelled: true, items: [] };
      try { p.hash = await hashFn(p.path); } catch { /* bỏ qua */ }
      done++;
      if (done % 25 === 0) onProgress({ scope: 'media', text: `Đang so sánh ảnh ${done}/${photos.length}...` });
    }
    let gid = 0;
    for (const g of clusterSimilar(photos)) {
      gid++;
      g.sort((a, b) => b.size - a.size);
      g.forEach((it) => { it.tags.push('similar'); it.group = gid; });
    }
    photos.forEach((p) => { delete p.hash; });
  }
  items.sort((a, b) => b.size - a.size);
  return { cancelled: false, items };
}

module.exports = { scan, classify, dhashFromBGRA, clusterSimilar, hamming, BIG_VIDEO };
