'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const junk = require('./lib/junk');
const bigfiles = require('./lib/bigfiles');
const media = require('./lib/media');
const dupfiles = require('./lib/dupfiles');
const dupapps = require('./lib/dupapps');
const storage = require('./lib/storage');

app.setName('S Clean');
app.setAboutPanelOptions({
  applicationName: 'S Clean',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 Socin.org',
});

let win;
const cancel = { big: false, media: false, dup: false };

// Chỉ cho phép thao tác trên những đường dẫn đã nằm trong kết quả quét gần nhất
const allowed = { junk: new Map(), big: new Map(), media: new Map(), dup: new Map(), app: new Map(), storage: new Map() };
const allowedMounts = new Set();
const allowedRuntimes = new Map();
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
const run = (cmd, args, timeout = 60000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }));
});

// Ứng dụng đang chạy (đường dẫn file thực thi), để không xóa cache của app đang mở
async function runningApps() {
  const r = await run('ps', ['-axo', 'comm=']);
  return r.out.toLowerCase();
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
ipcMain.handle('reveal', (_e, p) => { if (isAllowed(p)) shell.showItemInFolder(p); });
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

ipcMain.handle('junk:clean', async (_e, paths) => {
  const list = paths.filter((p) => allowed.junk.has(p));
  if (!list.length) return { cancelled: true };
  const total = list.reduce((s, p) => s + allowed.junk.get(p).size, 0);
  const perm = list.filter((p) => allowed.junk.get(p).how === 'delete').length;
  const ok = await confirm(`Dọn ${list.length} mục (${fmt(total)})?`,
    `${perm} mục bị xóa hẳn (cache, log, node_modules, Thùng rác). ${list.length - perm} mục chuyển vào Thùng rác.` +
    (list.some((p) => allowed.junk.get(p).cat === 'appcache') ? '\nCache của trình duyệt và ứng dụng đang mở sẽ được bỏ qua: hãy thoát chúng trước nếu muốn dọn.' : ''), 'Dọn dẹp');
  if (!ok) return { cancelled: true };
  let freed = 0, failed = 0;
  const busy = new Set();
  const procs = list.some((p) => allowed.junk.get(p).cat === 'appcache') ? await runningApps() : '';
  for (const p of list) {
    const info = allowed.junk.get(p);
    if (info.cat === 'appcache') {
      const owner = junk.cacheOwner(p, home);
      if (owner && procs.includes('/' + owner.toLowerCase() + '.app/')) { busy.add(owner); continue; }
    }
    try {
      if (info.how === 'trash') await shell.trashItem(p); else await fsp.rm(p, { recursive: true, force: true });
      freed += info.size; allowed.junk.delete(p);
    } catch { failed++; }
  }
  return { cancelled: false, freed, failed, busy: [...busy] };
});

// ---------- Dung lượng ẩn ----------
ipcMain.handle('storage:scan', async () => {
  const res = await storage.scan(home, (p) => send('progress', p));
  allowed.storage.clear(); allowedMounts.clear(); allowedRuntimes.clear();
  for (const h of res.hidden) allowed.storage.set(h.path, { size: h.size });
  for (const a of res.protected) allowed.storage.set(a.path, { size: a.size || 0 });
  for (const i of res.images) {
    for (const m of i.mounts) allowedMounts.add(m);
    if (i.image) allowed.storage.set(i.image, { size: i.size });
  }
  for (const r of res.runtimes) if (r.deletable) allowedRuntimes.set(r.id, r);
  return res;
});

// Tháo ổ DMG đang gắn. Không xóa gì, file .dmg vẫn còn nguyên.
ipcMain.handle('storage:eject', async (_e, mounts) => {
  const list = (mounts || []).filter((m) => allowedMounts.has(m));
  let done = 0; const failed = [];
  for (const m of list) {
    const r = await run('hdiutil', ['detach', m]);
    if (r.ok) { done++; allowedMounts.delete(m); } else failed.push(path.basename(m));
  }
  return { done, failed };
});

// Xóa runtime iOS Simulator (tải lại được trong Xcode › Settings › Components)
ipcMain.handle('storage:deleteRuntime', async (_e, id) => {
  const rt = allowedRuntimes.get(id);
  if (!rt) return { error: 'Runtime không nằm trong kết quả quét' };
  const ok = await confirm(`Xóa ${rt.platform} ${rt.version} (${rt.build})?`,
    `Giải phóng khoảng ${fmt(rt.size)}. Xóa hẳn, không vào Thùng rác. Có thể tải lại trong Xcode › Settings › Components.` +
    (rt.lastUsed ? `\nLần dùng gần nhất: ${new Date(rt.lastUsed).toLocaleDateString('vi-VN')}.` : ''), 'Xóa runtime');
  if (!ok) return { cancelled: true };
  const r = await run('xcrun', ['simctl', 'runtime', 'delete', id], 300000);
  if (!r.ok) return { error: r.err.trim().split('\n').pop() || 'Không xóa được' };
  allowedRuntimes.delete(id);
  return { freed: rt.size };
});

// Mở đúng trang trong Cài đặt hệ thống (URL cố định)
const SETTINGS_URL = {
  fda: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  storage: 'x-apple.systempreferences:com.apple.settings.Storage',
  update: 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension',
};
ipcMain.handle('open:settings', (_e, key) => { if (SETTINGS_URL[key]) shell.openExternal(SETTINGS_URL[key]); });

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
  const label = { big: 'file', media: 'ảnh/video', dup: 'file trùng', app: 'ứng dụng' }[kind];
  const ok = await confirm(`Chuyển ${set.size} ${label} vào Thùng rác?`,
    `Giải phóng khoảng ${fmt(size)}. Bạn vẫn khôi phục được từ Thùng rác.` +
    (kind === 'app' ? '\nHãy thoát các ứng dụng này trước khi gỡ.' : ''), 'Chuyển vào Thùng rác');
  if (!ok) return { cancelled: true };
  let done = 0, freed = 0; const failed = [];
  for (const p of set) {
    try { await shell.trashItem(p); done++; freed += map.get(p).size; map.delete(p); }
    catch { failed.push(path.basename(p)); }
  }
  return { cancelled: false, done, freed, failed };
});
