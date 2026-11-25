(function () {
'use strict';
const { h, fmt, icon, chk, tag } = SC;

// Quản lý ứng dụng: app nào của hệ thống, app nào lâu chưa dùng, app nào lớn, gỡ vào Thùng rác
const DAY = 86400000;
const BIG = 500 * 1024 * 1024;
const FILTERS = [['all', 'Tất cả'], ['stale', 'Lâu chưa dùng'], ['big', 'Lớn hơn 500 MB'], ['user', 'Bên thứ ba'], ['apple', 'Của Apple'], ['system', 'Hệ thống']];
const KIND = { system: ['Hệ thống, không gỡ được', 'review'], apple: ['Của Apple', 'hide'], user: null };
let apps = [];
let filter = 'all';
let sort = 'size';
let staleDays = 180;
let withData = true;
let scanning = false;
const sel = new Set();
const open = new Set();

const body = () => document.getElementById('applistBody');
const total = (a) => a.size + (withData ? a.dataSize : 0);
const stale = (a) => a.kind !== 'system' && (a.lastUsed ? Date.now() - a.lastUsed > staleDays * DAY : (a.mtime && Date.now() - a.mtime > staleDays * DAY));

// Không rõ lần mở cuối thì dùng ngày cài/cập nhật, app hệ thống xếp cuối
const usedKey = (a) => (a.kind === 'system' ? Number.MAX_SAFE_INTEGER : a.lastUsed || a.mtime || 0);

function matches(a) {
  if (filter === 'stale') return stale(a);
  if (filter === 'big') return a.size + a.dataSize >= BIG;
  if (filter === 'all') return true;
  return a.kind === filter;
}

function updateFoot() {
  const picked = apps.filter((a) => sel.has(a.path));
  document.getElementById('applistSum').replaceChildren(
    h('b', {}, `${picked.length} ứng dụng · ${fmt(SC.sumSize(picked, total))}`),
    h('span', { class: 'muted' }, ' · vào Thùng rác, khôi phục được  '),
    h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: withData, onchange: (e) => { withData = e.target.checked; render(); } }), ' Gỡ cả dữ liệu đi kèm'));
  document.getElementById('applistTrash').disabled = picked.length === 0;
}

function lastUsedText(a) {
  if (a.lastUsed) return SC.ago(a.lastUsed);
  return a.kind === 'system' ? '—' : 'không rõ';
}

function row(a) {
  const isOpen = open.has(a.path);
  const can = a.kind !== 'system';
  const tile = h('span', { class: 'tile', style: { width: '34px', height: '34px' } }, icon('apps', 17));
  SC.lazyThumb(tile, a.path, 68);
  const k = KIND[a.kind];
  const head = h('div', { class: 'mrow' + (a.data.length ? ' click' : ''), onclick: a.data.length ? () => { if (isOpen) open.delete(a.path); else open.add(a.path); render(); } : null },
    h('span', { onclick: (e) => e.stopPropagation() }, chk(a.name, sel.has(a.path), (e) => {
      if (e.target.checked) sel.add(a.path); else sel.delete(a.path); updateFoot();
    })),
    tile,
    h('div', { class: 'info' },
      h('div', { class: 'nm' }, h('span', { class: 'ellip' }, a.name), a.version ? h('span', { class: 'muted sm' }, a.version) : null,
        k ? tag(k[0], k[1]) : null,
        stale(a) ? tag('Lâu chưa dùng', 'review') : null,
        a.running ? tag('Đang mở', 'safe') : null,
        a.appStore ? tag('App Store', '') : null),
      h('div', { class: 'muted sm ellip' }, SC.home(a.path))),
    h('span', { class: 'muted sm', style: { width: '96px' } }, lastUsedText(a)),
    h('span', { class: 'muted sm', style: { width: '120px', textAlign: 'right', whiteSpace: 'nowrap' } }, a.dataSize ? '+' + fmt(a.dataSize) + ' dữ liệu' : ''),
    h('span', { class: 'num', style: { width: '72px', textAlign: 'right' } }, fmt(a.size)),
    h('span', { class: 'rowact', onclick: (e) => e.stopPropagation() },
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(a.path) }, 'Hiện')),
    a.data.length ? icon(isOpen ? 'down' : 'chev', 16) : h('span', { style: { width: '16px' } }));
  const box = head.querySelector('input');
  if (!can) { box.disabled = true; box.title = 'Ứng dụng hệ thống, không gỡ được'; }
  if (!isOpen) return head;
  return [head, h('div', { class: 'jsub' }, h('div', { class: 'muted' }, 'Dữ liệu đi kèm (chỉ gỡ khi bật "Gỡ cả dữ liệu đi kèm"):'),
    a.data.map((d) => h('div', { class: 'srow' }, h('span', { class: 'path', title: d.path }, SC.home(d.path)), h('span', { class: 'num' }, fmt(d.size)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(d.path) }, 'Hiện'))))];
}

