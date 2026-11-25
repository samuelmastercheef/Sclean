'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const junk = require('../lib/junk');
const bigfiles = require('../lib/bigfiles');
const media = require('../lib/media');
const dupfiles = require('../lib/dupfiles');
const dupapps = require('../lib/dupapps');
const storage = require('../lib/storage');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sclean-'));
  const mk = (p, n, fill = 1, age = 0) => {
    const f = path.join(tmp, p); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(n, fill));
    if (age) { const t = new Date(Date.now() - age * 86400000); fs.utimesSync(f, t, t); }
    return f;
  };

  // ---- file trùng ----
  const big = Buffer.alloc(300 * 1024, 7), big2 = Buffer.alloc(300 * 1024, 7); big2[150000] = 9;
  const w = (p, c) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), c); };
  w('d/docs/a.bin', big); w('d/dl/a copy.bin', big); w('d/dl/sub/a3.bin', big); w('d/docs/b.bin', big2);
  w('d/docs/node_modules/z.bin', big);
  fs.linkSync(path.join(tmp, 'd/docs/a.bin'), path.join(tmp, 'd/docs/a-hard.bin'));
  const r = await dupfiles.scan([path.join(tmp, 'd/docs'), path.join(tmp, 'd/dl')], { minSize: 1024 });
  assert.strictEqual(r.groups.length, 1); assert.strictEqual(r.groups[0].files.length, 3);
  console.log('dupfiles OK');

  // ---- file lớn ----
  mk('b/movie.mov', 3 * 1024 * 1024); mk('b/setup.dmg', 2 * 1024 * 1024, 1, 400); mk('b/small.txt', 1000);
  mk('b/node_modules/x.bin', 5 * 1024 * 1024);
  const bf = await bigfiles.scan([path.join(tmp, 'b')], { minSize: 1024 * 1024 });
  assert.deepStrictEqual(bf.items.map((i) => i.name), ['movie.mov', 'setup.dmg']);
  assert.strictEqual(bf.items[0].kind, 'video'); assert.strictEqual(bf.items[1].kind, 'disk');
  const old = await bigfiles.scan([path.join(tmp, 'b')], { minSize: 1024 * 1024, olderThanDays: 180 });
  assert.deepStrictEqual(old.items.map((i) => i.name), ['setup.dmg'], 'lọc chưa mở lâu');
  console.log('bigfiles OK');

  // ---- ảnh/video ----
  assert.deepStrictEqual(media.classify('/x/Screenshot 2026-01-01.png', 1000, Date.now(), Date.now()).tags, ['screenshot']);
  assert.strictEqual(media.classify('/x/Screenshot 1.png', 1, Date.now(), Date.now()).kind, 'screen');
  assert.ok(media.classify('/x/Screen Recording 1.mov', 5, Date.now(), Date.now()).tags.includes('screenrec'));
  assert.ok(media.classify('/x/v.mp4', 200 * 1024 * 1024, Date.now(), Date.now()).tags.includes('bigvideo'));
  assert.ok(media.classify('/x/a.jpg', 5, 0, 0).tags.includes('old'));
  assert.strictEqual(media.classify('/x/readme.txt', 5, 0, 0), null);
  // dHash: 2 ảnh gần giống (nhiễu nhỏ) vào cùng nhóm, ảnh khác thì không
  const mkImg = (f) => { const b = Buffer.alloc(9 * 8 * 4); for (let i = 0; i < 72; i++) { const v = f(i % 9, Math.floor(i / 9)); b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = v; b[i * 4 + 3] = 255; } return b; };
  const A = mkImg((x) => x * 20), A2 = mkImg((x, y) => x * 20 + (y === 0 && x === 3 ? 5 : 0)), B = mkImg((x) => 200 - x * 20);
  const items = [A, A2, B].map((b, i) => ({ id: i, hash: media.dhashFromBGRA(b) }));
  const groups = media.clusterSimilar(items);
  assert.strictEqual(groups.length, 1); assert.deepStrictEqual(groups[0].map((x) => x.id).sort(), [0, 1]);
  mk('m/Pictures/Screenshot 1.png', 300 * 1024); mk('m/Movies/clip.mov', 400 * 1024);
  const hashFn = async (p) => ({ hi: 1, lo: 1 }); // mọi ảnh giống nhau
  mk('m/Pictures/p2.jpg', 300 * 1024); mk('m/Pictures/p3.jpg', 310 * 1024);
  const ms = await media.scan([path.join(tmp, 'm')], {}, () => {}, () => false, hashFn);
  assert.strictEqual(ms.items.length, 4);
  assert.strictEqual(ms.items.filter((i) => i.tags.includes('similar')).length, 3);
  console.log('media OK');

  // ---- dọn rác (HOME giả) ----
  const home = path.join(tmp, 'home');
  const hw = (p, n, age) => { const f = path.join(home, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(n, 1)); if (age) { const t = new Date(Date.now() - age * 86400000); fs.utimesSync(f, t, t); } };
  hw('Library/Caches/com.foo.app/data', 50000); hw('Library/Caches/com.apple.Safari/data', 50000);
  hw('Library/Logs/x.log', 20000); hw('Library/Developer/Xcode/DerivedData/Proj-abc/b', 30000);
  hw('Library/Developer/Xcode/Archives/old.xcarchive/a', 40000, 300); hw('Library/Developer/Xcode/Archives/new.xcarchive/a', 40000, 5);
  hw('Downloads/app.dmg', 90000); hw('Downloads/doc.pdf', 90000); hw('Downloads/x.crdownload', 70000);
  hw('.Trash/old.txt', 10000); hw('.ollama/models/blobs/b1', 60000); hw('.cache/huggingface/h', 20000); hw('.cache/pip/p', 8000);
  hw('Library/Application Support/com.gone.app/data', 5000, 100);   // app đã gỡ
  hw('Library/Application Support/com.google.Old/data', 5000, 100); // cùng nhà phát triển với app đang cài -> giữ
  hw('Projects/old/package.json', 10, 200); hw('Projects/old/node_modules/a/i.js', 90000, 200);
  hw('Projects/fresh/package.json', 10, 1); hw('Projects/fresh/node_modules/a/i.js', 90000, 1);
  const ageDir = (p, d) => { const t0 = new Date(Date.now() - d * 86400000); fs.utimesSync(path.join(home, p), t0, t0); };
  // cache trình duyệt / Electron: chỉ thư mục cache, không đụng Cookies, IndexedDB
  hw('Library/Application Support/Google/Chrome/Default/Cache/c1', 30000);
  hw('Library/Application Support/Google/Chrome/Profile 3/Service Worker/CacheStorage/s1', 30000);
  hw('Library/Application Support/Google/Chrome/Default/IndexedDB/db', 30000);
  hw('Library/Application Support/Google/Chrome/Default/Cookies', 3000);
  hw('Library/Application Support/Notion/Partitions/notion/Service Worker/CacheStorage/n1', 40000);
  hw('Library/Application Support/Notion/Code Cache/js', 10000);
  hw('Library/Application Support/Notion/Local Storage/ls', 10000);
  ageDir('Library/Developer/Xcode/Archives/old.xcarchive', 300); ageDir('Library/Application Support/com.gone.app', 100);
  ageDir('Library/Application Support/com.google.Old', 100);
  const installed = path.join(tmp, 'FakeApps');
  fs.mkdirSync(path.join(installed, 'Chrome.app/Contents'), { recursive: true });
  fs.writeFileSync(path.join(installed, 'Chrome.app/Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.google.Chrome</string></dict></plist>');
  const defs = junk.definitions(home);
  const lo = defs.find((d) => d.id === 'leftovers');
  // thay danh sách app cài đặt bằng thư mục giả
  const realFind = dupapps.findApps; dupapps.findApps = async () => realFind([installed], 3);
  const cats = await junk.scan(home);
  dupapps.findApps = realFind;
  const get = (id) => cats.find((c) => c.id === id);
  const names = (id) => get(id).items.map((i) => path.basename(i.path)).sort();
  assert.deepStrictEqual(names('caches'), ['com.foo.app'], 'bỏ com.apple.');
  assert.deepStrictEqual(names('installers'), ['app.dmg']);
  assert.deepStrictEqual(names('partial'), ['x.crdownload']);
  assert.deepStrictEqual(names('xcodeold'), ['old.xcarchive'], 'chỉ Archives cũ hơn 6 tháng');
  assert.deepStrictEqual(names('devcache'), ['Proj-abc', 'pip']);
  assert.deepStrictEqual(names('aidata'), ['huggingface', 'models']);
  assert.deepStrictEqual(names('leftovers'), ['com.gone.app']);
  assert.deepStrictEqual(get('nodemodules').items.map((i) => i.path.includes('/old/')), [true]);
  assert.ok(get('trash').total > 0);
  const rel = (p) => path.relative(path.join(home, 'Library/Application Support'), p);
  assert.deepStrictEqual(get('appcache').items.map((i) => rel(i.path)).sort(), [
    'Google/Chrome/Default/Cache', 'Google/Chrome/Profile 3/Service Worker/CacheStorage',
    'Notion/Code Cache', 'Notion/Partitions/notion/Service Worker/CacheStorage'].sort());
  assert.strictEqual(get('appcache').kind, 'review', 'cache app không tick sẵn');
  const AS = path.join(home, 'Library/Application Support');
  assert.strictEqual(junk.cacheOwner(path.join(AS, 'Google/Chrome/Default/Cache'), home), 'Google Chrome');
  assert.strictEqual(junk.cacheOwner(path.join(AS, 'Notion/Partitions/notion/Cache'), home), 'Notion');
  assert.strictEqual(junk.cacheOwner(path.join(AS, 'discord/Cache'), home), 'Discord');
  assert.strictEqual(junk.cacheOwner('/tmp/x', home), null);
  assert.strictEqual(get('caches').kind, 'safe'); assert.strictEqual(get('aidata').kind, 'review');
  console.log('junk OK');

  // ---- app trùng ----
  const mkApp = (base, name, id, ver) => {
    const d = path.join(base, name + '.app', 'Contents'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'Info.plist'), `<plist><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${ver}</string><key>CFBundleName</key><string>${name}</string></dict></plist>`);
    fs.writeFileSync(path.join(d, 'bin'), Buffer.alloc(5000, 1));
  };
  const apps = path.join(tmp, 'Applications');
  mkApp(apps, 'Zoom', 'us.zoom.xos', '5.9.10'); mkApp(apps, 'Zoom 2', 'us.zoom.xos', '5.17.1');
  mkApp(apps, 'Notes', 'com.apple.Notes', '1'); mkApp(apps, 'Notes copy', 'com.apple.Notes', '1'); mkApp(apps, 'Solo', 'com.solo', '1');
  mkApp(path.join(apps, 'Utilities'), 'Telegram copy', 'com.x.tg', '2'); mkApp(apps, 'Telegram', 'com.y.tg', '3');
  const g = await dupapps.scan([apps], home);
  assert.deepStrictEqual(g.map((x) => x.name).sort(), ['Telegram', 'Zoom 2'].sort());
  assert.strictEqual(path.basename(g.find((x) => x.apps.length === 2 && x.apps[0].bundleId === 'us.zoom.xos').keep), 'Zoom 2.app');
  console.log('dupapps OK');

  // ---- dung lượng ẩn: các hàm phân tích ----
  const c = storage.parseContainer({ Containers: [
    { ContainerReference: 'disk1', CapacityCeiling: 5e8, CapacityFree: 4e8, Volumes: [] },
    { ContainerReference: 'disk3', CapacityCeiling: 500e9, CapacityFree: 20e9, Volumes: [
      { Name: 'Data', Roles: ['Data'], CapacityInUse: 400e9 }, { Name: 'VM', Roles: ['VM'], CapacityInUse: 20e9 },
      { Name: 'Macintosh HD', Roles: ['System'], CapacityInUse: 16e9 }] }] }, 'disk3');
  assert.strictEqual(c.total, 500e9); assert.deepStrictEqual(c.volumes.map((v) => v.role), ['Data', 'VM', 'System']);
  assert.strictEqual(storage.parseContainer(null, 'disk3'), null);
  const sw = storage.parseSwap('total = 21504.00M  used = 21195.75M  free = 308.25M  (encrypted)');
  assert.strictEqual(Math.round(sw.total / 1048576), 21504); assert.ok(sw.used > 2e10);
  assert.strictEqual(storage.parseSwap(''), null);
  const sn = storage.parseSnapshots('Snapshots for volume group containing disk /:\ncom.apple.TimeMachine.2026-11-20-101500.local\ncom.apple.os.update-ABC\ncom.apple.os.update-MSUPrepareUpdate\n');
  assert.strictEqual(sn.total, 3); assert.strictEqual(sn.update, 2); assert.strictEqual(sn.timeMachine[0].date, '2026-11-20 10:15');
  const im = storage.parseImages({ images: [
    { 'image-path': '/Users/x/Downloads/Zalo.dmg', blockcount: 2048, blocksize: 512, 'system-entities': [{ 'dev-entry': '/dev/disk8' }, { 'dev-entry': '/dev/disk8s1', 'mount-point': '/Volumes/Zalo' }] },
    { 'image-path': '/System/Library/AssetsV2/x', 'system-entities': [{ 'mount-point': '/private/var/run/com.apple.security.cryptexd/mnt/sim' }] }] });
  assert.strictEqual(im.length, 1); assert.strictEqual(im[0].name, 'Zalo'); assert.strictEqual(im[0].size, 1048576);
  const rts = storage.parseRuntimes({ A: { identifier: 'A', version: '27.2', build: 'b1', sizeBytes: 5, deletable: true, platformIdentifier: 'com.apple.platform.iphonesimulator' },
    B: { identifier: 'B', version: '27.1', build: 'b0', sizeBytes: 9, deletable: false } });
  assert.deepStrictEqual(rts.map((r) => r.id), ['B', 'A']); assert.strictEqual(rts[1].platform, 'iphone Simulator');
  assert.strictEqual(storage.classify('/u/Library/Group Containers/4C6364ACXT.com.parallels.desktop.appstore').label, 'Máy ảo Parallels');
  assert.strictEqual(storage.classify('/u/Library/Application Support/Google/Chrome').label, 'Dữ liệu trình duyệt');
  assert.strictEqual(storage.classify('/u/Library/CloudStorage/GoogleDrive-a').label, 'File tải về máy từ dịch vụ đám mây');
  assert.strictEqual(storage.classify('/u/Library/Application Support/Lạ').label, null);
  // thư mục lớn: dùng HOME giả, ngưỡng 0 để thấy hết
  const hd = await storage.hiddenData(home, () => {}, 1);
  assert.ok(hd.some((x) => x.path.endsWith('Google/Chrome')), 'đo riêng Google/Chrome');
  assert.ok(!hd.some((x) => x.path.endsWith('Application Support/Google')), 'không đếm trùng thư mục cha');
  console.log('storage OK');

  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
