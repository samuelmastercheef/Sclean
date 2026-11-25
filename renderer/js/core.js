(function () {
'use strict';
const SC = window.SC = { pages: {}, state: { junk: null, big: null, media: null, dups: null, apps: null, storage: null, map: null, applist: null }, status: {} };

SC.$ = (s, r = document) => r.querySelector(s);

// Tạo phần tử DOM an toàn (không dùng innerHTML với dữ liệu file)
SC.h = function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.includes('-')) el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const h = SC.h;
// Thay nội dung phần tử, tự làm phẳng mảng và bỏ qua null/false
SC.fill = (el, ...kids) => {
  const nodes = kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k))));
  el.replaceChildren(...nodes);
};

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  junk: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  files: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  big: '<path d="M6 20h12l-1.5-9h-9z"/><circle cx="12" cy="7" r="2.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 9"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  cache: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  log: '<path d="M7 3h8l4 4v14H7z"/><path d="M10 12h6M10 16h6"/>',
  code: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>',
  dmg: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  zip: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 3v8M10 7h2M12 11h2"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  ai: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  doc: '<path d="M7 3h8l4 4v14H7z"/><path d="M10 12h6M10 16h6"/>',
  map: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
};
SC.icon = function (name, size = 17, sw = 1.8) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.doc}</svg>`;
  return t.content.firstChild;
};

SC.fmt = function (n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  if (i === 0) return Math.round(n) + ' B';
  const dec = i >= 3 ? 1 : (i === 2 && n < 10 ? 1 : 0);
  return n.toLocaleString('vi-VN', { maximumFractionDigits: dec }) + ' ' + u[i];
};
SC.fdate = (ms) => new Date(ms).toLocaleDateString('vi-VN');
SC.ago = function (ms) {
  const d = Math.max(0, (Date.now() - ms) / 86400000);
  if (d < 1) return 'hôm nay';
  if (d < 30) return Math.floor(d) + ' ngày trước';
  if (d < 365) return Math.floor(d / 30) + ' tháng trước';
  return Math.floor(d / 365) + ' năm trước';
};
SC.home = (p) => p.replace(/^\/Users\/[^/]+/, '~');

let toastTimer;
SC.toast = function (msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
};

SC.chk = (label, checked, onchange) => h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label, onchange });
SC.btn = (label, cls, onclick, icon) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick }, icon ? SC.icon(icon, 15, 2) : null, label);
SC.tag = (text, kind) => h('span', { class: 'tag ' + (kind || '') }, text);
SC.tile = (icon, w, hgt, cls) => h('span', { class: 'tile ' + (cls || ''), style: { width: w + 'px', height: hgt + 'px' } }, SC.icon(icon, Math.round(Math.min(w, hgt) * 0.45), 1.7));

// ---- Thumbnail tải lười, tối đa 3 yêu cầu cùng lúc ----
const queue = []; let active = 0;
function pump() {
  while (active < 3 && queue.length) {
    const job = queue.shift(); active++;
    window.api.thumb(job.path, job.size).then(job.cb).catch(() => job.cb(null)).finally(() => { active--; pump(); });
  }
}
const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    if (e.target._job) { queue.push(e.target._job); pump(); }
  }
}, { rootMargin: '150px' }) : null;
SC.lazyThumb = function (box, path, size) {
  box._job = { path, size, cb: (url) => { if (url && box.isConnected !== false) box.replaceChildren(h('img', { src: url, alt: '' })); } };
  if (io) io.observe(box); else { queue.push(box._job); pump(); }
};

// ---- Điều hướng ----
SC.nav = [
  ['home', 'Tổng quan', 'home'], ['map', 'Bản đồ dung lượng', 'map'], ['storage', 'Dung lượng ẩn', 'disc'],
  ['junk', 'Dọn rác', 'junk'], ['big', 'File lớn và cũ', 'big'],
  ['media', 'Ảnh và video', 'image'], ['files', 'File trùng', 'files'], ['applist', 'Quản lý ứng dụng', 'window'], ['apps', 'Ứng dụng trùng', 'apps'],
  ['history', 'Lịch sử và an toàn', 'history'],
];
SC.badge = (key, text) => { const b = document.getElementById('badge-' + key); if (b) b.textContent = text || ''; };
SC.go = function (key) {
  document.querySelectorAll('.nav-item').forEach((n) => {
    const on = n.dataset.page === key;
    n.classList.toggle('active', on);
    if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + key));
  const pg = SC.pages[key];
  if (pg && pg.onShow) pg.onShow();
};

SC.setScanButton = function (btn, scanning, label) {
  btn.textContent = scanning ? 'Dừng' : (label || 'Quét');
};

SC.trashed = 0;
SC.pruneAll = (paths) => { const s = new Set(paths); Object.values(SC.pages).forEach((p) => p && p.prune && p.prune(s)); if (SC.updateHome) SC.updateHome(); };
SC.sumSize = (arr, f = (x) => x.size) => arr.reduce((s, x) => s + f(x), 0);

SC.stat = (key, text) => { const el = document.getElementById(key + 'Status'); if (el) el.textContent = text || ''; };
})();