function summary() {
  const st = apps.filter(stale), big = apps.filter((a) => a.size + a.dataSize >= BIG), sys = apps.filter((a) => a.kind === 'system');
  const stat = (label, n, size, f) => h('button', { type: 'button', class: 'stat statbtn' + (filter === f ? ' on' : ''), onclick: () => { filter = f; render(); } },
    h('span', { class: 'muted' }, label), h('b', {}, String(n)), h('span', { class: 'muted sm' }, size));
  return h('div', { class: 'card stats' },
    stat('Tất cả ứng dụng', apps.length, fmt(SC.sumSize(apps, (a) => a.size + a.dataSize)), 'all'),
    stat(`Không dùng > ${Math.round(staleDays / 30)} tháng`, st.length, fmt(SC.sumSize(st, (a) => a.size + a.dataSize)) + ' có thể gỡ', 'stale'),
    stat('Lớn hơn 500 MB', big.length, fmt(SC.sumSize(big, (a) => a.size + a.dataSize)), 'big'),
    stat('Của hệ thống', sys.length, 'macOS cần, không gỡ được', 'system'));
}

function render() {
  const b = body();
  if (!apps.length) {
    SC.fill(b, h('div', { class: 'card intro' },
      h('b', {}, 'Xem toàn bộ ứng dụng để gỡ bớt'),
      h('ul', {}, h('li', {}, 'App nào của hệ thống (macOS cần, không gỡ được) và app nào của Apple cài thêm'),
        h('li', {}, 'App nào lâu chưa mở, theo dữ liệu Spotlight của macOS'),
        h('li', {}, 'App nào chiếm nhiều dung lượng, tính cả dữ liệu đi kèm trong ~/Library')),
      h('div', { class: 'muted' }, 'Gỡ là chuyển vào Thùng rác, khôi phục được. App đang mở phải thoát trước.')));
    updateFoot(); return;
  }
  const shown = apps.filter(matches).sort(sort === 'size' ? (x, y) => total(y) - total(x)
    : sort === 'used' ? (x, y) => usedKey(x) - usedKey(y) : (x, y) => x.name.localeCompare(y.name, 'vi'));
  const sc = b.scrollTop;
  SC.fill(b, summary(),
    h('div', { class: 'chips' }, FILTERS.map(([k, t]) => h('button', { type: 'button', class: 'chip dark' + (filter === k ? ' on' : ''), onclick: () => { filter = k; render(); } }, t)),
      h('span', { style: { flex: '1' } }),
      h('label', { class: 'muted' }, 'Lâu chưa dùng ', h('select', { 'aria-label': 'Ngưỡng lâu chưa dùng', onchange: (e) => { staleDays = Number(e.target.value); render(); } },
        [[90, '> 3 tháng'], [180, '> 6 tháng'], [365, '> 1 năm']].map(([v, t]) => h('option', { value: v, selected: v === staleDays }, t)))),
      h('label', { class: 'muted' }, 'Sắp xếp ', h('select', { 'aria-label': 'Sắp xếp', onchange: (e) => { sort = e.target.value; render(); } },
        [['size', 'Lớn nhất'], ['used', 'Lâu chưa dùng nhất'], ['name', 'Tên']].map(([v, t]) => h('option', { value: v, selected: v === sort }, t))))),
    shown.length ? h('div', { class: 'card' }, shown.map(row)) : h('div', { class: 'empty' }, 'Không có ứng dụng nào khớp bộ lọc.'));
  b.scrollTop = sc;
  updateFoot();
}

async function scan() {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('applistScan'); btn.disabled = true; btn.textContent = 'Đang quét...';
  try {
    apps = await api.appList();
    SC.state.applist = apps;
    for (const p of [...sel]) if (!apps.some((a) => a.path === p)) sel.delete(p);
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.disabled = false; btn.textContent = 'Quét lại'; SC.stat('applist', '');
  render();
  if (SC.updateHome) SC.updateHome();
}

async function uninstall() {
  const paths = apps.filter((a) => sel.has(a.path) && a.kind !== 'system').map((a) => a.path);
  const r = await api.uninstall(paths, withData);
  if (r.error) { SC.toast(r.error); return; }
  if (r.cancelled) return;
  const gone = new Set(r.removed);
  apps = apps.filter((a) => !gone.has(a.path));
  for (const p of gone) sel.delete(p);
  SC.trashed += r.freed; SC.refreshDisk();
  SC.toast(`Đã gỡ ${r.done} ứng dụng, chuyển ${fmt(r.freed)} vào Thùng rác` + (r.failed.length ? ` · không gỡ được: ${r.failed.join(', ')}` : ''));
  render();
}

SC.pages.applist = { scan, onShow: render, prune: () => {} };
render();
document.getElementById('applistScan').addEventListener('click', scan);
document.getElementById('applistTrash').addEventListener('click', uninstall);
SC.status.applist = (t) => SC.stat('applist', t);
})();
