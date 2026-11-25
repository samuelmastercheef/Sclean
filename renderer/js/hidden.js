(function () {
'use strict';
const { h, fmt, icon, tag } = SC;

// Dung lượng ẩn: hệ thống (snapshot, swap, cập nhật macOS, DMG đang mount) và dữ liệu app Finder không cho thấy
const GROUPS = [
  ['browser', 'Trình duyệt'], ['vm', 'Máy ảo và Docker'], ['dev', 'Công cụ lập trình'], ['cloud', 'Đám mây (bản lưu trên máy)'],
  ['apple', 'Ứng dụng Apple'], ['chat', 'Ứng dụng chat'], ['appcache', 'Ứng dụng khác'], ['ai', 'Model AI'], ['system', 'macOS'],
];
let res = null;
let scanning = false;
const open = new Set();

const body = () => document.getElementById('hiddenBody');
const DAY = 86400000;

function copyBtn(cmd) {
  return h('span', { class: 'cmd' }, h('code', {}, cmd),
    h('button', { class: 'btn sm', type: 'button', onclick: () => { api.copy(cmd); SC.toast('Đã sao chép lệnh, dán vào Terminal để chạy'); } }, icon('copy', 13), 'Sao chép'));
}

function fdaBanner() {
  if (res.fda) return null;
  return h('div', { class: 'banner' }, icon('lock', 18),
    h('div', { style: { flex: '1' } },
      h('b', {}, 'S Clean chưa có Full Disk Access.'),
      h('div', { class: 'muted sm' }, 'macOS đang chặn đọc Ảnh, Tin nhắn, Mail, Thùng rác, Safari. Đây thường là phần "Dữ liệu hệ thống" lớn mà Finder không cho thấy. Cấp quyền xong hãy thoát và mở lại S Clean.')),
    SC.btn('Mở cài đặt quyền', 'sm', () => api.openSettings('fda')));
}

function systemCard() {
  const s = res.system;
  const stats = [];
  if (s.disk) stats.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Còn trống'), h('b', { class: s.disk.free < s.disk.total * 0.1 ? 'warn' : '' }, fmt(s.disk.free)), h('span', { class: 'muted sm' }, `trên ${fmt(s.disk.total)}`)));
  if (s.swap) {
    const heavy = s.swap.used > s.ram * 0.5;
    stats.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Swap (bộ nhớ tạm trên ổ)'), h('b', { class: heavy ? 'warn' : '' }, fmt(s.swap.used)),
      h('span', { class: 'muted sm' }, heavy ? `RAM ${fmt(s.ram)} đang thiếu. Khởi động lại máy để nhả phần này.` : `RAM ${fmt(s.ram)}`)));
  }
  if (s.sleepimage) stats.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'sleepimage'), h('b', {}, fmt(s.sleepimage)), h('span', { class: 'muted sm' }, 'macOS tự quản lý, không cần xóa')));
  const tm = s.snapshots.filter((x) => x.kind === 'timemachine');
  const up = s.snapshots.filter((x) => x.kind === 'update');
  stats.push(h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Snapshot APFS'), h('b', {}, String(s.snapshots.length)),
    h('span', { class: 'muted sm' }, `${tm.length} Time Machine · ${up.length} cập nhật macOS`)));

  const notes = [];
  if (s.pendingUpdate) {
    notes.push(h('div', { class: 'note' }, icon('dmg', 16), h('div', { style: { flex: '1' } },
      h('b', {}, 'Có bản cập nhật macOS đã tải và đang chờ cài.'),
      h('div', { class: 'muted sm' }, 'Bản cập nhật cùng snapshot của nó có thể giữ hơn 10 GB. Cài xong, macOS tự dọn phần này.')),
    SC.btn('Mở Cập nhật phần mềm', 'sm', () => api.openSettings('update'))));
  }
  if (tm.length) {
    notes.push(h('div', { class: 'note' }, icon('cache', 16), h('div', { style: { flex: '1' } },
      h('b', {}, `${tm.length} snapshot Time Machine trên máy (cũ nhất ${tm[0].date ? SC.fdate(tm[0].date) : '?'}).`),
      h('div', { class: 'muted sm' }, 'macOS tự xóa khi thiếu chỗ. Muốn giải phóng ngay, chạy lệnh sau trong Terminal:'),
      copyBtn('tmutil thinlocalsnapshots / 999999999999 4'))));
  }
  if (s.mounted.length) {
    notes.push(h('div', { class: 'note col' },
      h('div', {}, h('b', {}, `${s.mounted.length} ổ đĩa ảo (.dmg) đang mở`), h('span', { class: 'muted sm' }, ' · cài xong thì tháo ra rồi xóa file .dmg')),
      s.mounted.map((m) => h('div', { class: 'srow' },
        h('span', { class: 'path', title: m.image }, SC.home(m.image)),
        h('span', { class: 'muted sm' }, m.mounts.join(', ')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(m.image) }, 'Hiện file'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          const r = await api.eject(m.mounts[0]);
          if (r.ok) { s.mounted = s.mounted.filter((x) => x !== m); render(); SC.toast('Đã tháo ổ ' + m.mounts[0]); } else SC.toast(r.error);
        } }, 'Tháo')))));
  }
  return h('div', { class: 'card' }, h('div', { class: 'section' }, h('b', {}, 'Hệ thống'),
    h('button', { class: 'link', type: 'button', onclick: () => api.openSettings('storage') }, 'Mở Dung lượng của macOS')),
  h('div', { class: 'stats flat' }, stats), notes);
}

