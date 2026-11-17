// Grade Manager — Electron main process: window, menus, files, backups, printing.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { importWorkbook } = require('./importer');
const { exportWorkbook } = require('./exporter');

const isMac = process.platform === 'darwin';
const EXT = 'gradebook';
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUPS_KEPT = 60;

let win = null;
// Automated UI test mode (see src/main/smoke.js): dialogs are answered automatically.
const smokeOut = process.env.GM_SMOKE && !app.isPackaged ? (process.env.GM_SMOKE_OUT || path.join(require('os').tmpdir(), 'gm-smoke')) : null;
function saveDialog(opts) {
  if (smokeOut) return Promise.resolve({ canceled: false, filePath: path.join(smokeOut, path.basename(opts.defaultPath)) });
  return dialog.showSaveDialog(win, opts);
}
function openDialog(opts) {
  if (smokeOut) return Promise.resolve(process.env.GM_SMOKE_IMPORT ? { canceled: false, filePaths: [process.env.GM_SMOKE_IMPORT] } : { canceled: true, filePaths: [] });
  return dialog.showOpenDialog(win, opts);
}
function openWithShell(p) { if (!smokeOut) shell.openPath(p); }
if (smokeOut) app.setPath('userData', path.join(smokeOut, 'userData'));
let currentPath = null;
let readyToClose = false;
let quitting = false;
let pendingOpenPath = null;
const lastBackupAt = new Map();

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  if (smokeOut) return {};
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  if (smokeOut) return;
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch (e) { console.error(e); }
}
function addRecent(p) {
  const s = readSettings();
  s.recent = [p, ...(s.recent || []).filter((x) => x !== p)].slice(0, 10);
  s.lastFile = p;
  writeSettings(s);
  if (!isMac) app.addRecentDocument && app.addRecentDocument(p);
}
function defaultDir() {
  const dir = path.join(app.getPath('documents'), 'Grade Manager');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}
function safeName(name) {
  return String(name || 'Gradebook').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Gradebook';
}

// ---------- file io ----------
function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    fs.writeFileSync(file, data); // e.g. cloud-sync folders that lock renames
  }
}

function backupDir(file) {
  const base = safeName(path.basename(file, path.extname(file)));
  return path.join(app.getPath('userData'), 'backups', base);
}

function makeBackup(file, force) {
  try {
    if (!fs.existsSync(file)) return;
    const last = lastBackupAt.get(file) || 0;
    if (!force && Date.now() - last < BACKUP_EVERY_MS) return;
    const dir = backupDir(file);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(file, path.join(dir, `${stamp}.${EXT}`));
    lastBackupAt.set(file, Date.now());
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(`.${EXT}`)).sort();
    while (files.length > BACKUPS_KEPT) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { console.error('backup failed', e); }
}

function readGradebook(file) {
  const text = fs.readFileSync(file, 'utf8');
  const doc = JSON.parse(text);
  if (!doc || doc.format !== 'grade-manager') throw new Error('This file is not a Grade Manager gradebook.');
  return doc;
}

function openPath(file) {
  const doc = readGradebook(file);
  currentPath = file;
  makeBackup(file, true);
  addRecent(file);
  return { path: file, doc };
}

// ---------- window ----------
function createWindow() {
  readyToClose = false;
  const s = readSettings();
  const b = s.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    x: b.x, y: b.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Grade Manager',
    backgroundColor: '#f7f6f2',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
  });
  if (b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    const st = readSettings();
    st.bounds = Object.assign(win.getNormalBounds(), { maximized: win.isMaximized() });
    writeSettings(st);
    if (readyToClose) return;
    e.preventDefault();
    win.webContents.send('app:beforeClose');
    setTimeout(() => { readyToClose = true; if (win && !win.isDestroyed()) win.close(); if (quitting) app.quit(); }, 4000);
  });
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function send(cmd, arg) { if (win) win.webContents.send('menu', cmd, arg); }

