'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const { spawn } = require('child_process');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const junk = require('./lib/junk');
const bigfiles = require('./lib/bigfiles');
const media = require('./lib/media');
const dupfiles = require('./lib/dupfiles');
const dupapps = require('./lib/dupapps');
const storage = require('./lib/storage');
const hidden = require('./lib/hidden');
const { protectedReason } = require('./lib/safety');
const { createHistory, createSettings } = require('./lib/history');

app.setName('S Clean');
app.setAboutPanelOptions({
  applicationName: 'S Clean',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 Socin.org',
});

let win;
const cancel = { big: false, media: false, dup: false, map: false };

// Chỉ cho phép thao tác trên những đường dẫn đã nằm trong kết quả quét gần nhất
const allowed = { junk: new Map(), big: new Map(), media: new Map(), dup: new Map(), app: new Map(), map: new Map(), hidden: new Map() };
let mountedDmgs = new Set();
let dupGroups = [];
let appGroups = [];

const fmt = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
};
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const isAllowed = (p) => Object.values(allowed).some((m) => m.has(p));
const home = os.homedir();

// Lịch sử dọn dẹp và cài đặt, lưu trong thư mục dữ liệu của app
let history, settings;
const DEFAULT_SETTINGS = { permanentDelete: false };
function initStore() {
  const dir = app.getPath('userData');
  history = createHistory(dir);
  settings = createSettings(dir, DEFAULT_SETTINGS);
}

// Chuyển 1 đường dẫn vào Thùng rác (hoặc xóa hẳn) sau khi kiểm tra danh sách cấm, rồi ghi lịch sử
async function removePath(p, size, how, source, log) {
  const why = protectedReason(p, home);
  if (why) throw new Error(why);
  // Quét "toàn ổ đĩa" trả đường dẫn dạng /System/Volumes/Data/Users/...: đổi về đường dẫn thường (firmlink)
  const real = p.replace(/^\/System\/Volumes\/Data(?=\/)/, '');
  if (how === 'delete') await fsp.rm(real, { recursive: true, force: true }); else await shell.trashItem(real);
  log.push({ action: how === 'delete' ? 'delete' : 'trash', path: p, size, source });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 940, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: '#F7F7F9',
    title: 'S Clean',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initStore();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());

async function confirm(message, detail, button, danger = true) {
  const r = await dialog.showMessageBox(win, {
    type: danger ? 'warning' : 'question', buttons: ['Huỷ', button], defaultId: 0, cancelId: 0, message, detail,
  });
  return r.response === 1;
}

// ---------- Chung ----------
ipcMain.handle('disk:info', async () => {
  try { const s = await fsp.statfs(home); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
});
ipcMain.handle('about', () => ({ name: 'S Clean', version: app.getVersion(), copyright: '© 2026 Socin.org' }));
ipcMain.handle('scan:cancel', (_e, scope) => { if (scope in cancel) cancel[scope] = true; });
ipcMain.handle('reveal', (_e, p) => { if (isAllowed(p)) shell.showItemInFolder(p.replace(/^\/System\/Volumes\/Data(?=\/)/, '')); });
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('roots:default', (_e, scope) => {
  const j = (...n) => n.map((d) => path.join(home, d));
  if (scope === 'big') return [home];
  if (scope === 'media') return j('Pictures', 'Movies', 'Desktop', 'Downloads', 'Documents');
  return j('Downloads', 'Documents', 'Desktop', 'Pictures', 'Movies', 'Music');
});

// Xem nhanh bằng Quick Look của macOS
ipcMain.handle('quicklook', (_e, p) => {
  if (!isAllowed(p)) return;
  const child = spawn('qlmanage', ['-p', p], { detached: true, stdio: 'ignore' });
  child.on('error', () => shell.openPath(p));
  child.unref();
});

// ---------- Thumbnail ----------
const thumbCache = new Map();
async function thumbFor(p, size) {
  const key = p + '|' + size;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = null;
  try {
    const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
    if (!img.isEmpty()) url = 'data:image/jpeg;base64,' + img.toJPEG(78).toString('base64');
  } catch { /* định dạng không hỗ trợ */ }
  thumbCache.set(key, url);
  if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value);
  return url;
}
ipcMain.handle('thumb:get', (_e, p, size) => (isAllowed(p) ? thumbFor(p, Math.min(Math.max(size || 160, 48), 900)) : null));

async function hashFile(p) {
  const img = await nativeImage.createThumbnailFromPath(p, { width: 64, height: 64 });
  if (img.isEmpty()) return null;
  return media.dhashFromBGRA(img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap());
}

