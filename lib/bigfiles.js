'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { walk, mapLimit, DAY } = require('./util');

const EXT = {
  video: ['.mov', '.mp4', '.m4v', '.mkv', '.avi', '.webm', '.wmv', '.flv', '.mts', '.mxf'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.xz', '.bz2', '.zst'],
  disk: ['.dmg', '.iso', '.pkg', '.img'],
  doc: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.json', '.key', '.pages', '.numbers'],
  image: ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.tif', '.tiff', '.webp', '.raw', '.nef', '.cr2', '.cr3', '.arw', '.dng', '.psd'],
  audio: ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a'],
};

function kindOf(file) {
  const e = path.extname(file).toLowerCase();
  for (const [k, list] of Object.entries(EXT)) if (list.includes(e)) return k;
  return 'other';
}

// Ngày mở lần cuối theo Spotlight (macOS); nếu không có thì dùng atime
function lastUsed(file, fallbackMs) {
  return new Promise((resolve) => {
    execFile('mdls', ['-name', 'kMDItemLastUsedDate', '-raw', file], { timeout: 4000 }, (err, out) => {
      if (!err && out && !out.includes('(null)')) {
        const d = Date.parse(out.trim().replace(' +0000', 'Z').replace(' ', 'T'));
        if (!Number.isNaN(d)) return resolve(d);
      }
      resolve(fallbackMs);
    });
  });
}

// opts: { minSize (bytes), olderThanDays, limit }
async function scan(roots, opts = {}, onProgress = () => {}, isCancelled = () => false) {
  const minSize = opts.minSize ?? 100 * 1024 * 1024;
  const items = [];
  let seen = 0;
  for (const root of roots) {
    for await (const file of walk(root, { isCancelled })) {
      seen++;
      if (seen % 500 === 0) onProgress({ scope: 'big', text: `Đã duyệt ${seen} file...` });
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      if (st.size < minSize) continue;
      items.push({ path: file, name: path.basename(file), dir: path.dirname(file), size: st.size, mtime: st.mtimeMs,
        atime: st.atimeMs, kind: kindOf(file) });
    }
  }
  if (isCancelled()) return { cancelled: true, items: [] };
  items.sort((a, b) => b.size - a.size);
  const top = items.slice(0, opts.limit ?? 400);
  await mapLimit(top, 8, async (it) => { it.lastUsed = await lastUsed(it.path, Math.max(it.atime, it.mtime)); });
  let out = top;
  if (opts.olderThanDays) out = top.filter((i) => Date.now() - i.lastUsed > opts.olderThanDays * DAY);
  return { cancelled: false, items: out };
}

module.exports = { scan, kindOf, EXT };
