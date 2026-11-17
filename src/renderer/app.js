// Grade Manager — renderer entry point: app state, saving, undo, navigation and menu commands.
import { h, clear, toast, modal, confirmDialog, icon, debounce, letterPill } from './ui.js';
import * as GradesView from './views/grades.js';
import * as AveragesView from './views/averages.js';
import * as GraphsView from './views/graphs.js';
import * as ReportsView from './views/reports.js';
import * as SetupView from './views/setup.js';
import * as HelpView from './views/help.js';
import * as WelcomeView from './views/welcome.js';

const M = window.GMModel;
const C = window.GMCalc;
const api = window.api;

const VIEWS = {
  grades: { label: 'Grades', mod: GradesView, key: '1' },
  averages: { label: 'Averages', mod: AveragesView, key: '2' },
  graphs: { label: 'Graphs', mod: GraphsView, key: '3' },
  reports: { label: 'Report Cards', mod: ReportsView, key: '4' },
  setup: { label: 'Setup', mod: SetupView, key: '5' },
  help: { label: 'Help', mod: HelpView, key: 'F1' },
};

const app = {
  M, C, api,
  doc: null,
  path: null,
  isSample: false,
  view: 'grades',
  period: 0,
  subjectId: null,
  studentId: null,
  rev: 0,
  _results: null,
  _resultsRev: -1,
  undoStack: [],
  redoStack: [],
  current: null, // mounted view instance
  status: 'saved',
  platform: 'win32',

  results() {
    if (!this._results || this._resultsRev !== this.rev) {
      this._results = C.computeAll(this.doc);
      this._resultsRev = this.rev;
    }
    return this._results;
  },
  fmt(v) { return C.format(v, this.doc.settings.decimals); },
  letter(v) { return C.letterFor(this.doc.scale, v); },
  pill(v) { return letterPill(this.letter(v)); },
  subject(id) { return this.doc.subjects.find((s) => s.id === (id || this.subjectId)) || this.doc.subjects[0] || null; },
  student(id) { return this.doc.students.find((s) => s.id === id) || null; },
  activeStudents() { return this.doc.students.filter((s) => !s.inactive); },
  isLow(v) { return v !== null && v !== undefined && v < (Number(this.doc.settings.highlightBelow) || 0); },

  /** Call after any change to the document. */
  changed(opts) {
    this.rev++;
    if (opts && opts.structure) { this.undoStack = []; this.redoStack = []; }
    this.setStatus(this.path ? 'unsaved' : 'sample');
    saveSoon();
    if (opts && opts.rerender) this.rerender();
  },

  /** Apply grade cell changes [{p, subj, stu, cat, idx, to}] as one undoable step. */
  applyGradeChanges(changes, label) {
    const recorded = [];
    for (const ch of changes) {
      const from = M.getGrade(this.doc, ch.p, ch.subj, ch.stu, ch.cat, ch.idx);
      const to = ch.to === undefined ? null : ch.to;
      if (from === to) continue;
      M.setGrade(this.doc, ch.p, ch.subj, ch.stu, ch.cat, ch.idx, to);
      recorded.push({ ...ch, from, to });
    }
    if (!recorded.length) return 0;
    this.undoStack.push({ label: label || 'Edit', changes: recorded });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
    return recorded.length;
  },

  undo() { this._step(this.undoStack, this.redoStack, 'from', 'Undid'); },
  redo() { this._step(this.redoStack, this.undoStack, 'to', 'Redid'); },
  _step(src, dst, key, verb) {
    const step = src.pop();
    if (!step) { toast('Nothing to ' + (verb === 'Undid' ? 'undo' : 'redo')); return; }
    for (const ch of step.changes) M.setGrade(this.doc, ch.p, ch.subj, ch.stu, ch.cat, ch.idx, ch[key]);
    dst.push(step);
    this.changed();
    const first = step.changes[0];
    if (first) {
      const moved = this.period !== first.p || this.subjectId !== first.subj || this.view !== 'grades';
      this.period = first.p; this.subjectId = first.subj;
      if (this.view !== 'grades') this.go('grades');
      else if (moved) this.rerender();
      else if (this.current && this.current.afterUndo) this.current.afterUndo(step.changes);
      else this.rerender();
    }
    toast(`${verb}: ${step.label}`);
  },

  setStatus(s, detail) {
    this.status = s;
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = `save-status ${s}`;
    el.textContent = { saved: '✓ All changes saved', saving: 'Saving…', unsaved: 'Saving…', error: `⚠ Not saved: ${detail || ''}`, sample: 'Sample — not saved' }[s] || '';
  },

  go(view) {
    if (!this.doc && view !== 'help') { this.view = 'start'; renderWelcome(); return; }
    this.view = view;
    if (this.current && this.current.unmount) this.current.unmount();
    this.current = null;
    renderNav();
    const main = clear(document.getElementById('main'));
    const root = h('div', { class: 'view' });
    main.appendChild(root);
    if (this.isSample) {
      root.appendChild(h('div', { class: 'banner info' }, 'This is a sample gradebook to try things out — changes aren’t saved.',
        h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => saveSampleAs() }, 'Save as my gradebook…')));
    }
    this.current = VIEWS[view].mod.mount(this, root) || {};
  },

  rerender() { this.go(this.view); },

  async openDoc({ doc, path, sample }) {
    await flushSave();
    try {
      this.doc = M.normalize(doc);
    } catch (e) {
      toast(`Couldn’t open that file: ${e.message}`, 'error');
      return;
    }
    this.path = path || null;
    this.isSample = !!sample;
    this.rev++;
    this.undoStack = []; this.redoStack = [];
    this.period = Math.min(this.doc.settings.currentPeriod || 0, this.doc.periods.length - 1);
    this.subjectId = this.doc.subjects[0] ? this.doc.subjects[0].id : null;
    this.studentId = this.doc.students[0] ? this.doc.students[0].id : null;
    updateChrome();
    this.setStatus(this.path ? 'saved' : 'sample');
    this.go(this.doc.students.length ? 'grades' : 'setup');
  },
};
window.__gm = app; // handy for troubleshooting from the developer tools

