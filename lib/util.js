'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Thư mục dạng "gói" của macOS: không đi vào bên trong
const PKG_EXT = ['.app', '.photoslibrary', '.imovielibrary', '.fcpbundle', '.bundle', '.framework', '.sparsebundle',
  '.xcodeproj', '.xcworkspace', '.lproj', '.musiclibrary', '.tvlibrary', '.vmwarevm', '.pvm', '.xcarchive', '.playground', '.rtfd'];
const SKIP_NAMES = new Set(['node_modules', 'Library', '.git', '.Trash', 'venv', '.venv', '__pycache__', 'Pods',
  'DerivedData', 'Applications', 'Pods', '.build']);

// Tổng dung lượng thực tế (bytes) của file/thư mục. Không đi theo symlink.
async function sizeOf(p) {
  let st;
  try { st = await fsp.lstat(p); } catch { return 0; }
  // Dung lượng thật trên ổ: file chỉ lưu trên mây (iCloud, Google Drive) có blocks = 0
  if (!st.isDirectory()) return typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
  let total = 0;
  let dir;
  try { dir = await fsp.opendir(p); } catch { return 0; }
  // Lỗi giữa chừng (ví dụ ETIMEDOUT trên thư mục Google Drive/iCloud) không được làm hỏng cả lần quét
  try { for await (const ent of dir) total += await sizeOf(path.join(p, ent.name)); } catch { /* giữ phần đã đếm */ }
  return total;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Duyệt cây thư mục, trả về đường dẫn file thường (bỏ file ẩn, symlink, gói, thư mục rác)
async function* walk(root, opts = {}, depth = 0) {
  const { isCancelled = () => false, maxDepth = Infinity } = opts;
  let ents;
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (isCancelled()) return;
    if (ent.name.startsWith('.')) continue;
    const full = path.join(root, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (depth + 1 > maxDepth) continue;
      if (SKIP_NAMES.has(ent.name)) continue;
      if (PKG_EXT.includes(path.extname(ent.name).toLowerCase())) continue;
      yield* walk(full, opts, depth + 1);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

const DAY = 86400000;

module.exports = { sizeOf, mapLimit, walk, PKG_EXT, SKIP_NAMES, DAY };
