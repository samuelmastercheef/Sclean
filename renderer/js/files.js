(function () {
'use strict';
const { h, fmt, icon, chk } = SC;
let folders = [];
let minMB = 1;
let groups = [];
let scanning = false;
let ready = false;
const body = () => document.getElementById('filesBody');
const IMG_VID = /\.(jpe?g|png|heic|gif|tiff?|webp|mov|mp4|m4v|mkv|avi|webm|pdf)$/i;

function picked() { return [...document.querySelectorAll('#filesBody .dchk:checked')]; }
function updateFoot() {
  const sel = picked();
  const size = sel.reduce((s, c) => s + Number(c.dataset.size), 0);
  document.getElementById('filesSum').replaceChildren(h('b', {}, `${sel.length} file · ${fmt(size)}`),
    h('span', { class: 'muted' }, ' đã chọn · chuyển vào Thùng rác, khôi phục được'));
  document.getElementById('filesTrash').disabled = sel.length === 0;
}

function autoSelect(mode) {
  document.querySelectorAll('#filesBody .dgroup').forEach((g) => {
    const boxes = [...g.querySelectorAll('.dchk')];
    boxes.forEach((b) => { b.checked = mode !== 'none'; });
    g.querySelectorAll('.keep').forEach((k) => { k.textContent = ''; });
    if (mode === 'none') return;
    const keepIdx = mode === 'old' ? 0 : boxes.length - 1; // đã sắp từ cũ đến mới
    boxes[keepIdx].checked = false;
    g.querySelectorAll('.keep')[keepIdx].textContent = 'GIỮ';
  });
  updateFoot();
}

function groupCard(g) {
  const first = g.files[0].path;
  const t = h('span', { class: 'tile', style: { width: '40px', height: '40px' } }, icon('files', 18, 1.7));
  if (IMG_VID.test(first)) SC.lazyThumb(t, first, 96);
  const card = h('div', { class: 'card group dgroup' },
    h('div', { class: 'ghead' }, t,
      h('div', { class: 'gi' }, h('div', { class: 'ellip', style: { fontWeight: '600' } }, first.split('/').pop()), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${g.files.length} bản giống nhau · mỗi bản ${fmt(g.size)}`)),
      h('span', { class: 'num' }, fmt(g.size * (g.files.length - 1)))));
  for (const f of g.files) {
    const box = chk(f.path, false, (e) => {
      const all = [...card.querySelectorAll('.dchk')];
      if (all.every((b) => b.checked)) { e.target.checked = false; SC.toast('Phải giữ lại ít nhất một bản'); }
      updateFoot();
    });
    box.className = 'dchk'; box.dataset.size = g.size; box.dataset.path = f.path;
    card.append(h('div', { class: 'grow' }, box, h('span', { class: 'keep' }), h('span', { class: 'path', title: f.path }, SC.home(f.path)),
      h('span', { class: 'muted' }, SC.fdate(f.mtime)), h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(f.path) }, 'Hiện')));
  }
  return card;
}

function drawFolders() {
  const wrap = document.getElementById('folderChips');
  wrap.replaceChildren(...folders.map((f) => h('button', { type: 'button', class: 'chip' + (f.on ? ' on' : ''), title: 'Bấm để bật/tắt', 'aria-pressed': String(f.on),
    onclick: () => { f.on = !f.on; drawFolders(); } }, icon('folder', 14), f.path.split('/').pop())));
  wrap.append(h('button', { type: 'button', class: 'chip dashed', onclick: async () => {
    for (const p of await api.pickFolder()) if (!folders.some((f) => f.path === p)) folders.push({ path: p, on: true });
    drawFolders();
  } }, icon('plus', 13, 2), 'Thêm thư mục'));
}

function renderGroups() {
  const list = document.getElementById('dupList'); list.replaceChildren();
  document.getElementById('dupBar').hidden = !groups.length;
  if (!groups.length) { list.append(h('div', { class: 'empty' }, ready ? 'Không tìm thấy file trùng.' : 'Bấm "Quét" để tìm file trùng.')); updateFoot(); return; }
  const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
  document.getElementById('dupCount').replaceChildren(h('b', {}, `${groups.length} nhóm`), ` trùng · có thể giải phóng `, h('b', {}, fmt(wasted)));
  for (const g of groups) list.append(groupCard(g));
  autoSelect('old');
}

function build() {
  body().replaceChildren(
    h('div', { class: 'chips' }, h('div', { class: 'chips', id: 'folderChips' }), h('span', { style: { flex: '1' } }),
      h('label', { class: 'muted' }, 'Bỏ qua file nhỏ hơn ', h('input', { type: 'number', min: 0, value: minMB, 'aria-label': 'Dung lượng tối thiểu (MB)', onchange: (e) => { minMB = Number(e.target.value) || 0; } }), ' MB')),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('div', { class: 'muted', id: 'dupCount' }),
      h('div', { class: 'seg', id: 'dupBar', hidden: true },
        h('button', { type: 'button', class: 'on', onclick: () => autoSelect('old') }, 'Giữ bản cũ nhất'),
        h('button', { type: 'button', onclick: () => autoSelect('new') }, 'Giữ bản mới nhất'),
        h('button', { type: 'button', onclick: () => autoSelect('none') }, 'Bỏ chọn'))),
    h('div', { id: 'dupList', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }));
  drawFolders(); renderGroups();
}

async function scan() {
  const btn = document.getElementById('filesScan');
  if (scanning) { api.cancel('dup'); return; }
  const roots = folders.filter((f) => f.on).map((f) => f.path);
  if (!roots.length) return SC.toast('Hãy chọn ít nhất một thư mục');
  scanning = true; btn.textContent = 'Dừng';
  document.getElementById('dupList').replaceChildren(); document.getElementById('dupBar').hidden = true;
  try {
    const res = await api.dupScan(roots, minMB);
    if (!res.cancelled) {
      groups = res.groups; SC.state.dups = groups; ready = true; renderGroups();
      SC.badge('files', fmt(SC.sumSize(groups, (g) => g.size * (g.files.length - 1)))); SC.stat('files', 'Quét xong');
    } else SC.stat('files', 'Đã dừng');
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.textContent = 'Quét lại';
  if (SC.updateHome) SC.updateHome();
}

document.getElementById('filesScan').addEventListener('click', scan);
document.getElementById('filesTrash').addEventListener('click', async () => {
  const paths = picked().map((c) => c.dataset.path);
  const r = await api.trash('dup', paths);
  if (r.error) return SC.toast(r.error);
  if (r.cancelled) return;
  SC.toast(`Đã chuyển ${r.done} file vào Thùng rác, giải phóng ${fmt(r.freed)}` + (r.failed.length ? ` · lỗi: ${r.failed.join(', ')}` : ''));
  SC.refreshDisk();
  const gone = new Set(paths);
  groups = groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1);
  SC.state.dups = groups; renderGroups();
  SC.badge('files', fmt(SC.sumSize(groups, (g) => g.size * (g.files.length - 1))));
  if (SC.updateHome) SC.updateHome();
});

SC.pages.files = {
  scan,
  init: async () => { folders = (await api.roots('dup')).map((p) => ({ path: p, on: !/Movies|Music/.test(p) })); build(); },
};
SC.status.dup = (t) => SC.stat('files', t);
})();
