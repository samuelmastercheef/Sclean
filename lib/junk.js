'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { sizeOf, mapLimit, DAY } = require('./util');
const dupapps = require('./dupapps');

const REVERSE_DNS = /^[A-Za-z0-9-]{2,}\.[A-Za-z0-9-]+\.[A-Za-z0-9._-]+$/;

async function children(dir, o = {}) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    const n = e.name;
    if (n === '.DS_Store' || n === '.localized') continue;
    if (o.skipPrefix && o.skipPrefix.some((p) => n.startsWith(p))) continue;
    if (o.skipNames && o.skipNames.includes(n)) continue;
    if (o.ext && (!e.isFile() || !o.ext.includes(path.extname(n).toLowerCase()))) continue;
    if (o.match && !o.match.test(n)) continue;
    const full = path.join(dir, n);
    if (o.olderThanDays) {
      try { if (Date.now() - (await fsp.lstat(full)).mtimeMs < o.olderThanDays * DAY) continue; } catch { continue; }
    }
    out.push(full);
  }
  return out;
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

// Dữ liệu còn sót của ứng dụng đã gỡ: dựa trên Bundle ID dạng com.xxx.yyy không khớp ứng dụng nào đang cài
async function leftovers(home) {
  const roots = ['/Applications', path.join(home, 'Applications')];
  const apps = await dupapps.findApps(roots, 3);
  const ids = new Set();
  await mapLimit(apps, 6, async (p) => {
    const info = await dupapps.readPlist(path.join(p, 'Contents', 'Info.plist'));
    if (info && info.CFBundleIdentifier) ids.add(info.CFBundleIdentifier);
  });
  const vendors = new Set([...ids].map((i) => i.split('.').slice(0, 2).join('.').toLowerCase()));
  const owned = (cid) => {
    const l = cid.toLowerCase();
    if (l.startsWith('com.apple.') || l.startsWith('group.') || l.startsWith('apple')) return true;
    for (const id of ids) {
      const il = id.toLowerCase();
      if (l === il || l.startsWith(il + '.') || il.startsWith(l + '.')) return true;
    }
    return vendors.has(l.split('.').slice(0, 2).join('.'));
  };
  const L = (...p) => path.join(home, 'Library', ...p);
  const found = [];
  const scanDir = async (dir, strip) => {
    for (const f of await children(dir, { olderThanDays: 60 })) {
      const cid = path.basename(f).replace(strip, '');
      if (REVERSE_DNS.test(cid) && !owned(cid)) found.push(f);
    }
  };
  await scanDir(L('Application Support'), /$^/);
  await scanDir(L('Containers'), /$^/);
  await scanDir(L('Preferences'), /\.plist$/);
  await scanDir(L('Saved Application State'), /\.savedState$/);
  await scanDir(L('HTTPStorages'), /$^/);
  await scanDir(L('WebKit'), /$^/);
  return found;
}

// node_modules của dự án không đụng tới lâu ngày
async function staleNodeModules(home, days = 90) {
  const skipTop = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'Downloads']);
  const out = [];
  const markers = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.git/index', '.git/HEAD'];
  async function projectActive(dir) {
    for (const m of markers) {
      try { if (Date.now() - (await fsp.stat(path.join(dir, m))).mtimeMs < days * DAY) return true; } catch { /* không có */ }
    }
    return false;
  }
  async function rec(dir, depth) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    const nm = ents.find((e) => e.name === 'node_modules' && e.isDirectory());
    if (nm) {
      if ((await exists(path.join(dir, 'package.json'))) && !(await projectActive(dir))) out.push(path.join(dir, 'node_modules'));
    }
    if (depth >= 5) return;
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (depth === 0 && skipTop.has(e.name)) continue;
      if (['build', 'dist', 'Pods', 'venv', 'DerivedData'].includes(e.name)) continue;
      await rec(path.join(dir, e.name), depth + 1);
    }
  }
  await rec(home, 0);
  return out;
}

