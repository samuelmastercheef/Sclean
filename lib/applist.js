'use strict';
// Quản lý ứng dụng: liệt kê mọi app, cho biết app nào của hệ thống, lâu chưa dùng, chiếm bao nhiêu
// (cả app lẫn dữ liệu đi kèm trong ~/Library), để người dùng gỡ bớt một cách an toàn.
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { sizeOf, mapLimit } = require('./util');
const { findApps, readPlist } = require('./dupapps');

const DAY = 86400000;

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
const exists = async (p) => { try { await fsp.lstat(p); return true; } catch { return false; } };

// Ứng dụng của Apple đi kèm macOS dù nằm trong /Applications (được SIP bảo vệ, không gỡ được)
const BUILTIN_IN_APPS = new Set(['com.apple.Safari']);

// 'system': app của macOS, không gỡ được (nằm trong /System hoặc là Safari)
// 'apple' : app của Apple cài thêm (iMovie, GarageBand, Pages, Xcode...), gỡ được, tải lại từ App Store
// 'user'  : app bên thứ ba
function classify(appPath, bundleId) {
  const p = appPath.replace(/^\/System\/Volumes\/Data(?=\/)/, '');
  if (p.startsWith('/System/')) return 'system';
  const bid = bundleId || '';
  if (BUILTIN_IN_APPS.has(bid)) return 'system';
  if (/^\/Applications\/Utilities\//.test(p) && bid.startsWith('com.apple.')) return 'system';
  if (bid.startsWith('com.apple.')) return 'apple';
  return 'user';
}

// Đầu ra của `mdls -name kMDItemLastUsedDate -name kMDItemUseCount <app>`
function parseMdls(out) {
  const res = { lastUsed: null, useCount: null };
  if (!out) return res;
  const d = out.match(/kMDItemLastUsedDate\s*=\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})/);
  if (d) {
    const t = Date.parse(`${d[1]}T${d[2]}${d[3].slice(0, 3)}:${d[3].slice(3)}`);
    if (!Number.isNaN(t)) res.lastUsed = t;
  }
  const c = out.match(/kMDItemUseCount\s*=\s*(\d+)/);
  if (c) res.useCount = Number(c[1]);
  return res;
}

// Dữ liệu đi kèm của app trong ~/Library, chỉ lấy đúng theo Bundle ID (hoặc đúng tên app),
// không đụng Group Containers vì thường dùng chung giữa nhiều app.
function relatedPaths(home, bundleId, name) {
  const L = (...p) => path.join(home, 'Library', ...p);
  const out = [];
  if (bundleId && /^[A-Za-z0-9.-]+$/.test(bundleId) && bundleId.split('.').length >= 2) {
    out.push(L('Containers', bundleId), L('Caches', bundleId), L('Application Support', bundleId), L('HTTPStorages', bundleId),
      L('WebKit', bundleId), L('Preferences', bundleId + '.plist'), L('Saved Application State', bundleId + '.savedState'),
      L('Logs', bundleId), L('Application Scripts', bundleId));
  }
  // Thư mục đặt theo tên app (Notion, Slack, Zoom...): chỉ khi tên đủ đặc trưng
  if (name && name.length >= 3 && !/[/\\]|^\.|^(Apple|Google|Microsoft|Adobe|com\.apple)$/i.test(name)) {
    out.push(L('Application Support', name), L('Caches', name), L('Logs', name));
  }
  return [...new Set(out)];
}

async function runningPaths() {
  const out = await run('ps', ['-axo', 'comm=']);
  return out || '';
}

/**
 * Quét ứng dụng. Trả về [{ path, name, bundleId, version, kind, size, dataSize, data: [{path,size}],
 *   lastUsed, useCount, appStore, running, mtime }]
 * opts.roots: thư mục để tìm (mặc định /Applications, ~/Applications, /System/Applications)
 */
async function scan(home = os.homedir(), onProgress = () => {}, opts = {}) {
  const roots = opts.roots || ['/Applications', path.join(home, 'Applications'), '/System/Applications'];
  const sysRoots = opts.systemRoots || ['/System/Applications'];
  const files = await findApps(roots, 2);
  const procs = opts.procs != null ? opts.procs : await runningPaths();
  let done = 0;
  const apps = await mapLimit(files, 6, async (p) => {
    const info = (await readPlist(path.join(p, 'Contents', 'Info.plist'))) || {};
    const bid = info.CFBundleIdentifier || null;
    const name = info.CFBundleDisplayName || info.CFBundleName || path.basename(p, '.app');
    const kind = sysRoots.some((r) => p.startsWith(r + '/')) ? 'system' : classify(p, bid);
    let mtime = 0;
    try { mtime = (await fsp.stat(p)).mtimeMs; } catch { /* bỏ qua */ }
    const md = opts.mdls ? opts.mdls(p) : parseMdls(await run('mdls', ['-name', 'kMDItemLastUsedDate', '-name', 'kMDItemUseCount', p]));
    const size = await sizeOf(p);
    const data = [];
    if (kind === 'user') { // dữ liệu app của Apple nằm trong vùng được bảo vệ, để Apple tự quản lý
      for (const d of relatedPaths(home, bid, path.basename(p, '.app'))) {
        if (await exists(d)) { const s = await sizeOf(d); if (s > 0) data.push({ path: d, size: s }); }
      }
    }
    done++;
    if (done % 10 === 0) onProgress({ scope: 'applist', text: `Đã đọc ${done}/${files.length} ứng dụng...` });
    return {
      path: p, name, bundleId: bid, version: info.CFBundleShortVersionString || info.CFBundleVersion || '',
      kind, size, data, dataSize: data.reduce((s, x) => s + x.size, 0),
      lastUsed: md.lastUsed, useCount: md.useCount, mtime,
      appStore: await exists(path.join(p, 'Contents', '_MASReceipt')),
      running: procs.includes(p + '/'),
    };
  });
  // Một thư mục dữ liệu chỉ thuộc về một app (tránh gỡ app này kéo theo dữ liệu app khác)
  const owners = new Map();
  for (const a of apps) for (const d of a.data) owners.set(d.path, (owners.get(d.path) || 0) + 1);
  for (const a of apps) {
    a.data = a.data.filter((d) => owners.get(d.path) === 1);
    a.dataSize = a.data.reduce((s, x) => s + x.size, 0);
  }
  return apps.sort((a, b) => (b.size + b.dataSize) - (a.size + a.dataSize));
}

// Nhãn "lâu chưa dùng": không mở trong N ngày (Spotlight), hoặc chưa từng mở và đã cài lâu
function isStale(app, days = 180, now = Date.now()) {
  if (app.kind === 'system') return false;
  if (app.lastUsed) return now - app.lastUsed > days * DAY;
  return app.mtime ? now - app.mtime > days * DAY : false;
}

module.exports = { scan, classify, parseMdls, relatedPaths, isStale };
