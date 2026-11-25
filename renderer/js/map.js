(function () {
'use strict';
const { h, fmt, icon, tag } = SC;

// Bản đồ dung lượng: đi sâu từng thư mục, lộ ra file ẩn, ~/Library, bên trong gói
const WHY = {
  dot: ['Ẩn: tên có dấu chấm đầu', 'hide'],
  library: ['Trong Thư viện, Finder ẩn', 'hide'],
  package: ['Bên trong gói', 'hide'],
  system: ['Thư mục hệ thống', 'hide'],
};
let res = null;
let stack = [];        // các node từ gốc tới thư mục đang xem
let scope = 'home';
let custom = null;
let onlyHidden = false;
let scanning = false;

const body = () => document.getElementById('mapBody');
const show = (p) => (p || '').replace(/^\/System\/Volumes\/Data(?=\/)/, '');
const cur = () => stack[stack.length - 1];

function explainedBox() {
  const d = res.disk;
  const measured = res.root ? res.root.size : 0;
  const parts = [h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Đã đo'), h('b', {}, fmt(measured)),
    h('span', { class: 'muted sm' }, `${res.files.toLocaleString('vi-VN')} file · ${(res.ms / 1000).toFixed(0)} giây`))];
  if (d) {
    const used = d.total - d.free;
    parts.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Ổ đĩa đang dùng'), h('b', {}, fmt(used)), h('span', { class: 'muted sm' }, `Còn trống ${fmt(d.free)}`)));
    if (res.scope === 'disk') {
      // Bản đồ chỉ đo volume Dữ liệu. Swap, macOS, Preboot, Recovery nằm ở volume khác nên trừ riêng ra.
      const vols = res.volumes || [];
      const dataVol = vols.find((v) => v.role === 'Data');
      const others = vols.filter((v) => v.role !== 'Data' && v.used > 0);
      const gap = Math.max(0, (dataVol ? dataVol.used : used) - measured);
      const note = others.length
        ? 'Trong phần Dữ liệu: thư mục bị chặn, snapshot. Ngoài ra ' + others.slice(0, 3).map((v) => `${v.label.split(' (')[0]} ${fmt(v.used)}`).join(', ') + ' nằm ở volume khác'
        : 'Snapshot, swap, macOS, thư mục bị chặn';
      parts.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Chưa giải thích được'), h('b', { class: gap > used * 0.15 ? 'warn' : '' }, fmt(gap)),
        h('span', { class: 'muted sm', title: note }, note)));
    }
  }
  return h('div', { class: 'card stats' }, parts);
}

function deniedBanner() {
  if (!res.denied.length) return null;
  return h('div', { class: 'banner' },
    icon('lock', 18),
    h('div', { style: { flex: '1', minWidth: '0' } },
      h('b', {}, `macOS chặn đọc ${res.denied.length} thư mục, nên phần đó chưa được tính.`),
      h('div', { class: 'muted sm ellip' }, res.denied.slice(0, 4).map(show).map(SC.home).join(' · '))),
    SC.btn('Cấp Full Disk Access', 'sm', () => api.openSettings('fda')));
}

function crumbs() {
  return h('div', { class: 'crumbs' }, stack.map((n, i) => [
    i ? h('span', { class: 'muted' }, '›') : null,
    h('button', { type: 'button', class: 'crumb' + (i === stack.length - 1 ? ' on' : ''), onclick: () => { stack = stack.slice(0, i + 1); render(); } },
      i === 0 ? SC.home(show(n.path)) : n.name)]),
  h('span', { style: { flex: '1' } }),
  h('label', { class: 'muted sm' }, h('input', { type: 'checkbox', checked: onlyHidden, onchange: (e) => { onlyHidden = e.target.checked; render(); } }), ' Chỉ hiện mục Finder không thấy'));
}

function row(n, parentSize) {
  const pct = parentSize ? n.size / parentSize : 0;
  const why = n.why && WHY[n.why];
  const canOpen = n.dir && ((n.children && n.children.length) || n.denied);
  return h('div', { class: 'mrow' + (canOpen ? ' click' : ''), onclick: canOpen && !n.denied ? () => { stack.push(n); render(); } : null },
    h('span', { class: 'tile', style: { width: '30px', height: '30px' } }, icon(n.denied ? 'lock' : n.dir ? (n.pkg ? 'box' : 'folder') : 'doc', 16)),
    h('div', { class: 'info' },
      h('div', { class: 'nm' }, h('span', { class: 'ellip' }, n.name),
        why ? tag(why[0], why[1]) : null,
        n.pkg ? tag('Gói, Finder hiện như 1 file', 'hide') : null,
        n.denied ? tag('Bị macOS chặn đọc', 'review') : null),
      h('div', { class: 'bar' }, h('i', { style: { width: Math.max(0.5, pct * 100).toFixed(1) + '%' } }))),
    h('span', { class: 'muted sm', style: { width: '86px', textAlign: 'right' } }, n.dir ? `${n.files.toLocaleString('vi-VN')} file` : SC.ago(n.mtime)),
    h('span', { class: 'num', style: { width: '78px', textAlign: 'right' } }, fmt(n.size)),
    h('span', { class: 'rowact', onclick: (e) => e.stopPropagation() },
      h('button', { class: 'btn sm', type: 'button', title: 'Mở trong Finder', onclick: () => api.reveal(n.path) }, 'Hiện'),
      h('button', { class: 'btn sm', type: 'button', title: 'Sao chép đường dẫn', onclick: () => { api.copy(show(n.path)); SC.toast('Đã sao chép đường dẫn'); } }, icon('copy', 14)),
      n.denied ? h('span', { class: 'btn-ph' }) : h('button', { class: 'btn sm danger', type: 'button', title: 'Chuyển vào Thùng rác', onclick: () => trash(n) }, icon('junk', 14))),
    canOpen && !n.denied ? icon('chev', 16) : h('span', { style: { width: '16px' } }));
}

