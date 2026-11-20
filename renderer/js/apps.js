(function () {
'use strict';
const { h, fmt, chk } = SC;
let groups = [];
let scanning = false;
const body = () => document.getElementById('appsBody');

function picked() { return [...document.querySelectorAll('#appsBody .achk:checked')]; }
function updateFoot() {
  const sel = picked();
  const size = sel.reduce((s, c) => s + Number(c.dataset.size), 0);
  document.getElementById('appsSum').replaceChildren(h('b', {}, `${sel.length} ứng dụng · ${fmt(size)}`),
    h('span', { class: 'muted' }, ' đã chọn · nhớ thoát ứng dụng trước khi gỡ'));
  document.getElementById('appsTrash').disabled = sel.length === 0;
}

function render() {
  const b = body();
  if (!groups.length) { b.replaceChildren(h('div', { class: 'empty' }, 'Không tìm thấy ứng dụng trùng.')); updateFoot(); return; }
  SC.fill(b, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Gom theo Bundle ID và tên dạng "App 2", "App copy". Bản mới nhất được gợi ý giữ lại. Ứng dụng của Apple được bỏ qua.'),
    groups.map((g) => {
      const card = h('div', { class: 'card' }, h('div', { style: { padding: '11px 16px', display: 'flex', justifyContent: 'space-between' } },
        h('b', {}, g.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${g.apps.length} bản`)));
      for (const a of g.apps) {
        const keep = a.path === g.keep;
        const box = chk(a.file, !keep, (e) => {
          if ([...card.querySelectorAll('.achk')].every((x) => x.checked)) { e.target.checked = false; SC.toast('Phải giữ lại ít nhất một bản'); }
          updateFoot();
        });
        box.className = 'achk'; box.dataset.size = a.size; box.dataset.path = a.path;
        card.append(h('div', { class: 'arow' }, box, h('span', { class: 'keep' }, keep ? 'GIỮ' : ''),
          h('span', { class: 'tile' }, (a.name[0] || '?').toUpperCase()),
          h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { style: { fontWeight: '500' } }, a.file), h('div', { class: 'muted ellip', style: { fontSize: '12px' } }, SC.home(a.path))),
          h('span', { class: 'muted', style: { fontSize: '12px', width: '80px' } }, a.version ? 'v' + a.version : ''),
          h('span', { class: 'num', style: { width: '70px', textAlign: 'right' } }, fmt(a.size)),
          h('button', { class: 'btn sm', type: 'button', onclick: () => api.reveal(a.path) }, 'Hiện')));
      }
      return card;
    }));
  updateFoot();
}

async function scan() {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('appsScan'); btn.disabled = true; btn.textContent = 'Đang quét...';
  try {
    groups = await api.appScan(); SC.state.apps = groups; render();
    SC.badge('apps', groups.length ? String(groups.length) : ''); SC.stat('apps', '');
  } catch (e) { SC.toast('Không quét được: ' + e.message); }
  scanning = false; btn.disabled = false; btn.textContent = 'Quét lại';
  if (SC.updateHome) SC.updateHome();
}

document.getElementById('appsScan').addEventListener('click', scan);
document.getElementById('appsTrash').addEventListener('click', async () => {
  const paths = picked().map((c) => c.dataset.path);
  const r = await api.trash('app', paths);
  if (r.error) return SC.toast(r.error);
  if (r.cancelled) return;
  SC.toast(`Đã gỡ ${r.done} ứng dụng, giải phóng ${fmt(r.freed)}` + (r.failed.length ? ` · không gỡ được: ${r.failed.join(', ')}` : ''));
  SC.refreshDisk();
  await scan();
});
SC.pages.apps = { scan };
SC.status.app = (t) => SC.stat('apps', t);
})();
