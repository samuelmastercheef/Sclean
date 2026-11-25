'use strict';
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { sizeOf, mapLimit } = require('./util');

// "Dung lượng ẩn": những thứ chiếm ổ đĩa mà Finder không cho thấy
// (snapshot APFS, swap, bản cập nhật macOS đang chờ, dữ liệu trình duyệt, máy ảo, simulator, cache app...)

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };
async function ls(dir) { try { return await fsp.readdir(dir); } catch { return []; } }

// Đọc được không? false nếu macOS chặn (thiếu Full Disk Access)
async function readable(dir) {
  try { await fsp.readdir(dir); return true; } catch (e) { return !(e.code === 'EPERM' || e.code === 'EACCES'); }
}

// ---------- Bộ phân tích đầu ra lệnh (thuần, có test) ----------

// `tmutil listlocalsnapshots /`
function parseSnapshots(out) {
  if (!out) return [];
  return out.split('\n').map((l) => l.trim()).filter((l) => /^com\.apple\./.test(l)).map((name) => {
    const m = name.match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})/);
    const kind = /TimeMachine/i.test(name) ? 'timemachine' : /os\.update|MSU/i.test(name) ? 'update' : 'other';
    return { name, kind, date: m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`) : null, pendingUpdate: /MSUPrepareUpdate/.test(name) };
  });
}

// `sysctl vm.swapusage` -> "vm.swapusage: total = 21504.00M  used = 21234.25M  free = 269.75M  (encrypted)"
function parseSwap(out) {
  if (!out) return null;
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  const get = (k) => {
    const m = out.match(new RegExp(k + '\\s*=\\s*([\\d.]+)([KMG])'));
    return m ? Math.round(parseFloat(m[1]) * unit[m[2]]) : null;
  };
  const total = get('total'), used = get('used');
  return total == null ? null : { total, used: used || 0 };
}

// `hdiutil info -plist` đã chuyển sang JSON (qua plutil) -> ổ DMG đang mount
function parseMounted(json) {
  const imgs = (json && json.images) || [];
  return imgs.map((im) => {
    const mounts = (im['system-entities'] || []).map((e) => e['mount-point']).filter(Boolean);
    return { image: im['image-path'], mounts, size: im['image-size'] || 0 };
  }).filter((x) => x.image && x.mounts.length);
}

// `xcrun simctl runtime list -j` -> các runtime simulator, đánh dấu bản trùng phiên bản
function parseSimRuntimes(json) {
  const list = Object.values(json || {}).map((r) => ({
    id: r.identifier, version: r.version, build: r.build, platform: r.platformIdentifier || '',
    size: r.sizeBytes || 0, path: r.path || r.runtimeBundlePath || '', lastUsed: r.lastUsedAt ? Date.parse(r.lastUsedAt) : null,
  }));
  const byVer = new Map();
  for (const r of list) { const k = r.platform + '|' + r.version; byVer.set(k, (byVer.get(k) || 0) + 1); }
  for (const r of list) r.duplicate = byVer.get(r.platform + '|' + r.version) > 1;
  return list.sort((a, b) => b.size - a.size);
}

// ---------- Hệ thống ----------
async function system(home) {
  const [snapOut, swapOut, hdiOut] = await Promise.all([
    run('tmutil', ['listlocalsnapshots', '/']),
    run('sysctl', ['vm.swapusage']),
    run('hdiutil', ['info', '-plist']),
  ]);
  const snapshots = parseSnapshots(snapOut);
  let mounted = [];
  if (hdiOut) {
    const tmp = path.join(os.tmpdir(), `sclean-hdi-${process.pid}.plist`);
    try {
      await fsp.writeFile(tmp, hdiOut);
      const j = await run('plutil', ['-convert', 'json', '-o', '-', tmp]);
      mounted = parseMounted(j ? JSON.parse(j) : null);
    } catch { /* bỏ qua */ } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
  }
  let sleepimage = 0;
  try { sleepimage = (await fsp.stat('/private/var/vm/sleepimage')).size; } catch { /* không có */ }
  let disk = null;
  try { const s = await fsp.statfs(home); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* bỏ qua */ }
  return {
    disk, ram: os.totalmem(), swap: parseSwap(swapOut), sleepimage, snapshots,
    pendingUpdate: snapshots.some((s) => s.pendingUpdate),
    mounted,
  };
}

// Full Disk Access: thử đọc vài thư mục macOS bảo vệ
async function fullDiskAccess(home) {
  const probes = [path.join(home, 'Library', 'Safari'), path.join(home, 'Library', 'Mail'), path.join(home, 'Library', 'Messages'),
    path.join(home, '.Trash')];
  for (const p of probes) {
    if (!(await exists(p))) continue;
    if (!(await readable(p))) return false;
  }
  return true;
}

// ---------- Ứng dụng và dữ liệu ẩn ----------
// action: reveal (mở trong Finder) | trash (cho phép chuyển vào Thùng rác sau khi xác nhận)
function definitions(home) {
  const L = (...p) => path.join(home, 'Library', ...p);
  const AS = (...p) => L('Application Support', ...p);
  return [
    { id: 'chrome', group: 'browser', name: 'Google Chrome', paths: [AS('Google', 'Chrome'), L('Caches', 'Google', 'Chrome')],
      guide: 'Trong Chrome: gỡ extension không dùng, Cài đặt > Quyền riêng tư > Xóa dữ liệu duyệt web, xóa các hồ sơ (profile) cũ. Model AI trên máy nằm ở OptGuideOnDeviceModel.' },
    { id: 'edge', group: 'browser', name: 'Microsoft Edge', paths: [AS('Microsoft Edge'), L('Caches', 'Microsoft Edge')], guide: 'Xóa dữ liệu duyệt web và hồ sơ cũ ngay trong Edge.' },
    { id: 'brave', group: 'browser', name: 'Brave', paths: [AS('BraveSoftware'), L('Caches', 'BraveSoftware')], guide: 'Xóa dữ liệu duyệt web ngay trong Brave.' },
    { id: 'arc', group: 'browser', name: 'Arc', paths: [AS('Arc'), L('Caches', 'Arc')], guide: 'Xóa dữ liệu duyệt web ngay trong Arc.' },
    { id: 'firefox', group: 'browser', name: 'Firefox', paths: [AS('Firefox'), L('Caches', 'Firefox')], guide: 'about:preferences#privacy > Xóa dữ liệu.' },

    { id: 'parallels', group: 'vm', name: 'Máy ảo Parallels', find: async () => [path.join(home, 'Parallels'),
      ...(await ls(L('Group Containers'))).filter((n) => /parallels/i.test(n)).map((n) => L('Group Containers', n))],
    vmExt: '.pvm', guide: 'Xóa máy ảo không dùng trong Parallels Control Center (chuột phải > Remove > Move to Trash).' },
    { id: 'utm', group: 'vm', name: 'Máy ảo UTM', paths: [L('Containers', 'com.utmapp.UTM')], vmExt: '.utm', guide: 'Xóa máy ảo trong UTM.' },
    { id: 'vmware', group: 'vm', name: 'Máy ảo VMware', paths: [path.join(home, 'Virtual Machines.localized')], vmExt: '.vmwarevm', guide: 'Xóa máy ảo trong VMware Fusion.' },
    { id: 'docker', group: 'vm', name: 'Docker Desktop', paths: [L('Containers', 'com.docker.docker'), path.join(home, '.docker')],
      guide: 'Trong Terminal: docker system prune -a (xóa image và container không dùng), hoặc Docker Desktop > Troubleshoot > Clean / Purge data.' },

    { id: 'simdevices', group: 'dev', name: 'Simulator iOS (thiết bị)', paths: [L('Developer', 'CoreSimulator', 'Devices')],
      guide: 'Trong Terminal: xcrun simctl delete unavailable (xóa simulator của iOS đã gỡ). Hoặc Xcode > Window > Devices and Simulators.' },
    { id: 'devicesupport', group: 'dev', name: 'Xcode iOS DeviceSupport', paths: [L('Developer', 'Xcode', 'iOS DeviceSupport'), L('Developer', 'Xcode', 'watchOS DeviceSupport')],
      guide: 'Xóa các bản iOS cũ được. Lần sau cắm iPhone, Xcode tự tải lại bản cần thiết.', action: 'trashChildren' },
    { id: 'android', group: 'dev', name: 'Android SDK và máy ảo', paths: [L('Android', 'sdk'), path.join(home, '.android', 'avd'), path.join(home, '.gradle')],
      guide: 'Android Studio > Device Manager: xóa emulator không dùng. SDK Manager: bỏ system image cũ.' },

    { id: 'messages', group: 'apple', name: 'Tin nhắn: tệp đính kèm', paths: [L('Messages', 'Attachments')], fda: true,
      guide: 'Cài đặt hệ thống > Chung > Dung lượng > Tin nhắn: xem và xóa tệp lớn. Hoặc Tin nhắn > Cài đặt > Giữ tin nhắn: 1 năm.' },
    { id: 'mail', group: 'apple', name: 'Mail', paths: [L('Mail'), L('Containers', 'com.apple.mail')], fda: true,
      guide: 'Xóa thư có tệp đính kèm lớn trong Mail, rồi Hộp thư > Xóa các mục đã xóa.' },
    { id: 'photos', group: 'apple', name: 'Thư viện Ảnh', find: async () => (await ls(path.join(home, 'Pictures'))).filter((n) => n.endsWith('.photoslibrary')).map((n) => path.join(home, 'Pictures', n)), fda: true,
      guide: 'Mở ứng dụng Ảnh. Nếu dùng Ảnh iCloud: Cài đặt > iCloud > Tối ưu hóa dung lượng máy Mac. Xóa video lớn rồi làm trống album Đã xóa gần đây.' },
    { id: 'trash', group: 'apple', name: 'Thùng rác', paths: [path.join(home, '.Trash')], fda: true,
      guide: 'Mở Thùng rác trong Finder, xem lại rồi chọn Làm trống. Đây là chỗ file đã "xóa" vẫn chiếm dung lượng.' },
    { id: 'icloud', group: 'cloud', name: 'iCloud Drive (bản tải về máy)', paths: [L('Mobile Documents')],
      guide: 'Chuột phải thư mục trong iCloud Drive > Xóa bản tải về (Remove Download). File vẫn còn trên iCloud.' },
    { id: 'cloudstorage', group: 'cloud', name: 'Google Drive, OneDrive, Dropbox (bản offline)', find: async () => (await ls(L('CloudStorage'))).map((n) => L('CloudStorage', n)),
      guide: 'Chuyển sang chế độ Stream/Online-only, bỏ "Available offline" cho thư mục lớn. File vẫn còn trên mây.' },

    { id: 'notion', group: 'appcache', name: 'Notion', paths: [AS('Notion')], guide: 'Phần lớn là cache: trong Notion đăng xuất rồi đăng nhập lại, hoặc gỡ và cài lại.' },
    { id: 'slack', group: 'appcache', name: 'Slack', paths: [AS('Slack'), L('Containers', 'com.tinyspeck.slackmacgap')], guide: 'Slack > Help > Troubleshooting > Clear Cache and Restart.' },
    { id: 'discord', group: 'appcache', name: 'Discord', paths: [AS('discord')], guide: 'Thoát Discord rồi mở lại; cache tự gọn lại.' },
    { id: 'teams', group: 'appcache', name: 'Microsoft Teams', paths: [AS('Microsoft', 'Teams'), L('Containers', 'com.microsoft.teams2')], guide: 'Teams > Cài đặt > Xóa cache, hoặc đăng xuất rồi đăng nhập lại.' },
    { id: 'office', group: 'appcache', name: 'Microsoft Office', find: async () => (await ls(L('Group Containers'))).filter((n) => /UBF8T346G9\.Office/i.test(n)).map((n) => L('Group Containers', n)),
      guide: 'Cache của Office, an toàn để Office tự quản lý. Có thể xóa thư mục Office/16.0/OfficeFileCache khi Office đang đóng.' },
    { id: 'zalo', group: 'chat', name: 'Zalo', find: async () => [AS('ZaloData'), AS('Zalo'), ...(await ls(L('Containers'))).filter((n) => /zalo/i.test(n)).map((n) => L('Containers', n))],
      guide: 'Zalo > Cài đặt > Dữ liệu: xóa ảnh, video, file đã tải trong các cuộc trò chuyện.' },
    { id: 'telegram', group: 'chat', name: 'Telegram', find: async () => (await ls(L('Group Containers'))).filter((n) => /telegram/i.test(n)).map((n) => L('Group Containers', n)),
      guide: 'Telegram > Cài đặt > Dữ liệu và bộ nhớ > Sử dụng bộ nhớ > Xóa cache.' },
    { id: 'whatsapp', group: 'chat', name: 'WhatsApp', find: async () => (await ls(L('Group Containers'))).filter((n) => /whatsapp/i.test(n)).map((n) => L('Group Containers', n)),
      guide: 'WhatsApp > Cài đặt > Bộ nhớ: xóa tệp lớn trong từng cuộc trò chuyện.' },
    { id: 'claude', group: 'appcache', name: 'Claude', paths: [AS('Claude')], guide: 'Có máy ảo của Claude (vm_bundles) đang dùng, nên để nguyên.' },

    { id: 'drawthings', group: 'ai', name: 'Draw Things (model AI)', paths: [L('Containers', 'com.liuliu.draw-things')], guide: 'Xóa model không dùng ngay trong Draw Things.' },
    { id: 'ollama', group: 'ai', name: 'Ollama', paths: [path.join(home, '.ollama')], guide: 'Trong Terminal: ollama list rồi ollama rm <tên model>.' },
    { id: 'hf', group: 'ai', name: 'Hugging Face cache', paths: [path.join(home, '.cache', 'huggingface')], guide: 'Trong Terminal: huggingface-cli delete-cache để chọn model cần xóa.' },
    { id: 'lmstudio', group: 'ai', name: 'LM Studio', paths: [path.join(home, '.lmstudio'), path.join(home, '.cache', 'lm-studio')], guide: 'Xóa model trong LM Studio > My Models.' },

    { id: 'macosupdate', group: 'system', name: 'Bản cài và cập nhật macOS đã tải', paths: ['/Library/Updates', '/macOS Install Data'],
      guide: 'Cài nốt bản cập nhật trong Cài đặt hệ thống > Chung > Cập nhật phần mềm. Sau khi cài, phần này tự được dọn.' },
  ];
}

// Đo các mục trên, kèm 5 thư mục con lớn nhất và máy ảo (nếu có)
async function apps(home, onProgress = () => {}) {
  const defs = definitions(home);
  const out = [];
  await mapLimit(defs, 4, async (d) => {
    let paths = d.paths || [];
    if (d.find) { try { paths = [...paths, ...(await d.find())]; } catch { /* bỏ qua */ } }
    const parts = [];
    let denied = false;
    for (const p of [...new Set(paths)]) {
      if (!(await exists(p))) continue;
      if (!(await readable(p))) { denied = true; parts.push({ path: p, size: 0, denied: true }); continue; }
      onProgress({ scope: 'hidden', text: `Đang đo ${d.name}...` });
      // Đo từng mục con một lần: vừa ra tổng, vừa biết mục con nào lớn nhất
      const names = await ls(p);
      const kids = await mapLimit(names, 6, async (n) => ({ path: path.join(p, n), size: await sizeOf(path.join(p, n)) }));
      parts.push({ path: p, size: kids.reduce((s, k) => s + k.size, 0), kids });
    }
    if (!parts.length) return;
    const size = parts.reduce((s, x) => s + x.size, 0);
    if (size < 50 * 1024 * 1024 && !denied) return; // bỏ mục nhỏ
    // Thư mục con lớn nhất để biết cụ thể cái gì chiếm chỗ
    const top = parts.flatMap((x) => x.kids || []);
    for (const x of parts) delete x.kids;
    top.sort((a, b) => b.size - a.size);
    // Máy ảo: tìm các gói .pvm/.utm/.vmwarevm, kèm ngày sửa lần cuối
    let vms = [];
    if (d.vmExt) {
      const found = [];
      const rec = async (dir, depth) => {
        for (const n of await ls(dir)) {
          const full = path.join(dir, n);
          if (n.endsWith(d.vmExt)) { found.push(full); continue; }
          if (depth < 4) { try { if ((await fsp.lstat(full)).isDirectory()) await rec(full, depth + 1); } catch { /* bỏ qua */ } }
        }
      };
      for (const part of parts.filter((x) => !x.denied)) await rec(part.path, 0);
      vms = await mapLimit(found, 2, async (p) => {
        let mtime = 0;
        try { mtime = (await fsp.stat(p)).mtimeMs; } catch { /* bỏ qua */ }
        return { path: p, size: await sizeOf(p), mtime };
      });
    }
    out.push({ id: d.id, group: d.group, name: d.name, guide: d.guide, size, denied, fda: !!d.fda, action: d.action || 'reveal',
      parts, top: top.slice(0, d.action === 'trashChildren' ? 40 : 6), vms });
  });
  return out.sort((a, b) => b.size - a.size);
}

// Runtime simulator iOS (Xcode 15+), dò bản trùng
async function simRuntimes() {
  const out = await run('xcrun', ['simctl', 'runtime', 'list', '-j'], 20000);
  if (!out) return [];
  try { return parseSimRuntimes(JSON.parse(out)); } catch { return []; }
}

async function scan(home = os.homedir(), onProgress = () => {}) {
  onProgress({ scope: 'hidden', text: 'Đang đọc thông tin hệ thống...' });
  const [sys, fda, runtimes] = await Promise.all([system(home), fullDiskAccess(home), simRuntimes()]);
  const items = await apps(home, onProgress);
  return { system: sys, fda, runtimes, items };
}

module.exports = { scan, definitions, parseSnapshots, parseSwap, parseMounted, parseSimRuntimes, fullDiskAccess, readable };