function buildMenu() {
  const s = readSettings();
  const recent = (s.recent || []).filter((p) => fs.existsSync(p));
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Gradebook…', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open Gradebook…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((p) => ({ label: p, click: () => send('openPath', p) }))
            : [{ label: 'No recent gradebooks', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save a Copy As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { label: 'Start a New School Year…', click: () => send('newYear') },
        { type: 'separator' },
        { label: 'Import from Grade Manager Spreadsheet…', click: () => send('import') },
        { label: 'Export to Excel…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        { type: 'separator' },
        { label: 'Backups…', click: () => send('backups') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Close Gradebook', click: () => send('close') },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('selectAll') },
        { type: 'separator' },
        { label: 'Fill Selection…', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('fill') },
        { label: 'Fill Down', accelerator: 'CmdOrCtrl+D', click: () => send('fillDown') },
        { label: 'Find Student…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Grades', accelerator: 'CmdOrCtrl+1', click: () => send('view', 'grades') },
        { label: 'Averages', accelerator: 'CmdOrCtrl+2', click: () => send('view', 'averages') },
        { label: 'Graphs', accelerator: 'CmdOrCtrl+3', click: () => send('view', 'graphs') },
        { label: 'Report Cards', accelerator: 'CmdOrCtrl+4', click: () => send('view', 'reports') },
        { label: 'Setup', accelerator: 'CmdOrCtrl+5', click: () => send('view', 'setup') },
        { type: 'separator' },
        { label: 'Previous Subject', accelerator: 'CmdOrCtrl+PageUp', click: () => send('subject', -1) },
        { label: 'Next Subject', accelerator: 'CmdOrCtrl+PageDown', click: () => send('subject', 1) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'How to Use Grade Manager', accelerator: 'F1', click: () => send('view', 'help') },
        { label: 'Open a Sample Gradebook', click: () => send('sample') },
        { type: 'separator' },
        { label: 'Project Website', click: () => shell.openExternal('https://github.com/HandyFox/grade-manager') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- ipc ----------
function registerIpc() {
  ipcMain.handle('app:init', () => {
    const s = readSettings();
    const result = { version: app.getVersion(), platform: process.platform, recent: (s.recent || []).filter((p) => fs.existsSync(p)) };
    if (smokeOut) return result; // tests start at the welcome screen
    const target = pendingOpenPath || s.lastFile;
    pendingOpenPath = null;
    if (target && fs.existsSync(target)) {
      try { result.opened = openPath(target); } catch (e) { result.openError = `${path.basename(target)}: ${e.message}`; }
    }
    return result;
  });

  ipcMain.handle('file:new', async (_e, json, suggestedName) => {
    const r = await saveDialog({
      title: 'Save new gradebook',
      defaultPath: path.join(defaultDir(), `${safeName(suggestedName)}.${EXT}`),
      filters: [{ name: 'Gradebook', extensions: [EXT] }],
    });
    if (r.canceled || !r.filePath) return null;
    atomicWrite(r.filePath, json);
    currentPath = r.filePath;
    addRecent(r.filePath);
    buildMenu();
    return r.filePath;
  });

  ipcMain.handle('file:open', async (_e, p) => {
    let file = p;
    if (!file) {
      const r = await openDialog({
        title: 'Open gradebook',
        defaultPath: defaultDir(),
        properties: ['openFile'],
        filters: [{ name: 'Gradebook', extensions: [EXT, 'json'] }],
      });
      if (r.canceled || !r.filePaths.length) return null;
      file = r.filePaths[0];
    }
    try {
      const res = openPath(file);
      buildMenu();
      return res;
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:save', (_e, p, json) => {
    if (!p) return { ok: false, error: 'No file' };
    try {
      makeBackup(p, false);
      atomicWrite(p, json);
      return { ok: true, at: Date.now() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('file:saveAs', async (_e, json, suggestedName) => {
    const r = await saveDialog({
      title: 'Save a copy',
      defaultPath: path.join(currentPath ? path.dirname(currentPath) : defaultDir(), `${safeName(suggestedName)}.${EXT}`),
      filters: [{ name: 'Gradebook', extensions: [EXT] }],
    });
    if (r.canceled || !r.filePath) return null;
    atomicWrite(r.filePath, json);
    return r.filePath;
  });

  ipcMain.handle('file:close', () => {
    const s = readSettings();
    s.lastFile = null;
    writeSettings(s);
    currentPath = null;
    return true;
  });

  ipcMain.handle('file:import', async () => {
    const r = await openDialog({
      title: 'Import a Grade Manager spreadsheet',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbooks', extensions: ['xltm', 'xlsm', 'xlsx', 'xltx', 'xls'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    try {
      const buf = fs.readFileSync(r.filePaths[0]);
      const res = importWorkbook(buf);
      res.sourceName = path.basename(r.filePaths[0]).replace(/\.[^.]+$/, '');
      return res;
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:export', async (_e, json, suggestedName) => {
    const r = await saveDialog({
      title: 'Export to Excel',
      defaultPath: path.join(currentPath ? path.dirname(currentPath) : defaultDir(), `${safeName(suggestedName)}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    try {
      exportWorkbook(JSON.parse(json), r.filePath);
      return r.filePath;
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('backups:list', (_e, p) => {
    const file = p || currentPath;
    if (!file) return [];
    const dir = backupDir(file);
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(`.${EXT}`)).sort().reverse()
        .map((f) => { const full = path.join(dir, f); return { file: full, name: f, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs }; });
    } catch { return []; }
  });
  ipcMain.handle('backups:read', (_e, file) => {
    try { return { doc: readGradebook(file) }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('backups:openFolder', () => {
    const dir = currentPath ? backupDir(currentPath) : path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle('recent:list', () => (readSettings().recent || []).filter((p) => fs.existsSync(p)));
  ipcMain.handle('recent:forget', (_e, p) => {
    const s = readSettings();
    s.recent = (s.recent || []).filter((x) => x !== p);
    writeSettings(s);
    buildMenu();
    return s.recent;
  });

  ipcMain.handle('print:print', (e) => new Promise((resolve) => {
    e.sender.print({ printBackground: true }, (ok, reason) => resolve({ ok, reason }));
  }));
  ipcMain.handle('print:pdf', async (e, suggestedName, landscape) => {
    const r = await saveDialog({
      title: 'Save as PDF',
      defaultPath: path.join(currentPath ? path.dirname(currentPath) : defaultDir(), `${safeName(suggestedName)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const data = await e.sender.printToPDF({ printBackground: true, pageSize: 'Letter', landscape: !!landscape, margins: { marginType: 'none' } });
    fs.writeFileSync(r.filePath, data);
    openWithShell(r.filePath);
    return r.filePath;
  });

  ipcMain.handle('image:save', async (_e, dataUrl, suggestedName) => {
    const r = await saveDialog({
      title: 'Save graph as picture',
      defaultPath: path.join(currentPath ? path.dirname(currentPath) : defaultDir(), `${safeName(suggestedName)}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    return r.filePath;
  });

  ipcMain.handle('shell:openExternal', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  ipcMain.handle('shell:showInFolder', (_e, p) => { if (p && !smokeOut) shell.showItemInFolder(p); });
  ipcMain.handle('app:setTitle', (_e, t) => { if (win) win.setTitle(t); });
  ipcMain.handle('app:closeReady', () => {
    readyToClose = true;
    if (win && !win.isDestroyed()) win.close();
    if (quitting) app.quit();
  });
}

// ---------- startup ----------
function fileArg(argv) {
  return argv.slice(1).find((a) => a && a.toLowerCase().endsWith(`.${EXT}`) && fs.existsSync(a));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('app:openPath', f);
    }
  });
  app.on('open-file', (e, p) => { // macOS
    e.preventDefault();
    if (win) win.webContents.send('app:openPath', p); else pendingOpenPath = p;
  });

  app.whenReady().then(() => {
    pendingOpenPath = pendingOpenPath || fileArg(process.argv);
    registerIpc();
    buildMenu();
    createWindow();
    if (smokeOut) require('./smoke').run(win);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('before-quit', () => { quitting = true; });
}
