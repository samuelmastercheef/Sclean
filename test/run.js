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
const hidden = require('../lib/hidden');
const { protectedReason } = require('../lib/safety');
const { createHistory, createSettings } = require('../lib/history');

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

  // ---- bản đồ dung lượng ----
  {
    const H = path.join(tmp, 'maphome');
    const w = (p, n) => { const f = path.join(H, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(n, 7)); return f; };
    w('Documents/a.bin', 300000); w('.docker/vm/disk.raw', 900000); w('Library/Containers/com.x/Data/big', 500000);
    w('Pictures/P.photoslibrary/originals/1.jpg', 200000); w('small.txt', 10);
    const orig = w('Movies/clip.mov', 400000); fs.linkSync(orig, path.join(H, 'Movies', 'clip-link.mov')); // hardlink không tính 2 lần
    fs.symlinkSync(path.join(H, 'Documents'), path.join(H, 'docs-link'));                              // symlink bỏ qua
    const r = await storage.measure(H, { home: H, keepMin: 1 });
    const kid = (n, name) => n.children.find((c) => c.name === name);
    assert.ok(!kid(r.root, 'docs-link'), 'bỏ qua symlink');
    assert.strictEqual(kid(r.root, '.docker').why, 'dot');
    assert.strictEqual(kid(kid(r.root, '.docker'), 'vm').why, 'dot', 'con của thư mục ẩn cũng ẩn');
    assert.strictEqual(kid(r.root, 'Library').why, 'library');
    assert.strictEqual(kid(kid(r.root, 'Library'), 'Containers').why, 'library');
    assert.strictEqual(kid(r.root, 'Documents').why, null);
    const lib = kid(kid(r.root, 'Pictures'), 'P.photoslibrary');
    assert.ok(lib.pkg && lib.why === null && kid(lib, 'originals').why === 'package', 'gói hiện, bên trong ẩn');
    assert.strictEqual(r.root.children[0].name, '.docker', 'sắp xếp lớn trước');
    const movies = kid(r.root, 'Movies');
    assert.ok(movies.size >= 400000 && movies.size < 800000, 'hardlink chỉ tính 1 lần');
    assert.strictEqual(r.root.files, 6);
    const sum = r.root.children.reduce((s, c) => s + c.size, 0) + (r.root.other ? r.root.other.size : 0);
    assert.strictEqual(sum, r.root.size, 'tổng con = cha');
    // keepMin lớn: mục nhỏ gộp vào "khác" ở tầng sâu
    const r2 = await storage.measure(H, { home: H, keepMin: 10 * 1024 * 1024 });
    const deep = kid(kid(r2.root, 'Library'), 'Containers');
    assert.ok(deep.children.length === 0 && deep.other.count === 1);
    let cnt = 0; storage.forEachNode(r.root, () => cnt++); assert.ok(cnt > 8);
    if (process.getuid && process.getuid() !== 0) { // root đọc được mọi thứ nên bỏ qua
      const locked = path.join(H, 'locked'); fs.mkdirSync(locked); fs.chmodSync(locked, 0o000);
      const r3 = await storage.measure(H, { home: H, keepMin: 1 });
      fs.chmodSync(locked, 0o755);
      assert.ok(r3.denied.includes(locked) && kid(r3.root, 'locked').denied);
    }
    console.log('storage OK');
  }

  // ---- danh sách cấm ----
  {
    const H = '/Users/lu';
    for (const p of ['/', '/System/Library/x', '/usr/bin', '/private/var/vm/sleepimage', H, H + '/Library', H + '/Documents', H + '/Library/Containers',
      H + '/Library/Mail/V10', H + '/Library/Containers/com.apple.Safari', H + '/Pictures/Photos Library.photoslibrary', '/etc/hosts', '/Applications',
      '/System/Volumes/Data/Users/lu/Library', 'relative/path', '/Volumes/Zalo']) {
      assert.ok(protectedReason(p, H), 'phải cấm: ' + p);
    }
    for (const p of [H + '/Library/Caches/com.foo', H + '/.docker', H + '/Documents/a.pdf', '/Applications/Zoom.app', H + '/.Trash/old.txt',
      H + '/Library/Group Containers/xx.com.parallels.desktop/Win11.pvm', '/System/Volumes/Data/Users/lu/Downloads/a.dmg',
      H + '/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/x.pdf']) {
      assert.strictEqual(protectedReason(p, H), null, 'phải cho phép: ' + p);
    }
    console.log('safety OK');
  }

  // ---- dung lượng ẩn: bộ phân tích ----
  {
    const snaps = hidden.parseSnapshots('Snapshots for disk /:\ncom.apple.TimeMachine.2026-11-20-101500.local\ncom.apple.os.update-MSUPrepareUpdate\ncom.apple.os.update-ABC123\n');
    assert.deepStrictEqual(snaps.map((x) => x.kind), ['timemachine', 'update', 'update']);
    assert.ok(snaps[0].date > 0 && snaps[1].pendingUpdate && !snaps[2].pendingUpdate);
    assert.deepStrictEqual(hidden.parseSnapshots(null), []);
    const sw = hidden.parseSwap('vm.swapusage: total = 21504.00M  used = 21234.25M  free = 269.75M  (encrypted)');
    assert.strictEqual(sw.total, 21504 * 1024 * 1024); assert.ok(Math.abs(sw.used - 21234.25 * 1024 * 1024) < 2);
    assert.strictEqual(hidden.parseSwap('garbage'), null);
    const m = hidden.parseMounted({ images: [{ 'image-path': '/Users/lu/Downloads/Zalo.dmg', 'system-entities': [{ 'dev-entry': '/dev/disk5' }, { 'mount-point': '/Volumes/Zalo' }] },
      { 'image-path': '/x/none.dmg', 'system-entities': [{ 'dev-entry': '/dev/disk6' }] }] });
    assert.deepStrictEqual(m.map((x) => x.mounts), [['/Volumes/Zalo']]);
    const rt = hidden.parseSimRuntimes({ a: { identifier: 'A', version: '27.2', build: '24C1', platformIdentifier: 'com.apple.platform.iphonesimulator', sizeBytes: 8e9 },
      b: { identifier: 'B', version: '27.2', build: '24C2', platformIdentifier: 'com.apple.platform.iphonesimulator', sizeBytes: 7.5e9 },
      c: { identifier: 'C', version: '26.0', build: '23A', platformIdentifier: 'com.apple.platform.iphonesimulator', sizeBytes: 6e9 } });
    assert.deepStrictEqual(rt.map((r) => [r.id, r.duplicate]), [['A', true], ['B', true], ['C', false]]);
    const ids = hidden.definitions('/Users/lu').map((d) => d.id);
    for (const id of ['chrome', 'parallels', 'simdevices', 'devicesupport', 'notion', 'cloudstorage', 'photos', 'trash', 'macosupdate']) assert.ok(ids.includes(id), id);
    console.log('hidden OK');
  }

  // ---- cache app Electron (trong dọn rác) ----
  {
    const H = path.join(tmp, 'ehome');
    const w = (p) => { const f = path.join(H, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); };
    w('Library/Application Support/Notion/Partitions/notion/Cache/c1'); w('Library/Application Support/Notion/Partitions/notion/Local Storage/keep');
    w('Library/Application Support/Slack/Code Cache/js/1'); w('Library/Application Support/Slack/Service Worker/CacheStorage/a');
    w('Library/Application Support/Google/Chrome/Default/Cache/x'); w('Library/Application Support/Claude/Cache/x');
    const found = (await junk.electronCaches(H)).map((p) => path.relative(path.join(H, 'Library/Application Support'), p)).sort();
    assert.deepStrictEqual(found, ['Notion/Partitions/notion/Cache', 'Slack/Code Cache', 'Slack/Service Worker/CacheStorage']);
    console.log('appcache OK');
  }

  // ---- lịch sử và cài đặt ----
  {
    const d = path.join(tmp, 'store');
    const hist = createHistory(d);
    await hist.add([{ action: 'trash', path: '/a', size: 10, source: 'X' }]);
    await hist.add([{ action: 'delete', path: '/b', size: 5 }]);
    const l = await hist.list();
    assert.deepStrictEqual(l.map((e) => e.path), ['/b', '/a'], 'mới nhất trước');
    const st = createSettings(d, { permanentDelete: false });
    assert.strictEqual((await st.get()).permanentDelete, false);
    await st.set({ permanentDelete: true, evil: 1 });
    const st2 = createSettings(d, { permanentDelete: false });
    assert.deepStrictEqual(await st2.get(), { permanentDelete: true });
    await st2.set({ permanentDelete: 'yes' }); // sai kiểu -> bỏ qua
    assert.strictEqual((await st2.get()).permanentDelete, true);
    console.log('history OK');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