function definitions(home) {
  const L = (...p) => path.join(home, 'Library', ...p);
  const dl = path.join(home, 'Downloads');
  const AI_CACHE = ['huggingface', 'torch', 'lm-studio'];
  return [
    // ----- An toàn: tick sẵn -----
    { id: 'caches', kind: 'safe', how: 'delete', name: 'Bộ nhớ đệm ứng dụng', desc: '~/Library/Caches · tự tạo lại khi cần',
      icon: 'cache', list: () => children(L('Caches'), { skipPrefix: ['com.apple.'] }) },
    { id: 'logs', kind: 'safe', how: 'delete', name: 'Nhật ký và báo cáo lỗi', desc: '~/Library/Logs',
      icon: 'log', list: async () => [...(await children(L('Logs'), { skipPrefix: ['com.apple.'], skipNames: ['DiagnosticReports'] })),
        ...(await children(L('Logs', 'DiagnosticReports')))] },
    { id: 'devcache', kind: 'safe', how: 'delete', name: 'Cache lập trình', desc: 'Xcode DerivedData, npm, Gradle, ~/.cache',
      icon: 'code', list: async () => [
        ...(await children(L('Developer', 'Xcode', 'DerivedData'))),
        ...(await children(L('Developer', 'Xcode', 'DocumentationCache'))),
        ...(await children(L('Developer', 'CoreSimulator', 'Caches'))),
        ...(await children(path.join(home, '.npm', '_cacache'))),
        ...(await children(path.join(home, '.gradle', 'caches'))),
        ...(await children(path.join(home, '.cache'), { skipNames: AI_CACHE })),
      ] },
    { id: 'partial', kind: 'safe', how: 'trash', name: 'Tải dở và bản cài macOS đã tải', desc: '.download, .crdownload, .part, Install macOS',
      icon: 'dmg', list: async () => [
        ...(await children(dl, { match: /\.(crdownload|download|part|partial)$/i })),
        ...(await children('/Applications', { match: /^Install macOS .*\.app$/ })),
      ] },
    { id: 'leftovers', kind: 'safe', how: 'trash', name: 'Dữ liệu còn sót của ứng dụng đã gỡ', desc: '~/Library/Application Support, Preferences, Containers',
      icon: 'folder', list: () => leftovers(home) },
    // ----- Cần xem lại: không tick sẵn -----
    { id: 'installers', kind: 'review', how: 'trash', name: 'File cài đặt cũ', desc: '.dmg, .pkg, .iso trong Downloads',
      icon: 'dmg', list: () => children(dl, { ext: ['.dmg', '.pkg', '.iso'] }) },
    { id: 'xcodeold', kind: 'review', how: 'trash', name: 'Xcode: Archives và Device Support cũ', desc: 'Bản build và iOS cũ hơn 6 tháng',
      icon: 'code', list: async () => [
        ...(await children(L('Developer', 'Xcode', 'Archives'), { olderThanDays: 180 })),
        ...(await children(L('Developer', 'Xcode', 'iOS DeviceSupport'), { olderThanDays: 180 })),
        ...(await children(L('Developer', 'Xcode', 'watchOS DeviceSupport'), { olderThanDays: 180 })),
      ] },
    { id: 'iosbackups', kind: 'review', how: 'trash', name: 'Bản sao lưu iPhone và iPad', desc: '~/Library/Application Support/MobileSync',
      icon: 'phone', list: () => children(L('Application Support', 'MobileSync', 'Backup')) },
    { id: 'nodemodules', kind: 'review', how: 'delete', name: 'Thư mục node_modules cũ', desc: 'Dự án không đụng tới hơn 90 ngày · cài lại bằng npm install',
      icon: 'code', list: () => staleNodeModules(home, 90) },
    { id: 'aidata', kind: 'review', how: 'trash', name: 'Dữ liệu AI cục bộ', desc: 'Ollama, Hugging Face, LM Studio',
      icon: 'ai', list: async () => {
        const cands = [path.join(home, '.ollama', 'models'), path.join(home, '.cache', 'huggingface'),
          path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio')];
        const out = []; for (const c of cands) if (await exists(c)) out.push(c); return out;
      } },
    { id: 'mailattach', kind: 'review', how: 'trash', name: 'Tệp đính kèm Mail', desc: 'Bản tải về, bản gốc vẫn còn trên máy chủ mail',
      icon: 'mail', list: () => children(L('Containers', 'com.apple.mail', 'Data', 'Library', 'Mail Downloads')) },
    { id: 'trash', kind: 'review', how: 'delete', name: 'Thùng rác', desc: 'Xóa vĩnh viễn',
      icon: 'junk', keepEmpty: true, list: () => children(path.join(home, '.Trash')) },
  ];
}

// Trả về [{id,name,desc,icon,kind,how,items:[{path,size}],total}]
async function scan(home = os.homedir(), onProgress = () => {}) {
  const out = [];
  const seen = new Set();
  for (const def of definitions(home)) {
    onProgress({ scope: 'junk', text: `Đang quét: ${def.name}...` });
    let paths = [];
    try { paths = await def.list(); } catch { /* bỏ qua nhóm lỗi quyền */ }
    paths = paths.filter((p) => !seen.has(p) && ![...seen].some((s) => p.startsWith(s + path.sep)));
    const items = (await mapLimit(paths, 8, async (p) => ({ path: p, size: await sizeOf(p) })))
      .filter((i) => i.size > 0 || def.keepEmpty)
      .sort((a, b) => b.size - a.size);
    items.forEach((i) => seen.add(i.path));
    out.push({ id: def.id, name: def.name, desc: def.desc, icon: def.icon, kind: def.kind, how: def.how,
      items, total: items.reduce((s, i) => s + i.size, 0) });
  }
  return out;
}

module.exports = { scan, definitions, staleNodeModules, leftovers };
