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

  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
