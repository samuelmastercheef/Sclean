(function () {
'use strict';
// Dung lượng ẩn: giải thích phần "Dữ liệu hệ thống" mà Finder không hiện
const { h, fmt, icon, tag } = SC;
const GB = 1024 ** 3;
let data = null;
let scanning = false;

const body = () => document.getElementById('storageBody');

// Màu cho thanh dung lượng, theo vai trò volume APFS
const ROLE_COLOR = { Data: '#3A3A40', System: '#8A8A94', VM: '#C8372D', Preboot: '#D08A1E', Recovery: '#B5B5BE', Update: '#B5B5BE' };

function row(ic, name, tags, desc, size, ...actions) {
  return h('div', { class: 'jrow' },
    h('span', { class: 'tile acc' }, icon(ic, 17)),
    h('div', { class: 'info' }, h('div', { class: 'nm' }, name, tags), desc ? h('div', { class: 'ds' }, desc) : null),
    size != null ? h('span', { class: 'num' }, size) : null,
    actions);
}
const section = (title, note, ...extra) => h('div', { class: 'section' }, h('b', {}, title), h('span', { class: 'muted' }, note, extra));

function diskCard(d) {
  if (!d) return null;
  const pct = (n) => Math.max(0.4, n / d.total * 100) + '%';
  const vols = d.volumes.filter((v) => v.used > 200 * 1024 * 1024);
  return h('div', { class: 'card scard' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
      h('b', {}, 'Ổ khởi động'), h('span', { class: 'muted' }, `${fmt(d.free)} trống / ${fmt(d.total)}`)),
    h('div', { class: 'stack', role: 'img', 'aria-label': 'Dung lượng theo từng phần của ổ đĩa' },
      vols.map((v) => h('div', { title: `${v.label}: ${fmt(v.used)}`, style: { width: pct(v.used), background: ROLE_COLOR[v.role] || '#B5B5BE' } })),
      h('div', { style: { flex: '1', background: 'var(--line)' } })),
    h('div', { class: 'legend st-legend' },
      vols.map((v) => h('div', {}, h('i', { style: { background: ROLE_COLOR[v.role] || '#B5B5BE' } }), h('span', {}, v.label), h('b', {}, fmt(v.used)))),
      h('div', {}, h('i', { style: { background: '#D3D3DA' } }), h('span', {}, 'Trống'), h('b', {}, fmt(d.free)))));
}

function systemCard(r) {
  const out = [];
  const sw = r.swap;
  if (sw && sw.total > 0) {
    out.push(row('cache', 'Bộ nhớ ảo (swap)', sw.used > 8 * GB ? tag('Cao', 'review') : null,
      'Mac thiếu RAM nên dùng ổ đĩa làm RAM phụ. Khởi động lại máy sẽ giải phóng. Đóng bớt tab trình duyệt và app nặng để đỡ phình lại.',
      `${fmt(sw.used)} / ${fmt(sw.total)}`));
  }
  const pre = r.disk && r.disk.volumes.find((v) => v.role === 'Preboot');
  const sn = r.snapshots;
  if ((sn && sn.update > 0) || (pre && pre.used > 10 * GB)) {
    out.push(row('dmg', 'Bản cập nhật macOS đang chờ', sn && sn.update ? tag(`${sn.update} snapshot`, '') : null,
      'macOS đã tải sẵn bản cập nhật (Preboot và snapshot cập nhật). Cài nốt bản cập nhật, sau khi khởi động lại phần này sẽ tự thu gọn.',
      pre ? fmt(pre.used) : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.openSettings('update') }, 'Mở Cập nhật phần mềm')));
  }
  if (sn && sn.timeMachine.length) {
    const last = sn.timeMachine[sn.timeMachine.length - 1];
    out.push(row('disc', 'Snapshot Time Machine trên máy', tag(String(sn.timeMachine.length), ''),
      `Bản sao lưu tạm trên ổ máy${last.date ? ', gần nhất ' + last.date : ''}. macOS tự xóa sau 24 giờ hoặc khi ổ sắp đầy, không cần xóa tay.`, null));
  }
  for (const rt of r.runtimes) {
    out.push(row('phone', `${rt.platform} ${rt.version}`, tag(rt.build, ''),
      'Runtime Simulator của Xcode' + (rt.lastUsed ? `, dùng lần cuối ${SC.ago(new Date(rt.lastUsed).getTime())}` : ', chưa ghi nhận lần dùng') + '. Tải lại được trong Xcode › Settings › Components.',
      fmt(rt.size),
      rt.deletable ? h('button', { class: 'btn sm', type: 'button', onclick: () => delRuntime(rt) }, 'Xóa') : null));
  }
  if (!out.length) return null;
  return h('div', { class: 'card' }, section('Hệ thống', 'Finder không hiện các mục này'), out);
}

function imagesCard(r) {
  if (!r.images.length) return null;
  const total = SC.sumSize(r.images);
  return h('div', { class: 'card' },
    section(`Ổ DMG đang gắn (${r.images.length})`, 'Tháo ra không xóa gì cả · ',
      h('button', { class: 'btn sm', type: 'button', onclick: () => eject(r.images.flatMap((i) => i.mounts)) }, 'Tháo tất cả')),
    r.images.map((i) => row('dmg', i.name, null, i.image ? SC.home(i.image) : 'Không rõ file gốc', fmt(i.size),
      i.image ? h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(i.image) }, 'Hiện file') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => eject(i.mounts) }, 'Tháo'))),
    h('div', { class: 'st-note muted' }, `Các ổ này chiếm khoảng ${fmt(total)} trong bộ nhớ đệm hệ thống khi đang gắn. Cài xong ứng dụng thì tháo ổ ra; file .dmg cũ có ở Dọn rác › File cài đặt cũ.`));
}

