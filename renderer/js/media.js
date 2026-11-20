(function () {
'use strict';
const { h, fmt, icon, chk, tag } = SC;
const CATS = [
  ['all', 'Tất cả'], ['bigvideo', 'Video lớn'], ['screenrec', 'Quay màn hình'], ['screenshot', 'Ảnh chụp màn hình'],
  ['similar', 'Ảnh giống nhau'], ['old', 'Ảnh và video cũ chưa mở'],
];
const PAGE = 120;
const sel = new Set();
let items = [];
let cat = 'all';
let view = 'grid';
let current = null;
let limit = PAGE;
let scanning = false;

const body = () => document.getElementById('mediaBody');
const inCat = (i, c) => c === 'all' || i.tags.includes(c);
const ICON = { video: 'play', photo: 'image', screen: 'window' };

function filtered() {
  const list = items.filter((i) => inCat(i, cat));
  if (cat === 'similar') list.sort((a, b) => (a.group - b.group) || (b.size - a.size));
  return list;
}

function updateFoot() {
  const picked = items.filter((i) => sel.has(i.path));
  document.getElementById('mediaSum').replaceChildren(
    h('b', {}, `${picked.length} mục · ${fmt(SC.sumSize(picked))}`),
    h('span', { class: 'muted' }, ' đã chọn · thumbnail tạo ngay trên máy, không gửi đi đâu'));
  document.getElementById('mediaTrash').disabled = picked.length === 0;
}

function badgeFor(it, groupSizes) {
  if (it.tags.includes('similar')) return `Giống ×${groupSizes.get(it.group)}`;
  if (it.kind === 'video') return 'Video';
  if (it.kind === 'screen') return 'Màn hình';
  return (it.name.split('.').pop() || 'Ảnh').toUpperCase();
}

function toggle(it, on) { if (on) sel.add(it.path); else sel.delete(it.path); updateFoot(); }

function gridItem(it, groupSizes) {
  const thumb = h('div', { class: 'mthumb' }, icon(ICON[it.kind], 26, 1.6));
  SC.lazyThumb(thumb, it.path, 240);
  thumb.append(
    h('span', { class: 'ck', onclick: (e) => e.stopPropagation() }, chk(it.name, sel.has(it.path), (e) => toggle(it, e.target.checked))),
    h('span', { class: 'bd' }, badgeFor(it, groupSizes)));
  // lazyThumb thay toàn bộ nội dung: gắn lại các lớp phủ sau khi tải xong
  const origCb = thumb._job.cb;
  thumb._job.cb = (url) => { const keep = [...thumb.querySelectorAll('.ck, .bd')]; origCb(url); keep.forEach((k) => thumb.append(k)); };
  return h('div', { class: 'mitem' + (current && current.path === it.path ? ' sel' : ''), onclick: () => { current = it; render(); } },
    thumb, h('div', { class: 'mmeta' }, h('span', { class: 'ellip', style: { fontWeight: '500' } }, it.name), h('span', { class: 'muted', style: { whiteSpace: 'nowrap' } }, fmt(it.size))));
}

function listRow(it, groupSizes) {
  const t = h('span', { class: 'tile', style: { width: '56px', height: '40px' } }, icon(ICON[it.kind], 18, 1.7));
  SC.lazyThumb(t, it.path, 128);
  return h('div', { class: 'trow' + (current && current.path === it.path ? ' sel' : ''), onclick: () => { current = it; render(); } },
    h('span', { onclick: (e) => e.stopPropagation() }, chk(it.name, sel.has(it.path), (e) => toggle(it, e.target.checked))), t,
    h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { class: 'ellip', style: { fontWeight: '600' } }, it.name), h('div', { class: 'muted ellip', style: { fontSize: '12px' } }, SC.home(it.dir))),
    tag(badgeFor(it, groupSizes)), h('span', { class: 'num', style: { width: '70px', textAlign: 'right' } }, fmt(it.size)));
}

function previewPanel() {
  const it = current;
  if (!it) return h('aside', { class: 'card preview' }, h('div', { class: 'empty', style: { padding: '40px 0' } }, 'Bấm vào một ảnh hoặc video để xem trước.'));
  const thumb = h('div', { class: 'pv-thumb' }, icon(ICON[it.kind], 30, 1.5));
  SC.lazyThumb(thumb, it.path, 640);
  const origCb = thumb._job.cb;
  if (it.kind === 'video') {
    thumb._job.cb = (url) => { origCb(url); thumb.append(h('span', { class: 'pv-play' }, icon('play', 22, 1.6))); };
    thumb.append(h('span', { class: 'pv-play' }, icon('play', 22, 1.6)));
  }
  const tags = [tag(it.kind === 'video' ? 'Video' : 'Ảnh')];
  const names = { bigvideo: 'Video lớn', screenrec: 'Quay màn hình', screenshot: 'Ảnh chụp màn hình', similar: 'Giống nhau', old: 'Cũ chưa mở' };
  for (const t of it.tags) if (names[t]) tags.push(tag(names[t]));
  const meta = (k, v) => h('div', {}, h('span', {}, k), h('span', {}, v));
  return h('aside', { class: 'card preview', 'aria-label': 'Xem trước' }, thumb,
    h('div', {}, h('div', { class: 'pv-title' }, it.name), h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, tags)),
    h('div', { class: 'pv-meta' }, meta('Dung lượng', fmt(it.size)), meta('Sửa lần cuối', SC.fdate(it.mtime)), meta('Mở lần cuối', SC.ago(Math.max(it.atime, it.mtime))), meta('Vị trí', SC.home(it.dir))),
    h('div', { class: 'pv-actions' },
      SC.btn('Xem toàn màn hình', '', () => api.quicklook(it.path), 'eye'),
      SC.btn('Hiện trong Finder', '', () => api.reveal(it.path), 'folder'),
      SC.btn('Chuyển vào Thùng rác', 'danger-outline', () => trash([it.path]), 'junk')));
}

