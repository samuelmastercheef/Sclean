'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { walk: baseWalk } = require('./util');

function walk(root, isCancelled) { return baseWalk(root, { isCancelled }); }

async function partialHash(file, size) {
  const CH = 64 * 1024;
  const fh = await fsp.open(file, 'r');
  try {
    const h = crypto.createHash('sha1');
    const buf = Buffer.alloc(Math.min(CH, size));
    let r = await fh.read(buf, 0, buf.length, 0);
    h.update(buf.subarray(0, r.bytesRead));
    if (size > CH) {
      r = await fh.read(buf, 0, buf.length, Math.max(0, size - buf.length));
      h.update(buf.subarray(0, r.bytesRead));
    }
    return h.digest('hex');
  } finally { await fh.close(); }
}

function fullHash(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// roots: mảng thư mục; opts.minSize bytes; onProgress({stage, text, done, total}); isCancelled()
async function scan(roots, opts = {}, onProgress = () => {}, isCancelled = () => false) {
  const minSize = opts.minSize ?? 1024 * 1024;
  const bySize = new Map();
  const seenInode = new Set();
  let count = 0;

  onProgress({ stage: 'walk', text: 'Đang liệt kê file...', done: 0 });
  for (const root of roots) {
    for await (const file of walk(root, isCancelled)) {
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      if (st.size < minSize) continue;
      const key = st.dev + ':' + st.ino;
      if (seenInode.has(key)) continue; // hardlink / đã gặp
      seenInode.add(key);
      count++;
      if (count % 200 === 0) onProgress({ stage: 'walk', text: `Đã thấy ${count} file...`, done: count });
      const arr = bySize.get(st.size) || [];
      arr.push({ path: file, size: st.size, mtime: st.mtimeMs });
      bySize.set(st.size, arr);
    }
  }
  if (isCancelled()) return { cancelled: true, groups: [] };

  const sameSize = [...bySize.values()].filter((a) => a.length > 1);
  const total = sameSize.reduce((s, a) => s + a.length, 0);
  let done = 0;
  const groups = [];

  for (const arr of sameSize) {
    if (isCancelled()) return { cancelled: true, groups: [] };
    // vòng 1: hash đầu + cuối
    const byPartial = new Map();
    for (const f of arr) {
      try {
        const ph = await partialHash(f.path, f.size);
        (byPartial.get(ph) || byPartial.set(ph, []).get(ph)).push(f);
      } catch { /* bỏ qua file đọc lỗi */ }
    }
    // vòng 2: hash toàn bộ
    for (const cand of byPartial.values()) {
      if (cand.length < 2) { done += cand.length; continue; }
      const byFull = new Map();
      for (const f of cand) {
        if (isCancelled()) return { cancelled: true, groups: [] };
        try {
          const fh = await fullHash(f.path);
          (byFull.get(fh) || byFull.set(fh, []).get(fh)).push(f);
        } catch { /* bỏ qua */ }
        done++;
        if (done % 5 === 0) onProgress({ stage: 'hash', text: `Đang so sánh nội dung ${done}/${total}`, done, total });
      }
      for (const [hash, files] of byFull) {
        if (files.length > 1) {
          files.sort((a, b) => a.mtime - b.mtime);
          groups.push({ hash, size: files[0].size, files });
        }
      }
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return { cancelled: false, groups };
}

module.exports = { scan };
