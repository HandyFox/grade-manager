// Exposes a small, safe API to the app window.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  init: () => invoke('app:init'),
  newFile: (json, suggestedName) => invoke('file:new', json, suggestedName),
  openFile: (path) => invoke('file:open', path),
  save: (path, json) => invoke('file:save', path, json),
  saveAs: (json, suggestedName) => invoke('file:saveAs', json, suggestedName),
  importSpreadsheet: () => invoke('file:import'),
  exportExcel: (json, suggestedName) => invoke('file:export', json, suggestedName),
  listBackups: (path) => invoke('backups:list', path),
  readBackup: (file) => invoke('backups:read', file),
  openBackupsFolder: () => invoke('backups:openFolder'),
  recent: () => invoke('recent:list'),
  forgetRecent: (path) => invoke('recent:forget', path),
  closeFile: () => invoke('file:close'),
  printPage: () => invoke('print:print'),
  savePdf: (suggestedName, landscape) => invoke('print:pdf', suggestedName, landscape),
  saveImage: (dataUrl, suggestedName) => invoke('image:save', dataUrl, suggestedName),
  openExternal: (url) => invoke('shell:openExternal', url),
  showInFolder: (path) => invoke('shell:showInFolder', path),
  setTitle: (title) => invoke('app:setTitle', title),
  closeReady: () => invoke('app:closeReady'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd, arg) => fn(cmd, arg)),
  onBeforeClose: (fn) => ipcRenderer.on('app:beforeClose', () => fn()),
  onOpenPath: (fn) => ipcRenderer.on('app:openPath', (_e, p) => fn(p)),
});
