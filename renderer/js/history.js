(function () {
'use strict';
const { h, fmt, tag } = SC;

// Lịch sử dọn dẹp và cài đặt an toàn
const ACTION = { trash: ['Vào Thùng rác', 'safe'], delete: ['Xóa hẳn', 'review'], eject: ['Tháo ổ', ''] };
let list = [];

const body = () => document.getElementById('historyBody');

function settingsCard() {
  const s = SC.settings || {};
  return h('div', { class: 'card' },
    h('div', { class: 'section' }, h('b', {}, 'Cài đặt an toàn')),
    h('label', { class: 'jrow' },
      h('input', { type: 'checkbox', checked: !!s.permanentDelete, onchange: async (e) => {
        SC.settings = await api.setSettings({ permanentDelete: e.target.checked });
        SC.toast(e.target.checked ? 'Cache, log, node_modules sẽ bị xóa hẳn khi dọn' : 'Mọi thứ sẽ vào Thùng rác khi dọn');
      } }),
      h('div', { class: 'info' }, h('div', { class: 'nm' }, 'Xóa hẳn cache, log và node_modules thay vì đưa vào Thùng rác'),
        h('div', { class: 'ds' }, 'Mặc định tắt: mọi thứ S Clean dọn đều vào Thùng rác để bạn khôi phục được. Bật lên thì giải phóng ổ ngay nhưng không khôi phục được.'))),
    h('div', { class: 'jrow' }, h('div', { class: 'info' }, h('div', { class: 'nm' }, 'Luôn được bảo vệ'),
      h('div', { class: 'ds' }, 'S Clean từ chối xóa thư mục hệ thống (/System, /usr, /private/var...), thư mục khung (Desktop, Documents, ~/Library...), dữ liệu ứng dụng Apple và thư viện Ảnh, kể cả khi bạn chọn.'))));
}

function render() {
  const total = SC.sumSize(list.filter((e) => e.action !== 'eject'));
  const rows = list.map((e) => h('div', { class: 'srow pad' },
    h('span', { class: 'muted sm', style: { width: '128px' } }, new Date(e.time).toLocaleString('vi-VN')),
    h('span', { style: { width: '104px' } }, tag(...(ACTION[e.action] || [e.action, '']))),
    h('span', { class: 'path', title: e.path }, SC.home(e.path)),
    h('span', { class: 'muted sm', style: { width: '120px' } }, e.source),
    h('span', { class: 'num', style: { width: '70px', textAlign: 'right' } }, e.size ? fmt(e.size) : '')));
  SC.fill(body(), settingsCard(),
    h('div', { class: 'card' },
      h('div', { class: 'section' }, h('b', {}, 'Đã dọn gần đây'), h('span', { class: 'muted' }, list.length ? `${list.length} mục · ${fmt(total)}` : '')),
      rows.length ? rows : h('div', { class: 'empty' }, 'Chưa dọn gì.')));
}

async function load() {
  try { list = await api.history(); } catch { list = []; }
  render();
}

SC.pages.history = { onShow: load, prune: () => {} };
document.getElementById('historyTrash').addEventListener('click', () => api.openTrash());
})();
