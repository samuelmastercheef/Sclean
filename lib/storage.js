'use strict';
// Phân tích "dung lượng ẩn": phần System Data mà Finder không hiển thị.
// Chỉ đọc. Các thao tác (tháo DMG, xóa runtime Simulator) nằm ở main.js và luôn hỏi lại người dùng.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { sizeOf, mapLimit } = require('./util');

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 << 20 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Chuyển plist (XML) sang object bằng plutil, đọc từ stdin
function plistToJSON(xml) {
  return new Promise((resolve) => {
    if (!xml) return resolve(null);
    let out = '';
    const p = spawn('plutil', ['-convert', 'json', '-o', '-', '-']);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve(null); } });
    p.stdin.end(xml);
  });
}
const runPlist = async (cmd, args, timeout) => plistToJSON(await run(cmd, args, timeout));

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

// ---------- Các hàm phân tích thuần (có test) ----------

const ROLE_LABEL = {
  System: 'macOS (hệ thống)', Data: 'Dữ liệu (ứng dụng, file, System Data)', Preboot: 'Preboot (khởi động, bản cập nhật chờ)',
  VM: 'Bộ nhớ ảo (swap)', Recovery: 'Recovery', Update: 'Cập nhật macOS',
};

// Từ `diskutil apfs list -plist` lấy container chứa ổ khởi động
function parseContainer(apfs, containerRef) {
  if (!apfs || !Array.isArray(apfs.Containers)) return null;
  const c = apfs.Containers.find((x) => x.ContainerReference === containerRef) || null;
  if (!c) return null;
  const volumes = (c.Volumes || []).map((v) => {
    const role = (v.Roles && v.Roles[0]) || '';
    return { name: v.Name, role, label: ROLE_LABEL[role] || v.Name, used: v.CapacityInUse || 0, dev: v.DeviceIdentifier };
  }).sort((a, b) => b.used - a.used);
  return { ref: c.ContainerReference, total: c.CapacityCeiling || 0, free: c.CapacityFree || 0, volumes };
}

// "total = 21504.00M  used = 21195.75M  free = 308.25M  (encrypted)"
function parseSwap(txt) {
  if (!txt) return null;
  const num = (k) => {
    const m = txt.match(new RegExp(k + '\\s*=\\s*([\\d.]+)([KMG])'));
    if (!m) return 0;
    return parseFloat(m[1]) * { K: 1024, M: MB, G: GB }[m[2]];
  };
  return { total: num('total'), used: num('used'), free: num('free') };
}

// Output của `tmutil listlocalsnapshots /`
function parseSnapshots(txt) {
  const names = (txt || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('com.apple.'));
  const tm = names.filter((n) => n.includes('TimeMachine'));
  const update = names.filter((n) => n.includes('os.update'));
  const dateOf = (n) => { const m = n.match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})/); return m ? `${m[1]} ${m[2]}:${m[3]}` : null; };
  return { total: names.length, timeMachine: tm.map((n) => ({ name: n, date: dateOf(n) })), update: update.length, other: names.length - tm.length - update.length };
}

// Từ `hdiutil info -plist` lấy các ổ DMG người dùng đang gắn (bỏ qua ảnh hệ thống như runtime Simulator)
function parseImages(info) {
  if (!info || !Array.isArray(info.images)) return [];
  const out = [];
  for (const img of info.images) {
    const mounts = (img['system-entities'] || []).map((e) => e['mount-point']).filter(Boolean);
    const userMounts = mounts.filter((m) => m.startsWith('/Volumes/'));
    if (!userMounts.length) continue;
    out.push({ image: img['image-path'] || '', mounts: userMounts, name: path.basename(userMounts[0]), size: (img.blockcount || 0) * (img.blocksize || 512) });
  }
  return out;
}

// Từ `xcrun simctl runtime list -j`
function parseRuntimes(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.values(json).filter((r) => r && r.identifier).map((r) => ({
    id: r.identifier, version: r.version, build: r.build, size: r.sizeBytes || 0, deletable: !!r.deletable,
    platform: (r.platformIdentifier || '').replace('com.apple.platform.', '').replace('simulator', ' Simulator'),
    lastUsed: r.lastUsedAt || null, state: r.state,
  })).sort((a, b) => b.size - a.size);
}

