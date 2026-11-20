'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { sizeOf, mapLimit } = require('./util');

function readPlist(plistPath) {
  return new Promise((resolve) => {
    execFile('plutil', ['-convert', 'json', '-o', '-', plistPath], { maxBuffer: 8 << 20 }, async (err, stdout) => {
      if (!err) { try { return resolve(JSON.parse(stdout)); } catch { /* rơi xuống fallback */ } }
      // Fallback đọc plist XML đơn giản (khi không có plutil)
      try {
        const txt = await fsp.readFile(plistPath, 'utf8');
        const get = (k) => {
          const m = txt.match(new RegExp('<key>' + k + '</key>\\s*<string>([^<]*)</string>'));
          return m ? m[1] : undefined;
        };
        resolve({
          CFBundleIdentifier: get('CFBundleIdentifier'), CFBundleDisplayName: get('CFBundleDisplayName'),
          CFBundleName: get('CFBundleName'), CFBundleShortVersionString: get('CFBundleShortVersionString'),
          CFBundleVersion: get('CFBundleVersion'),
        });
      } catch { resolve(null); }
    });
  });
}

async function findApps(roots, maxDepth = 2) {
  const found = [];
  async function rec(dir, depth) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name.endsWith('.app')) found.push(full);
        else if (depth < maxDepth) await rec(full, depth + 1);
      }
    }
  }
  for (const r of roots) await rec(r, 0);
  return found;
}

// "Zoom 2.app", "Zoom copy.app", "Zoom (1).app" -> "zoom"
function normName(file) {
  let n = path.basename(file, '.app').toLowerCase();
  n = n.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+copy(\s+\d+)?$/, '').replace(/\s+\d+$/, '').replace(/\s+bản sao(\s+\d+)?$/, '');
  return n.trim();
}

function cmpVersion(a = '', b = '') {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function scan(roots, home = os.homedir()) {
  roots = roots || ['/Applications', path.join(home, 'Applications')];
  const files = await findApps(roots);
  const apps = (await mapLimit(files, 6, async (p) => {
    const info = await readPlist(path.join(p, 'Contents', 'Info.plist'));
    const bid = info && info.CFBundleIdentifier;
    if (bid && bid.startsWith('com.apple.')) return null; // không đụng app của Apple
    let st; try { st = await fsp.stat(p); } catch { return null; }
    return {
      path: p,
      file: path.basename(p),
      name: (info && (info.CFBundleDisplayName || info.CFBundleName)) || path.basename(p, '.app'),
      bundleId: bid || null,
      version: (info && (info.CFBundleShortVersionString || info.CFBundleVersion)) || '',
      mtime: st.mtimeMs,
      size: await sizeOf(p),
      inUserApps: p.startsWith(path.join(home, 'Applications')),
    };
  })).filter(Boolean);

  // Union-find theo bundleId và tên chuẩn hoá
  const parent = apps.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const keyIdx = new Map();
  apps.forEach((a, i) => {
    const keys = [];
    if (a.bundleId) keys.push('id:' + a.bundleId);
    keys.push('nm:' + normName(a.path));
    for (const k of keys) {
      if (keyIdx.has(k)) union(i, keyIdx.get(k)); else keyIdx.set(k, i);
    }
  });
  const buckets = new Map();
  apps.forEach((a, i) => {
    const r = find(i);
    (buckets.get(r) || buckets.set(r, []).get(r)).push(a);
  });

  const groups = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // Bản nên giữ: version cao nhất > nằm ở /Applications > mới nhất
    list.sort((a, b) =>
      cmpVersion(b.version, a.version) ||
      (Number(a.inUserApps) - Number(b.inUserApps)) ||
      (b.mtime - a.mtime));
    groups.push({ name: list[0].name, apps: list, keep: list[0].path });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

module.exports = { scan, normName, readPlist, findApps };