function hiddenCard(r) {
  if (!r.hidden.length) return null;
  return h('div', { class: 'card' },
    section('Dữ liệu ẩn của ứng dụng', 'Thư mục trên 300 MB trong ~/Library · S Clean không tự xóa ở đây'),
    r.hidden.map((x) => row(x.label && /Máy ảo/.test(x.label) ? 'window' : 'folder',
      x.label || x.path.split('/').pop(), x.label ? h('span', { class: 'muted st-path', title: x.path }, SC.home(x.path)) : null,
      x.hint, fmt(x.size),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(x.path) }, 'Hiện'))));
}

function protectedCard(r) {
  if (!r.protected.length) return null;
  const blocked = r.protected.filter((a) => a.blocked);
  return h('div', { class: 'card' },
    section(blocked.length ? 'Chưa đo được' : 'Ảnh, Thùng rác, Tin nhắn, Mail',
      blocked.length ? 'macOS chặn đọc khi chưa có Full Disk Access · ' : 'Đã đo',
      blocked.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => api.openSettings('fda') }, 'Cấp Full Disk Access') : null),
    r.protected.map((a) => row(a.name.startsWith('Thùng') ? 'junk' : a.name.startsWith('Thư viện') ? 'image' : a.name.startsWith('Tin') ? 'phone' : a.name === 'Safari' ? 'window' : 'mail',
      a.name, a.blocked ? tag('Chưa đo', 'review') : null, a.hint, a.blocked ? '?' : fmt(a.size || 0),
      a.blocked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(a.path) }, 'Hiện'))),
    blocked.length ? h('div', { class: 'st-note muted' },
      'Cài đặt hệ thống › Quyền riêng tư và bảo mật › Truy cập toàn bộ ổ đĩa › bật S Clean, rồi mở lại S Clean và quét lại. Đây thường là phần "Dữ liệu hệ thống" lớn nhất.') : null);
}

function summary(r) {
  const data = r.disk && r.disk.volumes.find((v) => v.role === 'Data');
  const known = SC.sumSize(r.hidden) + SC.sumSize(r.runtimes) + SC.sumSize(r.protected, (a) => a.size || 0);
  const blocked = r.protected.filter((a) => a.blocked).length;
  return h('div', { class: 'card hero' },
    h('div', {},
      h('div', { class: 'muted', style: { fontWeight: '500' } }, 'Tìm thấy trong vùng Finder không hiện'),
      h('div', { class: 'big' }, fmt(known + (r.swap ? r.swap.used : 0))),
      h('div', { class: 'muted', style: { marginTop: '4px' } },
        (data ? `Phần Dữ liệu đang dùng ${fmt(data.used)}. ` : '') +
        (blocked ? `${blocked} vùng chưa đo được do thiếu quyền.` : 'Đã đo được tất cả các vùng chính.'))),
    h('button', { class: 'btn', type: 'button', onclick: () => api.openSettings('storage') }, 'Mở Cài đặt › Dung lượng'));
}

function render() {
  const b = body();
  if (!data) { b.replaceChildren(h('div', { class: 'empty' }, 'Bấm "Quét" để tìm phần dung lượng mà Finder không hiện.')); return; }
  const scroll = b.scrollTop;
  SC.fill(b, summary(data), diskCard(data.disk), protectedCard(data), systemCard(data), hiddenCard(data), imagesCard(data));
  b.scrollTop = scroll;
  SC.badge('storage', data.hidden.length ? fmt(SC.sumSize(data.hidden)) : '');
}

async function scan() {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('storageScan'); btn.disabled = true; btn.textContent = 'Đang quét...';
  try { data = await api.storageScan(); SC.state.storage = data; render(); SC.stat('storage', ''); }
  catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.disabled = false; btn.textContent = 'Quét lại';
}

async function eject(mounts) {
  const r = await api.eject(mounts);
  SC.toast(`Đã tháo ${r.done} ổ` + (r.failed.length ? ` · chưa tháo được (đang dùng?): ${r.failed.join(', ')}` : ''));
  if (data) {
    const gone = new Set(mounts.filter((m) => !r.failed.includes(m.split('/').pop())));
    data.images = data.images.filter((i) => !i.mounts.every((m) => gone.has(m)));
    render();
  }
}

async function delRuntime(rt) {
  const r = await api.deleteRuntime(rt.id);
  if (r.cancelled) return;
  if (r.error) { SC.toast('Không xóa được: ' + r.error); return; }
  SC.toast(`Đã xóa runtime, giải phóng ${fmt(r.freed)}`);
  data.runtimes = data.runtimes.filter((x) => x.id !== rt.id);
  render(); SC.refreshDisk();
}

SC.pages.storage = { scan, onShow: () => { if (!data) render(); } };
document.getElementById('storageScan').addEventListener('click', scan);
SC.status.storage = (t) => SC.stat('storage', t);
})();