// Gợi ý cho các thư mục ẩn hay chiếm chỗ. Thứ tự quan trọng: luật cụ thể trước.
const RULES = [
  [/\.pvm$|parallels/i, 'Máy ảo Parallels', 'Nếu không dùng nữa, xóa máy ảo ngay trong Parallels Control Center.'],
  [/\/UTM|com\.utmapp/i, 'Máy ảo UTM', 'Xóa máy ảo không dùng ngay trong UTM.'],
  [/com\.docker\.docker/i, 'Docker Desktop', 'Chạy "docker system prune" hoặc giảm Disk image size trong Docker Desktop › Settings › Resources.'],
  [/\/Claude\/vm_bundles/i, 'Máy ảo của Claude', 'Claude dùng để chạy công cụ. Đang dùng thì nên để nguyên.'],
  [/\/Application Support\/Claude$/i, 'Dữ liệu ứng dụng Claude', 'Phần lớn là máy ảo vm_bundles (đang dùng, nên để nguyên). Phần cache xóa được ở Dọn rác › "Cache trình duyệt và ứng dụng" khi Claude đã thoát.'],
  [/\/Google\/Chrome$|\/BraveSoftware|\/Microsoft Edge$|\/Arc$|\/Vivaldi$|\/Chromium$/i, 'Dữ liệu trình duyệt',
    'Phần lớn là cache, extension và dữ liệu web. Gỡ extension không dùng, xóa dữ liệu trang web trong cài đặt trình duyệt, dọn profile cũ. Cache an toàn có ở mục Dọn rác.'],
  [/\/Notion$|\/Slack$|\/discord$|\/Code$|\/Figma$|\/zoom\.us$|\/Microsoft Teams/i, 'Dữ liệu ứng dụng (Electron)',
    'Phần lớn là cache. Mục Dọn rác › "Cache trình duyệt và ứng dụng" xóa được phần cache khi ứng dụng đã thoát.'],
  [/\/CloudStorage\//i, 'File tải về máy từ dịch vụ đám mây', 'Chuyển sang chế độ chỉ lưu trên mây (Stream / Online-only) hoặc bỏ "Available offline" cho thư mục lớn.'],
  [/\/Mobile Documents/i, 'iCloud Drive', 'Bật "Optimize Mac Storage" trong Cài đặt › Apple ID › iCloud.'],
  [/iOS DeviceSupport|watchOS DeviceSupport/i, 'Xcode Device Support', 'Xóa thư mục các bản iOS cũ. Xcode tải lại khi cắm máy.'],
  [/CoreSimulator\/Devices/i, 'Máy Simulator của Xcode', 'Chạy "xcrun simctl delete unavailable" hoặc xóa máy không dùng trong Xcode › Devices.'],
  [/\/Android\/sdk|\.android\/avd/i, 'Android SDK / máy ảo Android', 'Xóa system image và máy ảo không dùng trong Android Studio › Device Manager / SDK Manager.'],
  [/com\.liuliu\.draw-things|\.ollama|lm-?studio|huggingface/i, 'Model AI', 'Xóa model không dùng ngay trong ứng dụng.'],
  [/Telegram|keepcoder/i, 'Telegram', 'Telegram › Cài đặt › Dữ liệu và bộ nhớ › Xóa cache.'],
  [/WhatsApp/i, 'WhatsApp', 'WhatsApp › Cài đặt › Bộ nhớ.'],
  [/[Zz]alo/i, 'Zalo', 'Zalo › Cài đặt › Dữ liệu › Xóa dữ liệu cũ.'],
  [/UBF8T346G9\.Office|com\.microsoft\./i, 'Microsoft Office', 'Chủ yếu là cache và font. Có thể để nguyên.'],
  [/com\.apple\.mail|\/Mail$/i, 'Mail', 'Xóa thư rác, thư có tệp đính kèm lớn trong Mail.'],
];
function classify(p) {
  for (const [re, label, hint] of RULES) if (re.test(p)) return { label, hint };
  return { label: null, hint: 'Hiện trong Finder để xem bên trong là gì trước khi quyết định.' };
}

// ---------- Thu thập ----------

async function diskOverview() {
  const info = await runPlist('diskutil', ['info', '-plist', '/']);
  const ref = info && (info.APFSContainerReference || info.ParentWholeDisk);
  const apfs = await runPlist('diskutil', ['apfs', 'list', '-plist']);
  return parseContainer(apfs, ref);
}

async function swap() { return parseSwap(await run('sysctl', ['-n', 'vm.swapusage'])); }
async function snapshots() { return parseSnapshots(await run('tmutil', ['listlocalsnapshots', '/'])); }
async function images() { return parseImages(await runPlist('hdiutil', ['info', '-plist'])); }

async function runtimes() {
  // Không gọi xcrun khi máy chưa có Xcode: xcrun sẽ bật hộp thoại cài Command Line Tools
  if (!(await exists('/Applications/Xcode.app')) && !(await exists('/Library/Developer/CommandLineTools'))) return [];
  const out = await run('xcrun', ['simctl', 'runtime', 'list', '-j'], 30000);
  try { return parseRuntimes(JSON.parse(out)); } catch { return []; }
}

// `du` nhanh hơn nhiều so với duyệt bằng Node và đếm đúng file chỉ lưu trên mây (0 byte)
async function duSize(p) {
  if (!(await exists(p))) return 0;
  const out = await run('du', ['-skx', p], 180000);
  const kb = out && parseInt(out.trim().split(/\s/)[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : sizeOf(p);
}

async function childDirs(dir) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return ents.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => path.join(dir, e.name));
}

// Các thư mục lớn trong ~/Library và thư mục ẩn của công cụ lập trình
async function hiddenData(home, onProgress = () => {}, minSize = 300 * MB) {
  const L = (...p) => path.join(home, 'Library', ...p);
  const cands = [
    ...(await childDirs(L('Application Support'))),
    ...(await childDirs(L('Group Containers'))),
    ...(await childDirs(L('Containers'))),
    ...(await childDirs(L('Application Support', 'Google'))),
    ...(await childDirs(L('Application Support', 'BraveSoftware'))),
    ...(await childDirs(L('CloudStorage'))),
    ...(await childDirs(L('Developer', 'Xcode'))),
    L('Developer', 'CoreSimulator', 'Devices'),
    L('Android', 'sdk'),
    L('Mobile Documents'),
    path.join(home, '.android', 'avd'),
    path.join(home, '.ollama'),
    path.join(home, '.docker'),
    path.join(home, 'Parallels'),
  ];
  // Bỏ thư mục cha khi đã đo riêng thư mục con (ví dụ Application Support/Google → Google/Chrome)
  const set = [...new Set(cands)];
  const uniq = set.filter((p) => !set.some((q) => q.startsWith(p + path.sep)));
  let done = 0;
  const sized = await mapLimit(uniq, 4, async (p) => {
    const size = await duSize(p);
    done++;
    if (done % 10 === 0) onProgress({ scope: 'storage', text: `Đang đo thư mục ẩn (${done}/${uniq.length})...` });
    return { path: p, size };
  });
  return sized.filter((x) => x.size >= minSize).sort((a, b) => b.size - a.size).slice(0, 30)
    .map((x) => ({ ...x, ...classify(x.path) }));
}

// Những chỗ macOS chặn đọc nếu chưa có Full Disk Access
async function protectedAreas(home) {
  const pics = path.join(home, 'Pictures');
  let libs = [];
  try { libs = (await fsp.readdir(pics)).filter((n) => n.endsWith('.photoslibrary')).map((n) => path.join(pics, n)); } catch { /* không có */ }
  const areas = [
    ...libs.map((p) => ({ name: 'Thư viện Ảnh (' + path.basename(p, '.photoslibrary') + ')', path: p, hint: 'Nếu dùng iCloud Photos, bật "Tối ưu hóa dung lượng máy Mac" trong Ảnh › Cài đặt › iCloud.' })),
    { name: 'Thùng rác', path: path.join(home, '.Trash'), hint: 'Mở Thùng rác, xem lại rồi Làm trống.' },
    { name: 'Tin nhắn (Messages)', path: path.join(home, 'Library', 'Messages'), hint: 'Tin nhắn › Cài đặt › Giữ tin nhắn: 30 ngày hoặc 1 năm. Hoặc Cài đặt › Cài đặt chung › Dung lượng › Tin nhắn.' },
    { name: 'Mail', path: path.join(home, 'Library', 'Mail'), hint: 'Xóa thư có tệp đính kèm lớn, làm trống hộp thư Rác.' },
    { name: 'Safari', path: path.join(home, 'Library', 'Safari'), hint: 'Safari › Cài đặt › Quyền riêng tư › Quản lý dữ liệu trang web.' },
  ];
  return mapLimit(areas, 3, async (a) => {
    if (!(await exists(a.path))) return { ...a, missing: true };
    try { await fsp.readdir(a.path); } catch (e) { return { ...a, blocked: e.code === 'EPERM' || e.code === 'EACCES' }; }
    return { ...a, size: await duSize(a.path) };
  });
}

async function scan(home = os.homedir(), onProgress = () => {}) {
  const say = (text) => onProgress({ scope: 'storage', text });
  say('Đang đọc ổ đĩa...');
  const [disk, sw, snaps, imgs] = await Promise.all([diskOverview(), swap(), snapshots(), images()]);
  say('Đang đọc runtime Simulator...');
  const rts = await runtimes();
  say('Đang kiểm tra vùng được bảo vệ...');
  const prot = await protectedAreas(home);
  say('Đang đo thư mục ẩn...');
  const hidden = await hiddenData(home, onProgress);
  say('');
  return { disk, swap: sw, snapshots: snaps, images: imgs, runtimes: rts, protected: prot.filter((a) => !a.missing), hidden };
}

module.exports = { scan, parseContainer, parseSwap, parseSnapshots, parseImages, parseRuntimes, classify, hiddenData, protectedAreas };
