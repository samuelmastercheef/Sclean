'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PKG_EXT, mapLimit } = require('./util');

// Bản đồ dung lượng: đo MỌI thứ dưới một thư mục, kể cả file ẩn, ~/Library và bên trong các gói,
// để lộ ra những chỗ chiếm dung lượng mà Finder không hiển thị.

const PKG = new Set([...PKG_EXT, '.photoslibrary', '.pvm', '.utm', '.vmwarevm', '.sparseimage', '.dmg', '.logicx', '.band',
  '.aplibrary', '.lrlibrary', '.lrdata', '.kext', '.plugin', '.appex', '.xpc', '.docarchive']);

// Lý do Finder không hiển thị (hoặc chỉ hiện như 1 file):
//   dot      tên bắt đầu bằng dấu chấm
//   library  nằm trong ~/Library (Finder ẩn mặc định)
//   package  nằm bên trong một gói (.app, .photoslibrary, máy ảo...) mà Finder hiện như 1 file
//   system   thư mục hệ thống ngoài thư mục nhà (/private, /Library...)
function whyHidden(name, parentPath, parentWhy, home) {
  if (parentWhy) return parentWhy;
  if (name.startsWith('.')) return 'dot';
  const full = path.join(parentPath, name);
  const H = home.replace(/\/+$/, '');
  const norm = full.replace(/^\/System\/Volumes\/Data(?=\/)/, '');
  if (norm === path.join(H, 'Library')) return 'library';
  if (/^\/(private|cores|opt|usr|sw)(\/|$)/.test(norm)) return 'system';
  return null;
}

function isPackage(name) { return PKG.has(path.extname(name).toLowerCase()); }

// Giới hạn số thao tác hệ thống file chạy cùng lúc
function semaphore(n) {
  let active = 0; const q = [];
  const next = () => { if (active < n && q.length) { active++; q.shift()(); } };
  return async (fn) => {
    await new Promise((r) => { q.push(r); next(); });
    try { return await fn(); } finally { active--; next(); }
  };
}

/**
 * Đo dung lượng cây thư mục.
 * opts: { home, keepMin (bytes, mặc định 25 MB), keepTop (số con giữ lại mỗi thư mục nông), skip: [đường dẫn bỏ qua] }
 * Trả về { root, files, denied: [path], cancelled }
 * node: { name, path, size, files, dir, why, pkg, denied, mtime, children: [node], other: {size, count} }
 */
async function measure(rootPath, opts = {}, onProgress = () => {}, isCancelled = () => false) {
  const home = opts.home || require('os').homedir();
  const keepMin = opts.keepMin ?? 25 * 1024 * 1024;
  const keepTop = opts.keepTop ?? 60;
  const skip = new Set(opts.skip || []);
  const sem = semaphore(48);
  const seenIno = new Set();
  const denied = [];
  let files = 0; let bytes = 0; let lastTick = 0;

  let rootSt;
  try { rootSt = await fsp.lstat(rootPath); } catch (e) { return { root: null, files: 0, denied: [rootPath], cancelled: false, error: e.code }; }
  const rootDev = rootSt.dev;

  const tick = (dir) => {
    if (files - lastTick >= 2500) { lastTick = files; onProgress({ files, bytes, dir }); }
  };

  async function visit(dirPath, name, depth, why, insidePkg, mtime) {
    const node = { name, path: dirPath, size: 0, files: 0, dir: true, why, pkg: isPackage(name), mtime, children: [], other: { size: 0, count: 0 } };
    if (isCancelled()) return node;
    let ents;
    try { ents = await sem(() => fsp.readdir(dirPath, { withFileTypes: true })); } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') { node.denied = true; denied.push(dirPath); }
      return node;
    }
    const childWhy = why || (node.pkg ? 'package' : null);
    const kids = [];
    const subdirs = [];
    await mapLimit(ents, 16, async (ent) => {
      if (isCancelled()) return;
      const full = path.join(dirPath, ent.name);
      if (skip.has(full) || ent.isSymbolicLink()) return;
      let st;
      try { st = await sem(() => fsp.lstat(full)); } catch { return; }
      if (st.dev !== rootDev) return; // ổ khác, ổ mạng, ổ DMG đang mount
      const w = whyHidden(ent.name, dirPath, childWhy, home);
      if (st.isDirectory()) { subdirs.push({ full, name: ent.name, w, mtime: st.mtimeMs }); return; }
      if (!st.isFile()) return;
      if (st.nlink > 1) { const k = st.ino; if (seenIno.has(k)) return; seenIno.add(k); }
      const size = st.blocks ? st.blocks * 512 : st.size;
      files++; bytes += size; tick(dirPath);
      kids.push({ name: ent.name, path: full, size, files: 1, dir: false, why: w, mtime: st.mtimeMs });
    });
    const subs = await mapLimit(subdirs, 4, (d) => visit(d.full, d.name, depth + 1, d.w, insidePkg || node.pkg, d.mtime));
    kids.push(...subs);
    for (const k of kids) { node.size += k.size; node.files += k.files; if (k.denied || k.hasDenied) node.hasDenied = true; }
    kids.sort((a, b) => b.size - a.size);
    // Chỉ giữ chi tiết các mục đáng kể để không tốn bộ nhớ
    const min = depth <= 1 ? 0 : keepMin;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const keep = (k.size >= min && i < keepTop) || k.size >= keepMin || k.denied || (depth <= 1 && k.hasDenied);
      if (keep) node.children.push(k); else { node.other.size += k.size; node.other.count++; }
    }
    if (!node.children.length && !node.other.count) delete node.other;
    return node;
  }

  const root = await visit(rootPath, path.basename(rootPath) || rootPath, 0,
    whyHidden(path.basename(rootPath), path.dirname(rootPath), null, home), false, rootSt.mtimeMs);
  return { root, files, denied, cancelled: isCancelled() };
}

// Duyệt mọi node (để đưa vào danh sách được phép thao tác)
function forEachNode(node, fn) {
  if (!node) return;
  fn(node);
  for (const c of node.children || []) forEachNode(c, fn);
}

// Thư mục gốc khi quét "toàn ổ đĩa": volume Data của APFS (chứa Users, Applications, Library, private)
async function wholeDiskRoot() {
  try { await fsp.access('/System/Volumes/Data/Users'); return '/System/Volumes/Data'; } catch { return '/'; }
}

module.exports = { measure, forEachNode, whyHidden, isPackage, wholeDiskRoot, semaphore };
