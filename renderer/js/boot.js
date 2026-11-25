(function () {
'use strict';
const { h, icon } = SC;

// Thanh điều hướng
const nav = document.querySelector('.nav');
for (const [key, label, ic] of SC.nav) {
  nav.append(h('button', { type: 'button', class: 'nav-item' + (key === 'home' ? ' active' : ''), dataset: { page: key }, onclick: () => SC.go(key) },
    icon(ic, 17), h('span', { class: 'nm' }, label), h('span', { class: 'badge', id: 'badge-' + key })));
}

api.onProgress((p) => { if (SC.status[p.scope]) SC.status[p.scope](p.text); });
api.about().then((a) => { document.getElementById('copyright').textContent = `${a.name} ${a.version} · ${a.copyright}`; }).catch(() => {});

SC.pages.files.init().then(() => { SC.state.foldersReady = true; });
api.getSettings().then((st) => { SC.settings = st; }).catch(() => { SC.settings = { permanentDelete: false }; });
SC.refreshDisk();
})();
