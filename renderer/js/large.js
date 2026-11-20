(function () {
'use strict';
const { h, fmt, icon, chk, tag } = SC;
const KINDS = [['all', 'Tất cả'], ['video', 'Video'], ['archive', 'Nén'], ['disk', 'Đĩa và cài đặt'], ['doc', 'Tài liệu'], ['image', 'Ảnh'], ['audio', 'Âm thanh'], ['other', 'Khác']];
const KIND_LABEL = { video: 'Video', archive: 'Nén', disk: 'Đĩa và cài đặt', doc: 'Tài liệu', image: 'Ảnh', audio: 'Âm thanh', other: 'Khác' };
const KIND_ICON = { video: 'film', archive: 'zip', disk: 'disc', doc: 'doc', image: 'image', audio: 'doc', other: 'doc' };
const THUMB_KINDS = new Set(['video', 'image', 'doc']);
const sel = new Set();
let items = [];
let filter = 'all';
let minMB = 100;
let months = 0;
let scanning = false;

const body = () => document.getElementById('bigBody');

function updateFoot() {
  const picked = items.filter((i) => sel.has(i.path));
  document.getElementById('bigSum').replaceChildren(
    h('b', {}, `${picked.length} file · ${fmt(SC.sumSize(picked))}`),
    h('span', { class: 'muted' }, ' đã chọn · chuyển vào Thùng rác, khôi phục được'));
  document.getElementById('bigTrash').disabled = picked.length === 0;
}

function select(label, value, opts, onchange) {
  return h('label', { class: 'muted' }, label + ' ', h('select', { 'aria-label': label, onchange: (e) => onchange(Number(e.target.value)) },
    opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
}

function render() {
  const b = body();
  const counts = {};
  for (const i of items) { const c = counts[i.kind] || (counts[i.kind] = { n: 0, size: 0 }); c.n++; c.size += i.size; }
  const chips = KINDS.filter(([k]) => k === 'all' || counts[k]).map(([k, t]) => {
    const size = k === 'all' ? SC.sumSize(items) : counts[k].size;
    return h('button', { type: 'button', class: 'chip dark' + (filter === k ? ' on' : ''), onclick: () => { filter = k; render(); } }, `${t} ${fmt(size)}`);
  });
  const shown = items.filter((i) => filter === 'all' || i.kind === filter);
  const rows = shown.slice(0, 200).map((it) => {
    const thumb = h('span', { class: 'tile' }, icon(KIND_ICON[it.kind] || 'doc', 18, 1.7));
    if (THUMB_KINDS.has(it.kind)) SC.lazyThumb(thumb, it.path, 128);
    return h('div', { class: 'trow' },
      chk(it.name, sel.has(it.path), (e) => { if (e.target.checked) sel.add(it.path); else sel.delete(it.path); updateFoot(); }),
      thumb,
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { class: 'ellip', style: { fontWeight: '600' } }, it.name), h('div', { class: 'muted ellip', style: { fontSize: '12px' } }, SC.home(it.dir))),
      h('span', { style: { width: '104px' } }, tag(KIND_LABEL[it.kind] || 'Khác')),
      h('span', { class: 'muted', style: { width: '96px', fontSize: '12px' } }, SC.ago(it.lastUsed)),
      h('span', { class: 'num', style: { width: '68px', textAlign: 'right' } }, fmt(it.size)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.quicklook(it.path) }, 'Xem trước'));
  });
  SC.fill(b,
    h('div', { class: 'chips' }, chips, h('span', { style: { flex: '1' } }),
      select('Lớn hơn', minMB, [[50, '50 MB'], [100, '100 MB'], [250, '250 MB'], [500, '500 MB'], [1000, '1 GB']], (v) => { minMB = v; scan(); }),
      select('Chưa mở', months, [[0, 'Bất kỳ'], [3, '> 3 tháng'], [6, '> 6 tháng'], [12, '> 12 tháng']], (v) => { months = v; scan(); })),
    items.length === 0 ? h('div', { class: 'empty' }, 'Không có file nào khớp bộ lọc.') :
      h('div', { class: 'card' },
        h('div', { class: 'thead' }, h('span', { style: { width: '16px' } }), h('span', { style: { width: '56px' } }, 'XEM'), h('span', { style: { flex: '1' } }, 'TÊN VÀ VỊ TRÍ'),
          h('span', { style: { width: '104px' } }, 'LOẠI'), h('span', { style: { width: '96px' } }, 'MỞ LẦN CUỐI'), h('span', { style: { width: '68px', textAlign: 'right' } }, 'DUNG LƯỢNG'), h('span', { style: { width: '70px' } })),
        rows),
    shown.length > 200 ? h('div', { class: 'muted' }, `Đang hiện 200 file lớn nhất trong ${shown.length}.`) : null);
  updateFoot();
}

async function scan() {
  const btn = document.getElementById('bigScan');
  if (scanning) { api.cancel('big'); return; }
  scanning = true; btn.textContent = 'Dừng';
  try {
    const roots = await api.roots('big');
    const res = await api.bigScan(roots, { minSize: minMB * 1024 * 1024, olderThanDays: months * 30 });
    if (!res.cancelled) {
      items = res.items; SC.state.big = items; sel.clear(); render();
      SC.badge('big', fmt(SC.sumSize(items)));
      SC.stat('big', `${items.length} file`);
    } else SC.stat('big', 'Đã dừng');
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.textContent = 'Quét lại';
  if (SC.updateHome) SC.updateHome();
}

document.getElementById('bigScan').addEventListener('click', scan);
document.getElementById('bigTrash').addEventListener('click', async () => {
  const paths = [...sel];
  const r = await api.trash('big', paths);
  if (r.error) return SC.toast(r.error);
  if (r.cancelled) return;
  SC.toast(`Đã chuyển ${r.done} file vào Thùng rác, giải phóng ${fmt(r.freed)}` + (r.failed.length ? ` · lỗi: ${r.failed.join(', ')}` : ''));
  SC.trashed += r.freed; SC.refreshDisk();
  SC.pruneAll(paths.filter((p) => !r.failed.includes(p.split('/').pop())));
});
SC.pages.big = { scan, prune(gone) {
  if (!items.some((i) => gone.has(i.path))) return;
  items = items.filter((i) => !gone.has(i.path)); SC.state.big = items; gone.forEach((p) => sel.delete(p));
  render(); SC.badge('big', fmt(SC.sumSize(items)));
} };
SC.status.big = (t) => SC.stat('big', t);
})();
