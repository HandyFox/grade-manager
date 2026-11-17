// Setup: school info, students, subjects, marking periods, weights, grading scale, letter chart, preferences.
import { h, clear, toast, modal, confirmDialog, icon, popupMenu } from '../ui.js';

export function mount(app, root) {
  const { M } = app;
  const doc = app.doc;
  const head = h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Setup'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => app.commands.exportExcel() }, icon('excel'), 'Export to Excel'),
    h('button', { class: 'btn', onclick: () => app.commands.showBackups() }, icon('undo'), 'Backups'),
    h('button', { class: 'btn', onclick: () => app.commands.newSchoolYear() }, icon('new'), 'New school year…'));
  const body = h('div', { class: 'view-scroll' });
  root.append(head, body);

  const changed = (opts) => { app.changed(opts); };
  const structural = () => { app.changed({ structure: true }); rerender(); };
  function rerender() { const t = body.scrollTop; render(); body.scrollTop = t; }

  const card = (title, sub, ...content) => h('section', { class: 'card card-pad' }, h('h3', null, title), sub ? h('div', { class: 'sub' }, sub) : null, ...content);
  const textField = (label, obj, key, after) => {
    const inp = h('input', { type: 'text', value: obj[key] || '' });
    inp.addEventListener('change', () => { obj[key] = inp.value.trim(); changed(); if (after) after(); });
    return h('label', { class: 'field' }, h('span', null, label), inp);
  };
  const numInput = (value, onChange, attrs = {}) => {
    const inp = h('input', { type: 'number', value, ...attrs });
    inp.addEventListener('change', () => onChange(inp));
    return inp;
  };
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

  // ---------- school ----------
  function schoolCard() {
    return card('School & class', 'Shown on report cards and printouts.',
      h('div', { class: 'form-row' }, textField('School year', doc.info, 'schoolYear', app.updateChrome), textField('Class / grade', doc.info, 'className', app.updateChrome)),
      h('div', { class: 'form-row' }, textField('School', doc.info, 'school'), textField('Teacher', doc.info, 'teacher')));
  }

  // ---------- students ----------
  function studentsCard() {
    const tbody = h('tbody');
    doc.students.forEach((s, i) => {
      const name = h('input', { type: 'text', value: s.name });
      name.addEventListener('change', () => { s.name = name.value.trim() || s.name; name.value = s.name; changed(); });
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); const n = tbody.querySelectorAll('input[type=text]')[i + 1]; if (n) n.focus(); else addInput.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); const n = tbody.querySelectorAll('input[type=text]')[i - 1]; if (n) n.focus(); }
      });
      const wd = h('input', { type: 'checkbox', checked: s.inactive });
      wd.addEventListener('change', () => { s.inactive = wd.checked; changed(); rerender(); });
      tbody.appendChild(h('tr', { class: s.inactive ? 'inactive' : '' },
        h('td', { class: 'idx' }, i + 1),
        h('td', null, name),
        h('td', { class: 'act' }, h('label', { class: 'check small', title: 'Withdrawn students keep their grades but are left out of class averages and hidden from the grade sheet' }, wd, 'Withdrawn')),
        h('td', { class: 'act' },
          h('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0, onclick: () => { move(doc.students, i, -1); changed(); rerender(); } }, icon('up')),
          h('button', { class: 'icon-btn', title: 'Move down', disabled: i === doc.students.length - 1, onclick: () => { move(doc.students, i, 1); changed(); rerender(); } }, icon('down')),
          h('button', { class: 'icon-btn', title: 'Delete student', onclick: () => deleteStudent(s) }, icon('trash')))));
    });
    const addInput = h('input', { type: 'text', placeholder: 'New student’s name — press Enter to add', style: { flex: 1 } });
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && addInput.value.trim()) {
        M.addStudent(doc, addInput.value.trim());
        changed();
        rerender();
        const again = body.querySelector('input[data-add-student]');
        if (again) again.focus();
      }
    });
    addInput.setAttribute('data-add-student', '1');
    const sortBtn = h('button', { class: 'btn sm' }, 'Sort…');
    sortBtn.addEventListener('click', () => popupMenu(sortBtn, [
      { label: 'Sort by first name', action: () => sortStudents(false) },
      { label: 'Sort by last name', action: () => sortStudents(true) },
    ]));
    return card(`Students (${doc.students.filter((s) => !s.inactive).length})`, 'Names typed here are used everywhere. Press Enter to jump to the next name.',
      doc.students.length ? h('table', { class: 'list-table' }, tbody) : h('p', { class: 'muted' }, 'No students yet.'),
      h('div', { class: 'row-actions' }, addInput, h('button', { class: 'btn sm', onclick: pasteStudents }, 'Paste a list…'), sortBtn));
  }

  function sortStudents(byLast) {
    const key = (s) => { const parts = s.name.trim().split(/\s+/); return (byLast ? `${parts[parts.length - 1]} ${s.name}` : s.name).toLowerCase(); };
    doc.students.sort((a, b) => key(a).localeCompare(key(b)));
    changed();
    rerender();
  }

  async function pasteStudents() {
    const ta = h('textarea', { rows: 12, placeholder: 'One name per line. You can copy a column of names from Excel.' });
    const ok = await modal({ title: 'Add students', body: h('div', null, ta), buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }] });
    if (!ok) return;
    const names = ta.value.split(/\r?\n/).map((s) => s.split('\t')[0].trim()).filter(Boolean);
    const existing = new Set(doc.students.map((s) => s.name.toLowerCase()));
    let added = 0;
    names.forEach((n) => { if (!existing.has(n.toLowerCase())) { M.addStudent(doc, n); existing.add(n.toLowerCase()); added++; } });
    changed();
    rerender();
    toast(`Added ${added} student${added === 1 ? '' : 's'}`, 'ok');
  }

  async function deleteStudent(s) {
    const n = M.studentHasGrades(doc, s.id);
    const ok = await confirmDialog(`Delete ${s.name}?`,
      n ? h('div', null, h('p', null, `${s.name} has ${n} grade${n === 1 ? '' : 's'}. Deleting removes them for good.`), h('p', { class: 'hint' }, 'If the student moved away, tick “Withdrawn” instead — the grades are kept but left out of class averages.'))
        : `Remove ${s.name} from the class?`,
      { okLabel: 'Delete', danger: true });
    if (!ok) return;
    M.removeStudent(doc, s.id);
    structural();
  }

  // ---------- subjects ----------
  function subjectsCard() {
    const tbody = h('tbody');
    doc.subjects.forEach((s, i) => {
      const name = h('input', { type: 'text', value: s.name });
      name.addEventListener('change', () => { s.name = name.value.trim() || s.name; name.value = s.name; changed(); });
      const type = h('select', null, M.TYPES.map((t) => h('option', { value: t, selected: s.type === t }, M.TYPE_LABELS[t])));
      type.addEventListener('change', () => changeLayout(s, { type: type.value }, () => { type.value = s.type; }));
      const counts = h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } });
      const countInput = (key, label) => {
        const inp = numInput(s[key], () => {
          const v = Math.max(key === 'lessons' ? 1 : 0, Math.min(100, parseInt(inp.value, 10) || 0));
          changeLayout(s, { [key]: v }, () => { inp.value = s[key]; });
        }, { min: key === 'lessons' ? 1 : 0, max: 100, style: { width: '56px' }, title: label });
        counts.append(h('span', { class: 'small muted' }, label), inp);
      };
      if (s.type !== 'daily') countInput('lessons', s.type === 'letter' ? 'Grades' : 'Lessons');
      if (s.type !== 'letter') { countInput('tests', 'Tests'); countInput('quizzes', 'Quizzes'); }
      const avg = h('input', { type: 'checkbox', checked: s.countInAverage !== false });
      avg.addEventListener('change', () => { s.countInAverage = avg.checked; changed(); });
      tbody.appendChild(h('tr', null,
        h('td', { class: 'idx' }, i + 1),
        h('td', null, name),
        h('td', null, type),
        h('td', null, counts),
        h('td', { class: 'act' }, h('label', { class: 'check small', title: 'Count this subject in the All Subjects average' }, avg, 'In avg.')),
        h('td', { class: 'act' },
          h('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0, onclick: () => { move(doc.subjects, i, -1); changed(); rerender(); } }, icon('up')),
          h('button', { class: 'icon-btn', title: 'Move down', disabled: i === doc.subjects.length - 1, onclick: () => { move(doc.subjects, i, 1); changed(); rerender(); } }, icon('down')),
          h('button', { class: 'icon-btn', title: 'Delete subject', onclick: () => deleteSubject(s) }, icon('trash')))));
    });
    const addName = h('input', { type: 'text', placeholder: 'New subject', style: { width: '200px' } });
    const addType = h('select', null, M.TYPES.map((t) => h('option', { value: t }, M.TYPE_LABELS[t])));
    const add = () => { if (!addName.value.trim()) return; M.addSubject(doc, addName.value.trim(), addType.value); M.normalize(doc); changed(); rerender(); };
    addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return card('Subjects', 'Daily subjects get the weekly M–F homework grid. Lessons subjects get numbered lesson columns. Letter-grade subjects are graded A+ to F (like Penmanship and Art).',
      h('table', { class: 'list-table' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Name'), h('th', null, 'Kind'), h('th', null, 'Columns per marking period'), h('th'), h('th'))), tbody),
      h('div', { class: 'row-actions' }, addName, addType, h('button', { class: 'btn sm', onclick: add }, icon('plus'), 'Add subject')));
  }

  async function changeLayout(s, change, revert) {
    const lost = M.gradesLostByResize(doc, { subjectId: s.id, subject: change });
    if (lost) {
      const ok = await confirmDialog('Some grades would be removed', `This change removes ${lost} grade${lost === 1 ? '' : 's'} in ${s.name} that no longer fit. Continue?`, { okLabel: 'Remove them', danger: true });
      if (!ok) { revert(); return; }
    }
    M.updateSubjectLayout(doc, s.id, change);
    structural();
  }

  async function deleteSubject(s) {
    const n = M.subjectHasGrades(doc, s.id);
    const ok = await confirmDialog(`Delete ${s.name}?`, n ? `${s.name} has ${n} grade${n === 1 ? '' : 's'}. Deleting the subject removes them for good.` : `Remove ${s.name}?`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    M.removeSubject(doc, s.id);
    if (app.subjectId === s.id) app.subjectId = doc.subjects[0] ? doc.subjects[0].id : null;
    structural();
  }

  // ---------- marking periods ----------
  function periodsCard() {
    const rows = doc.periods.map((p, i) => {
      const name = h('input', { type: 'text', value: p.name });
      name.addEventListener('change', () => { p.name = name.value.trim() || p.name; changed(); });
      const start = h('input', { type: 'date', value: p.start || '' });
      start.addEventListener('change', () => { p.start = start.value; changed(); });
      return h('tr', null, h('td', { class: 'idx' }, i + 1), h('td', null, name), h('td', null, start));
    });
    const weeks = numInput(doc.periodConfig.weeks, async (inp) => {
      const v = Math.max(1, Math.min(30, parseInt(inp.value, 10) || 10));
      const lost = M.gradesLostByResize(doc, { periodConfig: { weeks: v } });
      if (lost && !(await confirmDialog('Some grades would be removed', `${lost} daily grade${lost === 1 ? '' : 's'} are in weeks past week ${v}. Remove them?`, { okLabel: 'Remove them', danger: true }))) { inp.value = doc.periodConfig.weeks; return; }
      doc.periodConfig.weeks = v;
      M.resizeAll(doc);
      structural();
    }, { min: 1, max: 30, style: { width: '64px' } });
    const daysSel = h('select', null,
      h('option', { value: '4', selected: doc.periodConfig.days.length === 4 }, '4 (M T W T)'),
      h('option', { value: '5', selected: doc.periodConfig.days.length === 5 }, '5 (M T W T F)'),
      h('option', { value: '6', selected: doc.periodConfig.days.length === 6 }, '6 (M T W T F S)'));
    daysSel.addEventListener('change', async () => {
      const n = +daysSel.value;
      const labels = ['M', 'T', 'W', 'T', 'F', 'S'].slice(0, n);
      if (n < doc.periodConfig.days.length) {
        let lost = 0;
        M.eachEntry(doc, (e, _p, sid) => { const s = M.subjectById(doc, sid); if (!s || s.type !== 'daily') return; e.hw.forEach((v, i) => { if (v !== null && i % doc.periodConfig.days.length >= n) lost++; }); });
        if (lost && !(await confirmDialog('Some grades would be removed', `${lost} grade${lost === 1 ? '' : 's'} are on days that would be removed. Continue?`, { okLabel: 'Remove them', danger: true }))) { daysSel.value = String(doc.periodConfig.days.length); return; }
      }
      M.changeDays(doc, labels);
      structural();
    });
    return card('Marking periods', 'Set the Monday each marking period starts so dates show over the daily columns and the Today button works.',
      h('table', { class: 'list-table' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Name'), h('th', null, 'Week 1 starts'))), h('tbody', null, rows)),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: () => { M.addPeriod(doc); structural(); } }, icon('plus'), 'Add marking period'),
        h('button', { class: 'btn sm', disabled: doc.periods.length <= 1, onclick: removePeriod }, 'Remove last'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'check small' }, 'Weeks per period', weeks),
        h('label', { class: 'check small' }, 'School days', daysSel)));
  }

  async function removePeriod() {
    const p = doc.periods.length - 1;
    if (M.periodHasGrades(doc, p) && !(await confirmDialog(`Remove ${doc.periods[p].name}?`, 'It has grades, which will be removed.', { okLabel: 'Remove', danger: true }))) return;
    M.removeLastPeriod(doc);
    if (app.period >= doc.periods.length) app.period = doc.periods.length - 1;
    structural();
  }

  // ---------- weights ----------
  function weightsCard() {
    const ui = app.setupUi || (app.setupUi = { wp: 0 });
    if (ui.wp >= doc.periods.length) ui.wp = 0;
    const psel = h('select', null, doc.periods.map((p, i) => h('option', { value: i, selected: i === ui.wp }, p.name)));
    psel.addEventListener('change', () => { ui.wp = +psel.value; rerender(); });
    const subs = doc.subjects.filter((s) => s.type !== 'letter');
    const tbody = h('tbody', null, subs.map((s) => {
      const w = doc.weights[ui.wp][s.id];
      return h('tr', null, h('td', null, s.name), M.CATS.map((c) => h('td', null, numInput(w[c], (inp) => { const v = parseFloat(inp.value); w[c] = isFinite(v) && v >= 0 ? v : 0; inp.value = w[c]; changed(); }, { min: 0, style: { width: '64px' } }))),
        h('td', { class: 'small muted' }, weightText(w)));
    }));
    const copyAll = async () => {
      if (!(await confirmDialog('Copy weights', `Use the ${doc.periods[ui.wp].name} weights for every marking period?`, { okLabel: 'Copy' }))) return;
      doc.periods.forEach((_, p) => { if (p !== ui.wp) subs.forEach((s) => { doc.weights[p][s.id] = M.clone(doc.weights[ui.wp][s.id]); }); });
      changed();
      toast('Weights copied to every marking period', 'ok');
    };
    return card('Weights', 'How much homework, tests and quizzes count toward each RC Grade. They’re relative: 25 / 50 / 25 means tests count double. If a student has no grades of one kind yet, the others share its weight.',
      h('div', { class: 'row-actions', style: { marginTop: 0, marginBottom: '8px' } }, psel, h('button', { class: 'btn sm', onclick: copyAll }, icon('copy'), 'Copy to all marking periods')),
      h('table', { class: 'list-table' }, h('thead', null, h('tr', null, h('th', null, 'Subject'), h('th', null, 'Homework / Lessons'), h('th', null, 'Tests'), h('th', null, 'Quizzes'), h('th'))), tbody));
  }

  function weightText(w) {
    const t = (Number(w.hw) || 0) + (Number(w.test) || 0) + (Number(w.quiz) || 0);
    if (!t) return 'no weights!';
    return M.CATS.map((c) => `${Math.round((Number(w[c]) || 0) / t * 100)}%`).join(' / ');
  }

  // ---------- grading scale ----------
  function scaleCard() {
    const tbody = h('tbody', null, doc.scale.map((r, i) => {
      const min = numInput(r.min, (inp) => { const v = parseFloat(inp.value); if (isFinite(v)) { r.min = v; M.normalize(doc); changed(); rerender(); } }, { step: '0.5', style: { width: '76px' } });
      const letter = h('input', { type: 'text', value: r.letter, style: { width: '70px' } });
      letter.addEventListener('change', () => { r.letter = letter.value.trim(); changed(); });
      return h('tr', null, h('td', null, min), h('td', null, letter), h('td', { class: 'small muted' }, i < doc.scale.length - 1 ? `${r.min} to under ${doc.scale[i + 1].min}` : `${r.min} and up`),
        h('td', { class: 'act' }, h('button', { class: 'icon-btn', title: 'Remove', disabled: doc.scale.length <= 2, onclick: () => { doc.scale.splice(i, 1); changed(); rerender(); } }, icon('trash'))));
    }));
    return card('Grading scale', 'The lowest percentage for each letter grade (from the old Averages sheet).',
      h('table', { class: 'list-table' }, h('thead', null, h('tr', null, h('th', null, 'From %'), h('th', null, 'Letter'), h('th'), h('th'))), tbody),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: () => { doc.scale.push({ min: 100, letter: '?' }); M.normalize(doc); changed(); rerender(); } }, icon('plus'), 'Add row'),
        h('button', { class: 'btn sm', onclick: async () => { if (await confirmDialog('Reset grading scale', 'Go back to the original scale (A+ 99.5, A 95.5, A- 93.5 … E 62.5, F below)?', { okLabel: 'Reset' })) { doc.scale = M.clone(M.DEFAULT_SCALE); changed(); rerender(); } } }, 'Reset to original')));
  }

  // ---------- letter chart ----------
  function letterCard() {
    const tbody = h('tbody', null, doc.letterValues.map((r, i) => {
      const letter = h('input', { type: 'text', value: r.letter, style: { width: '70px' } });
      letter.addEventListener('change', async () => {
        const old = r.letter;
        const nl = M.normLetter(letter.value);
        if (!nl) { letter.value = old; return; }
        r.letter = nl;
        // rename stored grades too
        M.eachEntry(doc, (e, _p, sid) => { const s = M.subjectById(doc, sid); if (s && s.type === 'letter') e.hw = e.hw.map((v) => (v === old ? nl : v)); });
        changed();
      });
      const val = numInput(r.value, (inp) => { const v = parseFloat(inp.value); if (isFinite(v)) { r.value = v; changed(); } else inp.value = r.value; }, { step: '1', style: { width: '70px' } });
      return h('tr', null, h('td', { class: 'idx' }, i + 1), h('td', null, letter), h('td', null, val, ' %'),
        h('td', { class: 'act' }, h('button', { class: 'icon-btn', title: 'Remove', disabled: doc.letterValues.length <= 2, onclick: () => { doc.letterValues.splice(i, 1); changed(); rerender(); } }, icon('trash'))));
    }));
    return card('Letter chart', 'For letter-graded subjects: the percentage each letter counts as (the spreadsheet’s “red numbers”). The number on the left is the code you can type instead of the letter.',
      h('table', { class: 'list-table' }, h('thead', null, h('tr', null, h('th', null, 'Code'), h('th', null, 'Letter'), h('th', null, 'Counts as'), h('th'))), tbody),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: () => { doc.letterValues.push({ letter: 'P', value: 90 }); changed(); rerender(); } }, icon('plus'), 'Add letter'),
        h('button', { class: 'btn sm', onclick: async () => { if (await confirmDialog('Reset letter chart', 'Go back to A+ 100, A 99, A- 95 … F 62?', { okLabel: 'Reset' })) { doc.letterValues = M.clone(M.DEFAULT_LETTER_VALUES); changed(); rerender(); } } }, 'Reset to original')));
  }

  // ---------- preferences ----------
  function prefsCard() {
    const s = doc.settings;
    const dec = h('select', null, [0, 1, 2].map((d) => h('option', { value: d, selected: s.decimals === d }, d === 0 ? '92' : d === 1 ? '92.3' : '92.33')));
    dec.addEventListener('change', () => { s.decimals = +dec.value; changed(); });
    const enter = h('select', null, h('option', { value: 'down', selected: s.enterDirection !== 'right' }, 'Down to the next student'), h('option', { value: 'right', selected: s.enterDirection === 'right' }, 'Right to the next column'));
    enter.addEventListener('change', () => { s.enterDirection = enter.value; changed(); });
    const low = numInput(s.highlightBelow, (inp) => { const v = parseFloat(inp.value); s.highlightBelow = isFinite(v) ? v : 0; changed(); }, { step: '0.5', style: { width: '76px' } });
    return card('Preferences', null,
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', null, 'Show averages like'), dec),
        h('label', { class: 'field' }, h('span', null, 'Enter key moves'), enter),
        h('label', { class: 'field' }, h('span', null, 'Show grades in red below'), low)));
  }

  function render() {
    clear(body);
    body.appendChild(h('div', { class: 'setup-grid' },
      schoolCard(), prefsCard(),
      h('div', { class: 'wide' }, studentsCard()),
      h('div', { class: 'wide' }, subjectsCard()),
      periodsCard(), weightsCard(),
      scaleCard(), letterCard()));
  }

  render();
  return {};
}