function runtimesCard() {
  const rt = res.runtimes.filter((r) => r.size > 0);
  if (!rt.length) return null;
  const dup = rt.filter((r) => r.duplicate);
  return h('div', { class: 'card' },
    h('div', { class: 'section' }, h('b', {}, 'Simulator runtime của Xcode'), h('span', { class: 'muted' }, fmt(SC.sumSize(rt)))),
    rt.map((r) => h('div', { class: 'srow pad' },
      h('span', { class: 'path' }, `${r.platform.replace('com.apple.platform.', '')} ${r.version} (${r.build})`),
      r.duplicate ? tag('Trùng phiên bản', 'review') : null,
      r.lastUsed ? h('span', { class: 'muted sm' }, 'dùng ' + SC.ago(r.lastUsed)) : null,
      h('span', { class: 'num' }, fmt(r.size)))),
    h('div', { class: 'guide' }, dup.length ? 'Có runtime trùng phiên bản, giữ lại 1 bản. ' : '',
      'Xóa trong Xcode > Settings > Components, hoặc chạy trong Terminal:',
      copyBtn(dup.length ? `xcrun simctl runtime delete ${[...dup].sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0].id}` : 'xcrun simctl delete unavailable')));
}

function itemRow(it) {
  const isOpen = open.has(it.id);
  const stale = it.vms.filter((v) => v.mtime && Date.now() - v.mtime > 180 * DAY);
  const head = h('div', { class: 'jrow click', onclick: () => { if (isOpen) open.delete(it.id); else open.add(it.id); render(); } },
    h('div', { class: 'info' },
      h('div', { class: 'nm' }, it.name,
        it.denied ? tag('Bị macOS chặn đọc', 'review') : tag('Finder không thấy', 'hide'),
        stale.length ? tag(`${stale.length} máy ảo lâu không dùng`, 'review') : null),
      h('div', { class: 'ds' }, it.guide)),
    h('span', { class: 'num' }, it.denied && !it.size ? '?' : fmt(it.size)),
    icon(isOpen ? 'down' : 'chev', 16));
  if (!isOpen) return head;
  const trashable = it.action === 'trashChildren';
  const sub = [];
  for (const v of it.vms) {
    sub.push(h('div', { class: 'srow' }, icon('box', 14),
      h('span', { class: 'path', title: v.path }, SC.home(v.path)),
      h('span', { class: 'muted sm' }, v.mtime ? 'sửa ' + SC.ago(v.mtime) : ''),
      h('span', { class: 'num' }, fmt(v.size)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(v.path) }, 'Hiện'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => trash(it, v) }, 'Thùng rác')));
  }
  for (const t of it.top) {
    if (t.size < 1024 * 1024) continue;
    sub.push(h('div', { class: 'srow' },
      h('span', { class: 'path', title: t.path }, SC.home(t.path)),
      h('span', { class: 'num' }, fmt(t.size)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(t.path) }, 'Hiện'),
      trashable ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => trash(it, t) }, 'Thùng rác') : null));
  }
  for (const p of it.parts.filter((x) => x.denied)) {
    sub.push(h('div', { class: 'srow' }, icon('lock', 14), h('span', { class: 'path' }, SC.home(p.path)), h('span', { class: 'muted sm' }, 'cần Full Disk Access')));
  }
  return [head, h('div', { class: 'jsub' }, sub.length ? sub : h('div', { class: 'muted' }, 'Không có chi tiết.'))];
}

