'use strict';
const fsp = require('fs').promises;
const path = require('path');

// Lịch sử dọn dẹp: mỗi dòng là một JSON { time, action, path, size, source }
// action: 'trash' (vào Thùng rác) | 'delete' (xóa hẳn) | 'eject' (tháo ổ đĩa ảo)
function createHistory(dir) {
  const file = path.join(dir, 'history.jsonl');
  const MAX_LINES = 5000;

  async function add(entries) {
    if (!entries.length) return;
    await fsp.mkdir(dir, { recursive: true });
    const lines = entries.map((e) => JSON.stringify({ time: e.time || Date.now(), action: e.action, path: e.path, size: e.size || 0, source: e.source || '' }));
    await fsp.appendFile(file, lines.join('\n') + '\n', 'utf8');
    // Giữ file gọn: chỉ giữ MAX_LINES dòng gần nhất
    const all = await readLines();
    if (all.length > MAX_LINES * 1.2) await fsp.writeFile(file, all.slice(-MAX_LINES).join('\n') + '\n', 'utf8');
  }

  async function readLines() {
    try { return (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean); } catch { return []; }
  }

  // Mới nhất trước
  async function list(limit = 500) {
    const out = [];
    for (const l of (await readLines()).reverse()) {
      try { out.push(JSON.parse(l)); } catch { /* bỏ dòng hỏng */ }
      if (out.length >= limit) break;
    }
    return out;
  }

  return { add, list, file };
}

// Cài đặt nhỏ lưu dạng JSON
function createSettings(dir, defaults) {
  const file = path.join(dir, 'settings.json');
  let cache = null;
  async function get() {
    if (cache) return cache;
    try { cache = { ...defaults, ...JSON.parse(await fsp.readFile(file, 'utf8')) }; } catch { cache = { ...defaults }; }
    return cache;
  }
  async function set(patch) {
    const cur = await get();
    for (const k of Object.keys(patch)) if (k in defaults && typeof patch[k] === typeof defaults[k]) cur[k] = patch[k];
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(cur, null, 2), 'utf8');
    return cur;
  }
  return { get, set };
}

module.exports = { createHistory, createSettings };
