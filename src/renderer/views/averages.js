// Averages view — the old "Averages" sheet: RC grades by student, subject and marking period.
import { h, clear, icon, letterClass, ordinal } from '../ui.js';
import { outputPages } from '../print.js';

export function mount(app, root) {
  const doc = app.doc;
  const ui = app.averagesUi || (app.averagesUi = { mode: 'class', period: app.period, show: 'both' });
  if (ui.period !== 'final' && ui.period >= doc.periods.length) ui.period = 0;

  const head = h('div', { class: 'view-head' });
  const body = h('div', { class: 'view-scroll' });
  root.append(head, body);

  function cell(v, opts = {}) {
    if (v === null || v === undefined) return h('td', { class: 'n muted' }, opts.blank || '');
    const L = app.letter(v);
    const pct = h('span', { class: `pct ${app.isLow(v) ? 'low' : ''}` }, app.fmt(v));
    const pill = L ? h('span', { class: `lg ${letterClass(L)}` }, L) : '';
    const content = ui.show === 'pct' ? [pct] : ui.show === 'letter' ? [pill] : [pct, pill];
    const td = h('td', { class: `n ${opts.onclick ? 'clickable' : ''}`, onclick: opts.onclick, title: opts.title }, h('span', { class: 'gcell' }, content));
    return td;
  }

  function seg(options, value, onPick) {
    return h('div', { class: 'seg' }, options.map(([v, label, title]) => h('button', { class: v === value ? 'active' : '', title, onclick: () => onPick(v) }, label)));
  }

  function renderHead() {
    clear(head);
    head.append(h('h1', { class: 'view-title' }, 'Averages'),
      seg([['class', 'Class'], ['student', 'One student'], ['classavg', 'Class averages']], ui.mode, (v) => { ui.mode = v; render(); }));
    if (ui.mode === 'class') {
      head.appendChild(seg([...doc.periods.map((p, i) => [i, ordinal(i + 1), p.name]), ['final', 'Final']], ui.period, (v) => { ui.period = v; render(); }));
    }
    if (ui.mode === 'student') {
      const sel = h('select', null, doc.students.map((s) => h('option', { value: s.id, selected: s.id === app.studentId }, s.name)));
      sel.addEventListener('change', () => { app.studentId = sel.value; render(); });
      const i = doc.students.findIndex((s) => s.id === app.studentId);
      head.append(
        h('button', { class: 'icon-btn', title: 'Previous student', disabled: i <= 0, onclick: () => { app.studentId = doc.students[i - 1].id; render(); } }, icon('up')),
        sel,
        h('button', { class: 'icon-btn', title: 'Next student', disabled: i >= doc.students.length - 1, onclick: () => { app.studentId = doc.students[i + 1].id; render(); } }, icon('down')));
    }
    head.append(h('span', { class: 'spacer' }),
      seg([['both', '% + Letter'], ['pct', '%'], ['letter', 'Letter']], ui.show, (v) => { ui.show = v; render(); }),
      h('button', { class: 'btn', onclick: () => print(false) }, icon('print'), 'Print'),
      h('button', { class: 'btn', onclick: () => print(true) }, icon('pdf'), 'PDF'));
  }

  function classTable() {
    const R = app.results();
    const final = ui.period === 'final';
    const p = ui.period;
    const subs = doc.subjects;
    const thead = h('thead', null, h('tr', null, h('th', null, 'Student'), subs.map((s) => h('th', { class: 'n', title: s.countInAverage === false ? 'Not counted in All Subjects' : '' }, s.name, s.countInAverage === false ? '*' : '')), h('th', { class: 'n' }, 'All Subjects'), final ? h('th', { class: 'n' }, 'All Grades') : null));
    const rows = doc.students.map((st) => h('tr', null,
      h('td', null, st.inactive ? h('span', { class: 'muted' }, `${st.name} (withdrawn)`) : st.name),
      subs.map((s) => cell(final ? R.final[s.id][st.id] : R.rc[p][s.id][st.id], final ? {} : { onclick: () => { app.period = p; app.subjectId = s.id; app.go('grades'); }, title: `Open ${s.name} grades` })),
      cell(final ? R.finalAll[st.id] : R.periodAll[p][st.id]),
      final ? cell(R.allGrades[st.id]) : null));
    const avg = h('tr', { class: 'classavg' }, h('td', null, 'Class average'),
      subs.map((s) => cell(final ? R.classFinal[s.id] : R.classRc[p][s.id])),
      cell(final ? R.classFinalAll : R.classPeriodAll[p]),
      final ? cell(R.classAllGrades) : null);
    return h('table', { class: 'data' }, thead, h('tbody', null, rows, avg));
  }

  function studentTable(stuId) {
    const R = app.results();
    const P = doc.periods;
    const thead = h('thead', null, h('tr', null, h('th', null, 'Subject'), P.map((p, i) => h('th', { class: 'n', title: p.name }, `${ordinal(i + 1)}`)), h('th', { class: 'n' }, 'Final')));
    const rows = doc.subjects.map((s) => h('tr', null, h('td', null, s.name),
      P.map((_, p) => cell(R.rc[p][s.id][stuId], { onclick: () => { app.period = p; app.subjectId = s.id; app.go('grades'); }, title: 'Open grades' })),
      cell(R.final[s.id][stuId])));
    const all = h('tr', { class: 'total' }, h('td', null, 'All Subjects'), P.map((_, p) => cell(R.periodAll[p][stuId])), cell(R.finalAll[stuId]));
    const allG = h('tr', { class: 'total' }, h('td', null, 'All Grades'), P.map(() => h('td')), cell(R.allGrades[stuId]));
    return h('table', { class: 'data' }, thead, h('tbody', null, rows, all, allG));
  }

  function classAvgTable() {
    const R = app.results();
    const P = doc.periods;
    const thead = h('thead', null, h('tr', null, h('th', null, 'Subject'), P.map((p, i) => h('th', { class: 'n', title: p.name }, ordinal(i + 1))), h('th', { class: 'n' }, 'Final')));
    const rows = doc.subjects.map((s) => h('tr', null, h('td', null, s.name), P.map((_, p) => cell(R.classRc[p][s.id])), cell(R.classFinal[s.id])));
    const all = h('tr', { class: 'total' }, h('td', null, 'All Subjects'), P.map((_, p) => cell(R.classPeriodAll[p])), cell(R.classFinalAll));
    return h('table', { class: 'data' }, thead, h('tbody', null, rows, all));
  }

  function title() {
    if (ui.mode === 'class') return ui.period === 'final' ? 'Final averages' : doc.periods[ui.period].name;
    if (ui.mode === 'student') { const s = app.student(app.studentId); return s ? s.name : ''; }
    return 'Class averages by marking period';
  }

  function render() {
    if (!app.student(app.studentId) && doc.students[0]) app.studentId = doc.students[0].id;
    renderHead();
    clear(body);
    if (!doc.students.length) { body.appendChild(h('p', { class: 'muted' }, 'Add students in Setup to see averages.')); return; }
    const table = ui.mode === 'class' ? classTable() : ui.mode === 'student' ? studentTable(app.studentId) : classAvgTable();
    body.append(
      h('h2', { class: 'subject-title', style: { margin: '0 0 12px' } }, title()),
      h('div', { class: 'matrix-wrap' }, table),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, ui.mode === 'class' && ui.period !== 'final' ? 'Click a grade to open that subject’s grade sheet.' : '',
        doc.subjects.some((s) => s.countInAverage === false) ? ' * Not counted in All Subjects.' : ''));
  }

  function print(pdf) {
    const pages = [];
    const mk = (t, table) => {
      const page = h('div', { class: 'page landscape' },
        h('div', { class: 'rc-head' }, h('div', null, h('h1', null, t), h('div', { class: 'rc-school' }, doc.info.school || '')),
          h('div', { class: 'rc-meta' }, doc.info.teacher ? h('div', null, doc.info.teacher) : null, h('div', null, doc.info.schoolYear), doc.info.className ? h('div', null, doc.info.className) : null)),
        table);
      table.className = 'rc';
      return page;
    };
    if (ui.mode === 'student') {
      // print every student, one per page
      const keep = app.studentId;
      doc.students.filter((s) => !s.inactive).forEach((s) => { pages.push(mk(s.name, studentTable(s.id))); });
      app.studentId = keep;
    } else {
      pages.push(mk(title(), ui.mode === 'class' ? classTable() : classAvgTable()));
    }
    pages.forEach((pg) => pg.querySelectorAll('.lg').forEach((x) => { x.style.background = 'none'; }));
    outputPages(app, pages, { landscape: true, pdf, name: `${title()} ${doc.info.schoolYear}` });
  }

  render();
  return {
    command(cmd) { if (cmd === 'print') { print(false); return true; } return false; },
  };
}