function render() {
  const b = body();
  if (!res) {
    SC.fill(b, h('div', { class: 'card intro' },
      h('b', {}, 'Tìm chỗ đang chiếm dung lượng, kể cả những thứ Finder không cho thấy'),
      h('ul', {}, h('li', {}, 'File và thư mục ẩn (tên bắt đầu bằng dấu chấm)'),
        h('li', {}, 'Thư mục Thư viện (~/Library): cache, dữ liệu app, máy ảo, simulator'),
        h('li', {}, 'Bên trong các "gói" như thư viện Ảnh, ứng dụng, máy ảo')),
      h('div', { class: 'muted' }, 'Chọn phạm vi rồi bấm "Quét". "Toàn ổ đĩa" cho biết thêm phần dung lượng chưa giải thích được (snapshot, swap...). Mục nào xóa cũng vào Thùng rác.')));
    return;
  }
  if (!res.root) { SC.fill(b, h('div', { class: 'empty' }, 'Không đọc được thư mục này.')); return; }
  const n = cur();
  const kids = (n.children || []).filter((k) => !onlyHidden || k.why || k.pkg || k.denied);
  const sc = b.scrollTop;
  SC.fill(b, explainedBox(), deniedBanner(),
    h('div', { class: 'card' }, crumbs(),
      kids.length ? kids.map((k) => row(k, n.size)) : h('div', { class: 'empty' }, onlyHidden ? 'Không có mục ẩn đáng kể ở đây.' : 'Thư mục trống.'),
      n.other && n.other.count && !onlyHidden ? h('div', { class: 'mrow muted' }, h('span', { style: { width: '30px' } }),
        h('div', { class: 'info' }, `${n.other.count.toLocaleString('vi-VN')} mục nhỏ khác`), h('span', { class: 'num', style: { width: '78px', textAlign: 'right' } }, fmt(n.other.size))) : null));
  b.scrollTop = sc;
}

function subtract(node, size) {
  for (const a of stack) { a.size -= size; }
  const parent = cur();
  parent.children = parent.children.filter((c) => c !== node);
  res.root.size = stack[0].size;
}

async function trash(n) {
  const r = await api.trash('map', [n.path]);
  if (r.error) { SC.toast(r.error); return; }
  if (r.cancelled) return;
  if (r.done) { subtract(n, n.size); SC.trashed += r.freed; SC.refreshDisk(); SC.pruneAll([n.path]); SC.toast(`Đã chuyển vào Thùng rác (${fmt(r.freed)})`); }
  else SC.toast('Không chuyển được: ' + (r.failed || []).join(', '));
  render();
}

async function scan() {
  const btn = document.getElementById('mapScan');
  if (scanning) { api.cancel('map'); return; }
  if (scope === 'custom') {
    const picked = await api.pickFolder();
    if (!picked.length) return;
    custom = picked[0];
  }
  scanning = true; SC.setScanButton(btn, true);
  SC.stat('map', 'Đang đo...');
  try {
    const r = await api.mapScan(scope, custom);
    if (r.cancelled) SC.toast('Đã dừng, kết quả chỉ là một phần');
    res = r; stack = r.root ? [r.root] : [];
    SC.state.map = r;
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; SC.setScanButton(btn, false, 'Quét lại'); SC.stat('map', '');
  render();
  if (SC.updateHome) SC.updateHome();
}

function scopeSeg() {
  const seg = document.getElementById('mapScope');
  SC.fill(seg, [['home', 'Thư mục nhà'], ['disk', 'Toàn ổ đĩa'], ['custom', 'Chọn thư mục...']].map(([k, t]) =>
    h('button', { type: 'button', class: scope === k ? 'on' : '', onclick: () => { scope = k; scopeSeg(); } }, t)));
}

SC.pages.map = {
  scan,
  onShow: render,
  prune: () => {},
};
scopeSeg();
render();
document.getElementById('mapScan').addEventListener('click', scan);
SC.status.map = (t) => SC.stat('map', t);
})();
