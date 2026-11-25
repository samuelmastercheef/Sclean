(function () {
'use strict';
const { h, fmt, icon, chk, tag, tile } = SC;
const sel = new Set();
const open = new Set();
let cats = [];
let scanning = false;

const body = () => document.getElementById('junkBody');

function selectedPaths() { return [...sel]; }
function selectedSize() {
  let s = 0;
  for (const c of cats) for (const it of c.items) if (sel.has(it.path)) s += it.size;
  return s;
}
function safeTotal() { return SC.sumSize(cats.filter((c) => c.kind === 'safe'), (c) => c.total); }
function safePaths() { return cats.filter((c) => c.kind === 'safe').flatMap((c) => c.items.map((i) => i.path)); }

function updateFoot() {
  const n = sel.size;
  const sum = document.getElementById('junkSum');
  sum.replaceChildren(h('b', {}, fmt(selectedSize())), h('span', { class: 'muted' }, ` đã chọn · ${n} mục · ` + (SC.settings && SC.settings.permanentDelete ? 'cache, log, node_modules bị xóa hẳn, mục còn lại vào Thùng rác' : 'tất cả vào Thùng rác, khôi phục được')));
  document.getElementById('junkClean').disabled = n === 0;
}

function catRow(c) {
  const all = c.items.length > 0 && c.items.every((i) => sel.has(i.path));
  const some = c.items.some((i) => sel.has(i.path));
  const box = chk(c.name, all, (e) => {
    for (const it of c.items) { if (e.target.checked) sel.add(it.path); else sel.delete(it.path); }
    render();
  });
  box.indeterminate = some && !all; box.disabled = c.items.length === 0;
  const isOpen = open.has(c.id);
  const row = h('div', { class: 'jrow' }, box,
    h('span', { class: 'tile acc', style: { width: '32px', height: '32px' } }, icon(c.icon, 17)),
    h('div', { class: 'info' },
      h('div', { class: 'nm' }, c.name, c.kind === 'safe' ? tag('An toàn', 'safe') : tag('Xem lại', 'review')),
      h('div', { class: 'ds' }, `${c.desc} · ${c.items.length} mục`)),
    h('span', { class: 'num' }, fmt(c.total)),
    h('button', { class: 'toggle', type: 'button', 'aria-label': isOpen ? 'Thu gọn' : 'Xem chi tiết', 'aria-expanded': String(isOpen),
      onclick: () => { if (isOpen) open.delete(c.id); else open.add(c.id); render(); } }, icon(isOpen ? 'down' : 'chev', 16)));
  const out = [row];
  if (isOpen && c.items.length) {
    out.push(h('div', { class: 'jsub' }, c.items.slice(0, 80).map((it) => h('div', { class: 'srow' },
      chk(it.path, sel.has(it.path), (e) => { if (e.target.checked) sel.add(it.path); else sel.delete(it.path); render(); }),
      h('span', { class: 'path', title: it.path }, SC.home(it.path)),
      h('span', { class: 'num' }, fmt(it.size)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(it.path) }, 'Hiện')))));
  }
  return out;
}

function render() {
  const b = body();
  const scroll = b.scrollTop;
  if (!cats.length) { b.replaceChildren(h('div', { class: 'empty' }, 'Bấm "Quét" để bắt đầu.')); updateFoot(); return; }
  const safe = cats.filter((c) => c.kind === 'safe'), review = cats.filter((c) => c.kind !== 'safe');
  b.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'section' }, h('b', {}, 'An toàn để dọn'), h('span', { class: 'muted' }, 'Tick sẵn · tự tạo lại khi cần')),
    safe.map(catRow),
    h('div', { class: 'section' }, h('b', {}, 'Cần xem lại'), h('span', { class: 'muted' }, 'Không tick sẵn · bạn quyết định')),
    review.map(catRow)));
  b.scrollTop = scroll;
  updateFoot();
  SC.badge('junk', fmt(SC.sumSize(cats, (c) => c.total)));
}

async function scan() {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('junkScan'); btn.disabled = true; btn.textContent = 'Đang quét...';
  try {
    cats = await api.junkScan();
    SC.state.junk = cats;
    { const tr = cats.find((c) => c.id === 'trash'); SC.trashed = tr ? tr.total : 0; if (SC.refreshDisk) SC.refreshDisk(); }
    sel.clear();
    for (const p of safePaths()) sel.add(p);
    render();
    SC.stat('junk', '');
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.disabled = false; btn.textContent = 'Quét lại';
  if (SC.updateHome) SC.updateHome();
}

async function clean(paths) {
  const r = await api.junkClean(paths);
  if (r.cancelled) return;
  SC.toast(`Đã giải phóng ${fmt(r.freed)}` + (r.failed ? ` (${r.failed} mục không xóa được)` : ''));
  SC.refreshDisk();
  await scan();
}

SC.pages.junk = {
  scan,
  safeTotal,
  hasScan: () => cats.length > 0,
  cleanSafe: () => clean(safePaths()),
};
document.getElementById('junkScan').addEventListener('click', scan);
document.getElementById('junkClean').addEventListener('click', () => clean(selectedPaths()));
SC.status.junk = (t) => SC.stat('junk', t);
})();