// ---------- Dọn rác ----------
ipcMain.handle('junk:scan', async () => {
  const cats = await junk.scan(home, (p) => send('progress', p));
  allowed.junk.clear();
  for (const c of cats) for (const it of c.items) allowed.junk.set(it.path, { size: it.size, how: c.how, cat: c.id });
  return cats;
});

// Mặc định mọi thứ vào Thùng rác. Chỉ xóa hẳn khi: làm trống Thùng rác, hoặc người dùng bật "xóa hẳn cache" trong cài đặt.
const effectiveHow = (info, s) => (info.cat === 'trash' ? 'delete' : (info.how === 'delete' && s.permanentDelete ? 'delete' : 'trash'));

ipcMain.handle('junk:clean', async (_e, paths) => {
  const list = paths.filter((p) => allowed.junk.has(p) && !protectedReason(p, home));
  if (!list.length) return { cancelled: true };
  const s = await settings.get();
  const total = list.reduce((sum, p) => sum + allowed.junk.get(p).size, 0);
  const perm = list.filter((p) => effectiveHow(allowed.junk.get(p), s) === 'delete');
  const emptyTrash = perm.some((p) => allowed.junk.get(p).cat === 'trash');
  const detail = perm.length
    ? `${perm.length} mục bị xóa hẳn${emptyTrash ? ' (gồm làm trống Thùng rác, không khôi phục được)' : ''}. ${list.length - perm.length} mục chuyển vào Thùng rác.`
    : 'Tất cả chuyển vào Thùng rác, khôi phục được. Làm trống Thùng rác để thực sự giải phóng ổ đĩa.';
  const ok = await confirm(`Dọn ${list.length} mục (${fmt(total)})?`, detail, 'Dọn dẹp');
  if (!ok) return { cancelled: true };
  let freed = 0, failed = 0; const log = [];
  for (const p of list) {
    const info = allowed.junk.get(p);
    try { await removePath(p, info.size, effectiveHow(info, s), 'Dọn rác', log); freed += info.size; allowed.junk.delete(p); } catch { failed++; }
  }
  await history.add(log).catch(() => {});
  return { cancelled: false, freed, failed };
});

// ---------- File lớn và cũ ----------
ipcMain.handle('big:scan', async (_e, roots, opts) => {
  cancel.big = false;
  const res = await bigfiles.scan(roots, opts, (p) => send('progress', p), () => cancel.big);
  allowed.big.clear();
  for (const it of res.items) allowed.big.set(it.path, { size: it.size });
  return res;
});

// ---------- Ảnh và video ----------
ipcMain.handle('media:scan', async (_e, roots) => {
  cancel.media = false;
  const res = await media.scan(roots, {}, (p) => send('progress', p), () => cancel.media, hashFile);
  allowed.media.clear();
  for (const it of res.items) allowed.media.set(it.path, { size: it.size });
  return res;
});

// ---------- File trùng ----------
ipcMain.handle('dup:scan', async (_e, roots, minSizeMB) => {
  cancel.dup = false;
  const res = await dupfiles.scan(roots, { minSize: Math.max(0, minSizeMB) * 1024 * 1024 },
    (p) => send('progress', { scope: 'dup', text: p.text }), () => cancel.dup);
  dupGroups = res.groups;
  allowed.dup.clear();
  for (const g of dupGroups) for (const f of g.files) allowed.dup.set(f.path, { size: g.size });
  return res;
});

// ---------- Ứng dụng trùng ----------
ipcMain.handle('app:scan', async () => {
  send('progress', { scope: 'app', text: 'Đang quét ứng dụng...' });
  appGroups = await dupapps.scan();
  allowed.app.clear();
  for (const g of appGroups) for (const a of g.apps) allowed.app.set(a.path, { size: a.size });
  return appGroups;
});