// ---------- saving ----------
let saving = Promise.resolve();
async function doSave() {
  if (!app.doc || !app.path) return;
  const json = JSON.stringify(app.doc);
  const path = app.path;
  app.setStatus('saving');
  saving = saving.then(() => api.save(path, json)).then((r) => {
    if (r && r.ok) app.setStatus('saved');
    else app.setStatus('error', r && r.error);
  }).catch((e) => app.setStatus('error', e.message));
  return saving;
}
const saveSoon = debounce(doSave, 700);
async function flushSave() {
  if (saveSoon.pending()) saveSoon.flush();
  await saving;
}

// ---------- chrome ----------
function baseName(p) { return p ? p.split(/[\\/]/).pop().replace(/\.gradebook$/i, '') : ''; }

function updateChrome() {
  const d = app.doc;
  document.getElementById('brand-sub').textContent = d ? [d.info.className, d.info.schoolYear].filter(Boolean).join(' · ') : '';
  document.getElementById('file-name').textContent = app.path ? baseName(app.path) : (d ? 'Sample gradebook' : '');
  api.setTitle(d ? `${app.path ? baseName(app.path) : 'Sample'} — Grade Manager` : 'Grade Manager');
}
app.updateChrome = updateChrome;

function renderNav() {
  const nav = clear(document.getElementById('nav'));
  if (!app.doc) nav.appendChild(h('button', { class: `nav-item ${app.view !== 'help' ? 'active' : ''}`, onclick: () => { app.view = 'start'; renderWelcome(); } }, icon('open'), 'Start'));
  for (const [key, v] of Object.entries(VIEWS)) {
    if (!app.doc && key !== 'help') continue;
    nav.appendChild(h('button', { class: `nav-item ${app.view === key && app.doc ? 'active' : ''}`, onclick: () => app.go(key), title: v.label },
      icon(key), v.label, h('span', { class: 'kbd' }, v.key === 'F1' ? 'F1' : `${app.platform === 'darwin' ? '⌘' : 'Ctrl+'}${v.key}`)));
  }
}

function renderWelcome() {
  if (app.view !== 'help') app.view = 'start';
  if (app.current && app.current.unmount) app.current.unmount();
  app.current = null;
  app.doc = null; app.path = null; app.isSample = false;
  updateChrome();
  app.setStatus('');
  renderNav();
  const main = clear(document.getElementById('main'));
  const root = h('div', { class: 'view' });
  main.appendChild(root);
  WelcomeView.mount(app, root);
}