function render() {
  const b = body();
  if (!items.length) { b.replaceChildren(h('div', { class: 'empty' }, 'Không tìm thấy ảnh hoặc video nào.')); updateFoot(); return; }
  const groupSizes = new Map();
  for (const i of items) if (i.group) groupSizes.set(i.group, (groupSizes.get(i.group) || 0) + 1);
  const list = filtered();
  const chips = CATS.map(([k, t]) => {
    const sub = items.filter((i) => inCat(i, k));
    return h('button', { type: 'button', class: 'chip dark' + (cat === k ? ' on' : ''), onclick: () => { cat = k; limit = PAGE; render(); } }, `${t} ${fmt(SC.sumSize(sub))}`);
  });
  const shown = list.slice(0, limit);
  const content = view === 'grid'
    ? h('div', { class: 'mgrid' }, shown.map((i) => gridItem(i, groupSizes)))
    : h('div', { class: 'mlist', style: { overflow: 'auto' } }, shown.map((i) => listRow(i, groupSizes)));
  const more = list.length > limit ? h('div', { style: { padding: '0 14px 14px' } }, SC.btn(`Xem thêm (${list.length - limit})`, '', () => { limit += PAGE; render(); })) : null;
  const smart = cat === 'similar' ? SC.btn('Giữ bản lớn nhất mỗi nhóm', '', () => {
    const seen = new Set();
    for (const i of list) { if (!seen.has(i.group)) { seen.add(i.group); sel.delete(i.path); } else sel.add(i.path); }
    render();
  }) : null;
  const scroll = b.querySelector('.mgrid, .mlist');
  const top = scroll ? scroll.scrollTop : 0;
  b.replaceChildren(
    h('div', { class: 'chips' }, chips),
    h('div', { class: 'mwrap' },
      h('div', { class: 'card mgrid-card' },
        h('div', { class: 'mhead' }, h('span', { class: 'muted' }, 'Sắp xếp theo dung lượng · ', h('b', { style: { color: 'var(--txt)' } }, `${list.length} mục`)),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, smart,
            h('div', { class: 'seg' }, h('button', { type: 'button', class: view === 'grid' ? 'on' : '', onclick: () => { view = 'grid'; render(); } }, 'Lưới'),
              h('button', { type: 'button', class: view === 'list' ? 'on' : '', onclick: () => { view = 'list'; render(); } }, 'Danh sách')))),
        content, more),
      previewPanel()));
  const sc2 = b.querySelector('.mgrid, .mlist'); if (sc2) sc2.scrollTop = top;
  updateFoot();
}

async function trash(paths) {
  const r = await api.trash('media', paths);
  if (r.error) return SC.toast(r.error);
  if (r.cancelled) return;
  SC.toast(`Đã chuyển ${r.done} mục vào Thùng rác, giải phóng ${fmt(r.freed)}` + (r.failed.length ? ` · lỗi: ${r.failed.join(', ')}` : ''));
  SC.trashed += r.freed; SC.refreshDisk();
  const failedNames = new Set(r.failed);
  SC.pruneAll(paths.filter((p) => !failedNames.has(p.split('/').pop())));
}
function prune(gone) {
  if (!items.some((i) => gone.has(i.path))) return;
  items = items.filter((i) => !gone.has(i.path)); SC.state.media = items;
  gone.forEach((p) => sel.delete(p));
  if (current && gone.has(current.path)) current = null;
  render(); SC.badge('media', fmt(SC.sumSize(items)));
}

async function scan() {
  const btn = document.getElementById('mediaScan');
  if (scanning) { api.cancel('media'); return; }
  scanning = true; btn.textContent = 'Dừng';
  try {
    const res = await api.mediaScan(await api.roots('media'));
    if (!res.cancelled) {
      items = res.items; SC.state.media = items; sel.clear(); current = items[0] || null; limit = PAGE; render();
      SC.badge('media', fmt(SC.sumSize(items))); SC.stat('media', `${items.length} mục`);
    } else SC.stat('media', 'Đã dừng');
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.textContent = 'Quét lại';
  if (SC.updateHome) SC.updateHome();
}

document.getElementById('mediaScan').addEventListener('click', scan);
document.getElementById('mediaTrash').addEventListener('click', () => trash([...sel]));
SC.pages.media = { scan, prune };
SC.status.media = (t) => SC.stat('media', t);
})();
