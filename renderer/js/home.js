(function () {
'use strict';
const { h, fmt, icon } = SC;
let mode = 'scan';      // scan | clean
let scanningAll = false;
let heroNote = 'Cache, log và dữ liệu thừa an toàn để xóa. Các mục khác cần bạn xem lại trước khi xóa.';
let disk = null;

const body = () => document.getElementById('homeBody');

function card(key, ic, name, note, sizeText, go) {
  return h('div', { class: 'card scard' },
    h('span', { class: 'tile acc' }, icon(ic, 18)),
    h('div', {}, h('div', { style: { fontWeight: '600' } }, name), h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, note)),
    h('div', { class: 'size' }, sizeText),
    h('button', { type: 'button', class: 'go', onclick: () => SC.go(go) }, 'Xem chi tiết ', icon('arrow', 14, 2)));
}

function diskCard() {
  const total = disk ? disk.total : 1, free = disk ? disk.free : 0;
  const safe = SC.pages.junk.hasScan() ? SC.pages.junk.safeTotal() : 0;
  const pct = (n) => Math.max(0, Math.min(100, n / total * 100)) + '%';
  const used = total - free;
  const sys = Math.max(0, used - safe);
  return h('div', { class: 'card scard' }, h('div', { style: { fontWeight: '600' } }, 'Dung lượng ổ đĩa'),
    h('div', { class: 'stack', role: 'img', 'aria-label': 'Biểu đồ dung lượng ổ đĩa' },
      h('div', { style: { width: pct(sys), background: '#3A3A40' } }), h('div', { style: { width: pct(safe), background: 'var(--acc)' } }), h('div', { style: { flex: '1', background: 'var(--line)' } })),
    h('div', { class: 'legend' },
      h('div', {}, h('i', { style: { background: '#3A3A40' } }), h('span', {}, 'Đã dùng'), h('b', {}, disk ? fmt(sys) : '—')),
      h('div', {}, h('i', { style: { background: 'var(--acc)' } }), h('span', {}, 'Dọn an toàn'), h('b', {}, fmt(safe))),
      h('div', {}, h('i', { style: { background: '#D3D3DA' } }), h('span', {}, 'Trống'), h('b', {}, disk ? fmt(free) : '—'))));
}

function render() {
  const S = SC.state;
  const safe = SC.pages.junk.hasScan() ? SC.pages.junk.safeTotal() : null;
  const dupWaste = S.dups ? SC.sumSize(S.dups, (g) => g.size * (g.files.length - 1)) : null;
  const dash = (v) => (v == null ? '—' : fmt(v));
  const hero = h('div', { class: 'card hero' },
    h('div', {}, h('div', { class: 'muted', style: { fontWeight: '500' } }, 'Dọn an toàn ngay'),
      h('div', { class: 'big' }, safe == null ? '—' : fmt(safe)), h('div', { class: 'muted', style: { marginTop: '4px' } }, heroNote)),
    h('button', { type: 'button', class: 'btn primary', id: 'heroBtn', disabled: scanningAll, onclick: onHero },
      icon(mode === 'clean' ? 'junk' : 'scan', 15, 2), scanningAll ? 'Đang quét...' : (mode === 'clean' ? 'Dọn an toàn ngay' : 'Quét tất cả')));
  body().replaceChildren(hero, h('div', { class: 'grid3' },
    card('junk', 'junk', 'Dọn rác', S.junk ? `${S.junk.length} nhóm, mục an toàn tick sẵn` : 'Cache, log, rác lập trình, file cài đặt', dash(S.junk ? SC.sumSize(S.junk, (c) => c.total) : null), 'junk'),
    card('big', 'big', 'File lớn và cũ', S.big ? `${S.big.length} file lớn, lâu chưa mở` : 'File trên 100 MB, lâu chưa mở', dash(S.big ? SC.sumSize(S.big) : null), 'big'),
    card('media', 'image', 'Ảnh và video', 'Phân loại, xem thumbnail rồi mới xóa', dash(S.media ? SC.sumSize(S.media) : null), 'media'),
    card('files', 'files', 'File trùng', S.dups ? `${S.dups.length} nhóm file giống hệt nhau` : 'File giống hệt nhau trong thư mục của bạn', dash(dupWaste), 'files'),
    card('apps', 'apps', 'Ứng dụng trùng', S.apps ? `${S.apps.length} ứng dụng cài nhiều bản` : 'Ứng dụng cài nhiều bản', S.apps ? fmt(SC.sumSize(S.apps, (g) => SC.sumSize(g.apps.slice(1)))) : '—', 'apps'),
    diskCard()));
}

async function onHero() {
  if (mode === 'clean') { await SC.pages.junk.cleanSafe(); mode = SC.pages.junk.hasScan() && SC.pages.junk.safeTotal() > 0 ? 'clean' : 'scan'; render(); return; }
  scanningAll = true; heroNote = 'Đang quét toàn bộ, có thể mất vài phút...'; render();
  const steps = [['junk', 'rác'], ['apps', 'ứng dụng'], ['big', 'file lớn'], ['media', 'ảnh và video'], ['files', 'file trùng']];
  if (SC.pages.files.init && !SC.state.foldersReady) { await SC.pages.files.init(); SC.state.foldersReady = true; }
  for (const [k, label] of steps) {
    heroNote = `Đang quét ${label}...`; render();
    try { await SC.pages[k].scan(); } catch { /* tiếp tục bước sau */ }
  }
  scanningAll = false;
  heroNote = 'Quét xong. Mục an toàn đã tick sẵn, các mục khác cần bạn xem lại trước khi xóa.';
  mode = SC.pages.junk.safeTotal() > 0 ? 'clean' : 'scan';
  render();
}

SC.updateHome = render;
SC.refreshDisk = async function () {
  disk = await api.diskInfo();
  const m = document.getElementById('diskMeter'), t = document.getElementById('diskText');
  const pend = document.getElementById('diskPend');
  if (pend) { pend.hidden = SC.trashed <= 0; pend.textContent = SC.trashed > 0 ? `${fmt(SC.trashed)} đang nằm trong Thùng rác. Làm trống Thùng rác để thực sự giải phóng ổ đĩa.` : ''; }
  if (disk) { m.style.width = ((disk.total - disk.free) / disk.total * 100).toFixed(0) + '%'; t.textContent = `${fmt(disk.free)} trống / ${fmt(disk.total)}`; }
  render();
};
SC.pages.home = { onShow: render };
})();