async function trash(it, entry) {
  const r = await api.trash('hidden', [entry.path]);
  if (r.error) { SC.toast(r.error); return; }
  if (r.cancelled) return;
  if (r.done) {
    it.top = it.top.filter((x) => x !== entry); it.vms = it.vms.filter((x) => x !== entry); it.size -= entry.size;
    SC.trashed += r.freed; SC.refreshDisk(); SC.toast(`Đã chuyển vào Thùng rác (${fmt(r.freed)})`);
  } else SC.toast('Không chuyển được: ' + (r.failed || []).join(', '));
  render();
}

function render() {
  const b = body();
  if (!res) {
    SC.fill(b, h('div', { class: 'card intro' },
      h('b', {}, 'Những thứ chiếm ổ đĩa mà Finder không cho thấy'),
      h('ul', {}, h('li', {}, 'Snapshot Time Machine và bản cập nhật macOS đang chờ cài'),
        h('li', {}, 'Swap khi RAM thiếu, ổ đĩa ảo .dmg còn đang mở'),
        h('li', {}, 'Dữ liệu trình duyệt, máy ảo, simulator Xcode, cache Notion, Slack, Zalo...'),
        h('li', {}, 'Ảnh, Tin nhắn, Mail, Thùng rác (cần Full Disk Access)')),
      h('div', { class: 'muted' }, 'Mỗi mục kèm cách dọn an toàn. S Clean không tự xóa gì ở đây trừ khi bạn bấm.')));
    return;
  }
  const sc = b.scrollTop;
  const groups = GROUPS.map(([g, label]) => {
    const items = res.items.filter((i) => i.group === g);
    if (!items.length) return null;
    const total = SC.sumSize(items);
    return h('div', { class: 'card' }, h('div', { class: 'section' }, h('b', {}, label),
      h('span', { class: 'muted' }, total === 0 && items.some((i) => i.denied) ? 'chưa đo được' : fmt(total))), items.map(itemRow));
  });
  SC.fill(b, fdaBanner(), systemCard(), runtimesCard(), groups);
  b.scrollTop = sc;
}

async function scan() {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('hiddenScan'); btn.disabled = true; btn.textContent = 'Đang quét...';
  try {
    res = await api.hiddenScan();
    SC.state.hidden = res;
    SC.badge('hidden', fmt(SC.sumSize(res.items)));
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.disabled = false; btn.textContent = 'Quét lại'; SC.stat('hidden', '');
  render();
  if (SC.updateHome) SC.updateHome();
}

SC.pages.hidden = { scan, onShow: render, prune: () => {} };
render();
document.getElementById('hiddenScan').addEventListener('click', scan);
SC.status.hidden = (t) => SC.stat('hidden', t);
})();
