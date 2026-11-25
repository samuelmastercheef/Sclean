'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  diskInfo: inv('disk:info'),
  about: inv('about'),
  roots: inv('roots:default'),
  pickFolder: inv('dialog:pickFolder'),
  cancel: inv('scan:cancel'),
  reveal: inv('reveal'),
  quicklook: inv('quicklook'),
  thumb: inv('thumb:get'),
  junkScan: inv('junk:scan'),
  junkClean: inv('junk:clean'),
  bigScan: inv('big:scan'),
  mediaScan: inv('media:scan'),
  dupScan: inv('dup:scan'),
  appScan: inv('app:scan'),
  trash: inv('items:trash'),
  storageScan: inv('storage:scan'),
  eject: inv('storage:eject'),
  deleteRuntime: inv('storage:deleteRuntime'),
  openSettings: inv('open:settings'),
  mapScan: inv('map:scan'),
  appList: inv('applist:scan'),
  uninstall: inv('applist:uninstall'),
  copy: inv('clipboard:copy'),
  openTrash: inv('open:trash'),
  history: inv('history:list'),
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