// ---------- commands ----------
async function newGradebook() {
  const year = h('input', { type: 'text', value: M.currentSchoolYear() });
  const school = h('input', { type: 'text', placeholder: 'e.g. Maple Grove Christian School' });
  const teacher = h('input', { type: 'text', placeholder: 'e.g. Mrs. Martin' });
  const cls = h('input', { type: 'text', placeholder: 'e.g. Grade 4' });
  const names = h('textarea', { rows: 8, placeholder: 'One student per line — you can paste a list from Excel.\nYou can also add students later in Setup.' });
  const body = h('div', null,
    h('div', { class: 'form-row' }, h('label', { class: 'field' }, h('span', null, 'School year'), year), h('label', { class: 'field' }, h('span', null, 'Class / grade'), cls)),
    h('div', { class: 'form-row' }, h('label', { class: 'field' }, h('span', null, 'School'), school), h('label', { class: 'field' }, h('span', null, 'Teacher'), teacher)),
    h('label', { class: 'field' }, h('span', null, 'Students'), names),
    h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Starts with the subjects, 6 marking periods and grading scale from the Grade Manager spreadsheet — change any of it in Setup.'));
  const ok = await modal({ title: 'New gradebook', body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Create…', value: true, primary: true }] });
  if (!ok) return;
  const doc = M.createDoc({
    schoolYear: year.value.trim(), school: school.value.trim(), teacher: teacher.value.trim(), className: cls.value.trim(),
    students: names.value.split(/\r?\n/).map((s) => s.split('\t')[0].trim()).filter(Boolean),
  });
  const name = `Grade Manager ${doc.info.schoolYear}${doc.info.className ? ` ${doc.info.className}` : ''}`;
  const path = await api.newFile(JSON.stringify(doc), name);
  if (path) await app.openDoc({ doc, path });
}

async function openGradebook(p) {
  const r = await api.openFile(p);
  if (!r) return;
  if (r.error) { toast(`Couldn’t open: ${r.error}`, 'error'); return; }
  await app.openDoc({ doc: r.doc, path: r.path });
  toast(`Opened ${baseName(r.path)}`);
}

async function importSpreadsheet() {
  const r = await api.importSpreadsheet();
  if (!r) return;
  if (r.error) { modal({ title: 'Couldn’t import that file', body: r.error }); return; }
  const s = r.summary;
  const ok = await modal({
    title: 'Import Grade Manager spreadsheet',
    body: h('div', null,
      h('p', null, `Found ${s.students} students, ${s.subjects} subjects, ${s.periods} marking periods and ${s.grades.toLocaleString()} grades.`),
      s.students ? null : h('p', { class: 'banner', style: { margin: '0 0 10px' } }, 'No student names were found (only the “Student 1, Student 2…” placeholders). You can add students in Setup after importing.'),
      h('p', { class: 'hint' }, 'Weights, the letter-grade scale and the Penmanship/Art letter chart were brought in too. Your spreadsheet isn’t changed. Next, choose where to save the new gradebook.')),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save gradebook…', value: true, primary: true }],
  });
  if (!ok) return;
  const path = await api.newFile(JSON.stringify(r.doc), r.sourceName || `Grade Manager ${r.doc.info.schoolYear}`);
  if (path) { await app.openDoc({ doc: r.doc, path }); toast('Imported — everything is here and saved.', 'ok'); }
}

async function exportExcel() {
  if (!app.doc) return;
  const r = await api.exportExcel(JSON.stringify(app.doc), `${baseName(app.path) || 'Gradebook'} export`);
  if (!r) return;
  if (r.error) toast(`Export failed: ${r.error}`, 'error');
  else { toast('Exported to Excel', 'ok'); api.showInFolder(r); }
}

async function saveCopy() {
  if (!app.doc) return;
  const r = await api.saveAs(JSON.stringify(app.doc), `${baseName(app.path) || 'Gradebook'} copy`);
  if (r) toast(`Saved a copy: ${baseName(r)}`, 'ok');
}

async function saveSampleAs() {
  const path = await api.newFile(JSON.stringify(app.doc), 'My Gradebook');
  if (path) { app.path = path; app.isSample = false; updateChrome(); app.setStatus('saved'); app.rerender(); }
}

async function newSchoolYear() {
  if (!app.doc) return;
  const year = h('input', { type: 'text', value: M.nextSchoolYear(app.doc.info.schoolYear) });
  const keepStudents = h('input', { type: 'checkbox' });
  const keepLabels = h('input', { type: 'checkbox' });
  const body = h('div', null,
    h('p', null, 'Creates a fresh gradebook with the same subjects, weights, grading scale and settings. This year’s gradebook is left as it is.'),
    h('label', { class: 'field' }, h('span', null, 'New school year'), year),
    h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('label', { class: 'check' }, keepStudents, 'Keep the same students'),
      h('label', { class: 'check' }, keepLabels, 'Keep test and quiz names')));
  const ok = await modal({ title: 'Start a new school year', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Create…', value: true, primary: true }] });
  if (!ok) return;
  const doc = M.newYearFrom(app.doc, { schoolYear: year.value.trim(), keepStudents: keepStudents.checked, keepLabels: keepLabels.checked });
  const name = `Grade Manager ${doc.info.schoolYear}${doc.info.className ? ` ${doc.info.className}` : ''}`;
  const path = await api.newFile(JSON.stringify(doc), name);
  if (path) { await app.openDoc({ doc, path }); toast(`Started ${doc.info.schoolYear}`, 'ok'); }
}

async function showBackups() {
  if (!app.path) { toast('Backups are kept for saved gradebooks.'); return; }
  await flushSave();
  const list = await api.listBackups(app.path);
  const body = h('div', null,
    h('p', null, 'Grade Manager saves every change automatically and keeps a backup copy every 10 minutes while you work (the last 60 are kept). Restoring replaces what’s in this gradebook now — a backup of the current version is made first.'),
    list.length
      ? h('table', { class: 'data' }, h('tbody', null, list.map((b) => h('tr', null,
        h('td', null, new Date(b.mtime).toLocaleString()),
        h('td', { class: 'muted small' }, `${Math.round(b.size / 1024)} KB`),
        h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm', onclick: () => restoreBackup(b) }, 'Restore'))))))
      : h('p', { class: 'muted' }, 'No backups yet.'));
  modal({ title: 'Backups', body, wide: true, buttons: [{ label: 'Open backups folder', value: 'folder' }, { label: 'Close', value: null, primary: true }] })
    .then((v) => { if (v === 'folder') api.openBackupsFolder(); });
}

async function restoreBackup(b) {
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  const ok = await confirmDialog('Restore backup?', `Replace this gradebook with the backup from ${new Date(b.mtime).toLocaleString()}?`, { okLabel: 'Restore', danger: true });
  if (!ok) return;
  const r = await api.readBackup(b.file);
  if (r.error) { toast(r.error, 'error'); return; }
  const path = app.path;
  await app.openDoc({ doc: r.doc, path });
  app.changed();
  await flushSave();
  toast('Backup restored', 'ok');
}

async function closeGradebook() {
  await flushSave();
  await api.closeFile();
  renderWelcome();
}

function openSample() {
  app.openDoc({ doc: M.sampleDoc(), path: null, sample: true });
}

app.commands = { newGradebook, openGradebook, importSpreadsheet, exportExcel, saveCopy, newSchoolYear, showBackups, closeGradebook, openSample };

let lastUndoAt = 0;
function handleMenu(cmd, arg) {
  if (document.querySelector('.modal-back') && !['undo', 'redo'].includes(cmd)) return;
  switch (cmd) {
    case 'new': return newGradebook();
    case 'open': return openGradebook();
    case 'openPath': return openGradebook(arg);
    case 'import': return importSpreadsheet();
    case 'export': return exportExcel();
    case 'saveAs': return saveCopy();
    case 'newYear': return newSchoolYear();
    case 'backups': return showBackups();
    case 'close': return closeGradebook();
    case 'sample': return openSample();
    case 'view': return app.doc || arg === 'help' ? app.go(arg) : null;
    case 'undo':
    case 'redo': {
      const a = document.activeElement;
      const textField = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'));
      if (textField) { document.execCommand(cmd); return; }
      if (Date.now() - lastUndoAt < 80) return;
      lastUndoAt = Date.now();
      if (!app.doc) return;
      return cmd === 'undo' ? app.undo() : app.redo();
    }
    default:
      if (app.current && app.current.command) {
        const handled = app.current.command(cmd, arg);
        if (handled !== false) return;
      }
      if (cmd === 'print') toast('Open Report Cards, Averages or Graphs to print.');
      if (cmd === 'selectAll') document.execCommand('selectAll');
  }
}

// ---------- startup ----------
(async function start() {
  api.onMenu(handleMenu);
  api.onOpenPath((p) => openGradebook(p));
  api.onBeforeClose(async () => {
    try {
      // Let a text box that's being edited fire its change event first.
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      await new Promise((r) => setTimeout(r, 30));
      await flushSave();
    } finally { api.closeReady(); }
  });
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      // Menu accelerators normally handle these; this is a fallback.
      const a = document.activeElement;
      const textField = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'));
      if (textField) return;
      e.preventDefault();
      handleMenu(e.key === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  });
  let init = {};
  try { init = await api.init(); } catch (e) { console.error(e); }
  app.platform = init.platform || 'win32';
  app.version = init.version;
  app.recent = init.recent || [];
  if (init.opened) await app.openDoc({ doc: init.opened.doc, path: init.opened.path });
  else {
    renderWelcome();
    if (init.openError) toast(`Couldn’t open your last gradebook — ${init.openError}`, 'error', 8000);
  }
})();

export default app;