// ---------- Chuyển vào Thùng rác (big, media, dup, app) ----------
ipcMain.handle('items:trash', async (_e, kind, paths) => {
  const map = allowed[kind];
  if (!map || kind === 'junk') return { error: 'Loại không hợp lệ' };
  const set = new Set(paths);
  for (const p of set) if (!map.has(p)) return { error: 'Đường dẫn không nằm trong kết quả quét: ' + p };
  if (!set.size) return { cancelled: true };
  const groups = kind === 'dup' ? dupGroups.map((g) => g.files.map((f) => f.path))
    : kind === 'app' ? appGroups.map((g) => g.apps.map((a) => a.path)) : [];
  for (const g of groups) {
    if (g.every((p) => set.has(p))) return { error: 'Không thể xóa hết mọi bản trong một nhóm. Hãy giữ lại ít nhất một bản.' };
  }
  const size = [...set].reduce((s, p) => s + map.get(p).size, 0);
  for (const p of set) { const why = protectedReason(p, home); if (why) return { error: `${path.basename(p)}: ${why}` }; }
  const label = { big: 'file', media: 'ảnh/video', dup: 'file trùng', app: 'ứng dụng', map: 'mục', hidden: 'mục' }[kind];
  const ok = await confirm(`Chuyển ${set.size} ${label} vào Thùng rác?`,
    `Giải phóng khoảng ${fmt(size)}. Bạn vẫn khôi phục được từ Thùng rác.` +
    (kind === 'app' ? '\nHãy thoát các ứng dụng này trước khi gỡ.' : ''), 'Chuyển vào Thùng rác');
  if (!ok) return { cancelled: true };
  let done = 0, freed = 0; const failed = []; const log = [];
  const source = { big: 'File lớn', media: 'Ảnh và video', dup: 'File trùng', app: 'Ứng dụng trùng', map: 'Bản đồ dung lượng', hidden: 'Dung lượng ẩn' }[kind];
  for (const p of set) {
    try { await removePath(p, map.get(p).size, 'trash', source, log); done++; freed += map.get(p).size; map.delete(p); }
    catch { failed.push(path.basename(p)); }
  }
  await history.add(log).catch(() => {});
  return { cancelled: false, done, freed, failed };
});

// ---------- Bản đồ dung lượng ----------
ipcMain.handle('map:scan', async (_e, scope, custom) => {
  cancel.map = false;
  const root = scope === 'disk' ? await storage.wholeDiskRoot() : scope === 'custom' && typeof custom === 'string' ? custom : home;
  const t0 = Date.now();
  const res = await storage.measure(root, { home }, (p) => send('progress', { scope: 'map', text: `Đã đo ${p.files.toLocaleString('vi-VN')} file · ${fmt(p.bytes)}` }), () => cancel.map);
  allowed.map.clear();
  storage.forEachNode(res.root, (n) => { if (n.path !== root) allowed.map.set(n.path, { size: n.size }); });
  let disk = null;
  try { const s = await fsp.statfs(home); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* bỏ qua */ }
  return { ...res, scope, rootPath: root, home, disk, ms: Date.now() - t0 };
});

// ---------- Dung lượng ẩn ----------
ipcMain.handle('hidden:scan', async () => {
  const res = await hidden.scan(home, (p) => send('progress', p));
  allowed.hidden.clear();
  for (const it of res.items) {
    for (const p of it.parts) allowed.hidden.set(p.path, { size: p.size });
    for (const t of it.top) allowed.hidden.set(t.path, { size: t.size });
    for (const v of it.vms) allowed.hidden.set(v.path, { size: v.size });
  }
  mountedDmgs = new Set(res.system.mounted.flatMap((m) => m.mounts));
  for (const m of res.system.mounted) allowed.hidden.set(m.image, { size: m.size });
  return res;
});

// Tháo (eject) ổ DMG đang mount: không xóa gì, file .dmg vẫn còn
ipcMain.handle('dmg:eject', async (_e, mount) => {
  if (!mountedDmgs.has(mount)) return { error: 'Ổ này không nằm trong kết quả quét' };
  return new Promise((resolve) => {
    spawn('hdiutil', ['detach', mount], { stdio: 'ignore' }).on('exit', async (code) => {
      if (code === 0) { mountedDmgs.delete(mount); await history.add([{ action: 'eject', path: mount, size: 0, source: 'Dung lượng ẩn' }]).catch(() => {}); }
      resolve(code === 0 ? { ok: true } : { error: 'Không tháo được, có thể đang có app dùng ổ này' });
    }).on('error', () => resolve({ error: 'Không chạy được hdiutil' }));
  });
});

// ---------- Tiện ích ----------
ipcMain.handle('clipboard:copy', (_e, text) => { if (typeof text === 'string' && text.length < 4096) clipboard.writeText(text); });
const SETTINGS_URL = {
  fda: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  storage: 'x-apple.systempreferences:com.apple.settings.Storage',
  update: 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension',
};
ipcMain.handle('open:settings', (_e, which) => { if (SETTINGS_URL[which]) shell.openExternal(SETTINGS_URL[which]); });
ipcMain.handle('open:trash', () => shell.openPath(path.join(home, '.Trash')));
ipcMain.handle('history:list', () => history.list(500));
ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (_e, patch) => settings.set(patch || {}));
