// Graphs: compare marking periods day by day, trends across the year, student vs class, and more.
import { h, clear, icon, toast, ordinal, shortDate } from '../ui.js';
import { outputPages } from '../print.js';

const PERIOD_COLORS = ['#2f5f8f', '#2e6a4f', '#b7862b', '#b4432e', '#7a4e9b', '#2f8c8c', '#6b6b6b', '#c0617f'];
const SERIES_COLORS = ['#2f5f8f', '#2e6a4f', '#b4432e', '#b7862b', '#7a4e9b', '#2f8c8c', '#c0617f', '#5a6f2a', '#8a5a2b', '#40507a', '#9a3f6a', '#3c7a5a'];
const CLASS = '__class__';

const PRESETS = [
  { id: 'compare', title: 'Compare marking periods', text: 'Same student, same subject — this period’s daily grades against last period’s.' },
  { id: 'trend', title: 'Progress over the year', text: 'A student’s RC Grades in each subject, period by period.' },
  { id: 'vsclass', title: 'Student vs. class', text: 'One subject: the student’s grades next to the class average.' },
  { id: 'students', title: 'Compare students', text: 'Several students in one subject (or overall) across the year.' },
  { id: 'report', title: 'Report card bar chart', text: 'Subject averages with a bar for each marking period (the original Graphs sheet).' },
  { id: 'categories', title: 'Homework, tests & quizzes', text: 'Where a student’s grade comes from in each subject.' },
  { id: 'distribution', title: 'Grade distribution', text: 'How many students have each letter grade.' },
];

export function mount(app, root) {
  const { M, C } = app;
  const doc = app.doc;
  const ui = app.graphUi || (app.graphUi = {
    preset: 'compare',
    student: doc.students[0] ? doc.students[0].id : CLASS,
    subject: doc.subjects[0] ? doc.subjects[0].id : null,
    periods: [Math.max(0, app.period - 1), app.period].filter((v, i, a) => a.indexOf(v) === i),
    cat: 'hw', group: 'day', running: false, classLine: true, labels: true,
    subjects: null, students: null, period: app.period, distSubject: 'all',
  });
  if (!doc.subjects.some((s) => s.id === ui.subject)) ui.subject = doc.subjects[0] && doc.subjects[0].id;
  if (ui.student !== CLASS && !doc.students.some((s) => s.id === ui.student)) ui.student = doc.students[0] ? doc.students[0].id : CLASS;
  ui.periods = ui.periods.filter((p) => p < doc.periods.length);
  if (!ui.periods.length) ui.periods = [0];
  if (ui.period >= doc.periods.length) ui.period = 0;

  let chart = null;
  const controls = h('div', { class: 'graph-controls' });
  const main = h('div', { class: 'graph-main' });
  root.append(h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Graphs'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: savePng }, icon('image'), 'Save picture'),
    h('button', { class: 'btn', onclick: () => printChart(false) }, icon('print'), 'Print'),
    h('button', { class: 'btn', onclick: () => printChart(true) }, icon('pdf'), 'PDF')),
  h('div', { class: 'graph-layout' }, controls, main));

  if (!doc.students.length || !doc.subjects.length) {
    clear(main).appendChild(h('p', { class: 'muted' }, 'Add students and subjects in Setup, and enter some grades, to see graphs.'));
    return {};
  }

  const subj = () => app.subject(ui.subject);
  const stuName = (id) => (id === CLASS ? 'Class average' : (app.student(id) || {}).name || '');
  const letterMap = () => C.letterMapOf(doc);

  // ---------- controls ----------
  function group(label, ...content) { return h('div', { class: 'ctrl-group' }, h('div', { class: 'lbl' }, label), ...content); }
  function select(options, value, onChange) {
    const s = h('select', null, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function check(label, checked, onChange) {
    const cb = h('input', { type: 'checkbox', checked });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'check' }, cb, label);
  }
  const studentOptions = (withClass) => [...(withClass ? [[CLASS, '— Class average —']] : []), ...doc.students.map((s) => [s.id, s.inactive ? `${s.name} (withdrawn)` : s.name])];
  const studentPick = (withClass = true) => {
    const s = select(studentOptions(withClass), ui.student, (v) => { ui.student = v; draw(); });
    const i = doc.students.findIndex((x) => x.id === ui.student);
    const step = (d) => { const n = doc.students[i + d]; if (n) { ui.student = n.id; renderControls(); draw(); } };
    return group('Student', h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, s,
      h('button', { class: 'icon-btn', title: 'Previous student', onclick: () => step(-1), disabled: i <= 0 }, icon('up')),
      h('button', { class: 'icon-btn', title: 'Next student', onclick: () => step(1), disabled: i < 0 || i >= doc.students.length - 1 }, icon('down'))));
  };
  const subjectPick = (withAll) => group('Subject', select([...(withAll ? [['all', 'All Subjects']] : []), ...doc.subjects.map((s) => [s.id, s.name])], withAll ? ui.distSubject : ui.subject, (v) => {
    if (withAll) ui.distSubject = v; else { ui.subject = v; if (subj().type === 'letter') ui.cat = 'hw'; }
    renderControls(); draw();
  }));
  const periodPick = (withFinal) => group('Marking period', select([...doc.periods.map((p, i) => [i, p.name]), ...(withFinal ? [['final', 'Final']] : [])], ui.period, (v) => { ui.period = v === 'final' ? 'final' : +v; draw(); }));

  function renderControls() {
    clear(controls);
    controls.appendChild(h('div', { class: 'preset' }, PRESETS.map((p) => h('button', { class: `preset-btn ${ui.preset === p.id ? 'active' : ''}`, onclick: () => { ui.preset = p.id; renderControls(); draw(); } }, h('b', null, p.title), h('span', null, p.text)))));
    const s = subj();
    switch (ui.preset) {
      case 'compare': {
        controls.appendChild(studentPick(true));
        controls.appendChild(subjectPick(false));
        const cats = M.catsFor(s);
        controls.appendChild(group('Grades to compare', select(cats.map((c) => [c, M.catLabel(s, c)]), ui.cat, (v) => { ui.cat = v; renderControls(); draw(); })));
        controls.appendChild(group('Marking periods', h('div', { class: 'checks' }, doc.periods.map((p, i) => check(p.name, ui.periods.includes(i), (on) => {
          ui.periods = on ? [...ui.periods, i].sort((a, b) => a - b) : ui.periods.filter((x) => x !== i);
          draw();
        })))));
        if (ui.cat === 'hw' && s.type === 'daily') {
          controls.appendChild(group('Show', select([['day', 'Each day'], ['week', 'Weekly average']], ui.group, (v) => { ui.group = v; draw(); })));
        }
        controls.appendChild(group('Options',
          check('Running average (smooths it out)', ui.running, (v) => { ui.running = v; draw(); }),
          ui.student !== CLASS ? check('Class average (dashed)', ui.classLine, (v) => { ui.classLine = v; draw(); }) : null));
        break;
      }
      case 'trend': {
        controls.appendChild(studentPick(true));
        const sel = ui.subjects || doc.subjects.map((x) => x.id);
        controls.appendChild(group('Subjects', h('div', { class: 'checks' }, doc.subjects.map((x) => check(x.name, sel.includes(x.id), (on) => {
          const cur = ui.subjects || doc.subjects.map((y) => y.id);
          ui.subjects = on ? [...cur, x.id] : cur.filter((y) => y !== x.id);
          draw();
        }))), h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'btn sm', onclick: () => { ui.subjects = doc.subjects.map((x) => x.id); renderControls(); draw(); } }, 'All'),
          h('button', { class: 'btn sm', onclick: () => { ui.subjects = []; renderControls(); draw(); } }, 'None'))));
        controls.appendChild(group('Options', ui.student !== CLASS ? check('Class average for All Subjects (dashed)', ui.classLine, (v) => { ui.classLine = v; draw(); }) : null));
        break;
      }
      case 'vsclass':
        controls.appendChild(studentPick(false));
        controls.appendChild(subjectPick(false));
        controls.appendChild(group('Options', s.type !== 'letter' ? check('Also show homework / test / quiz averages', ui.labels, (v) => { ui.labels = v; draw(); }) : null));
        break;
      case 'students': {
        controls.appendChild(subjectPick(true));
        const sel = ui.students || doc.students.filter((x) => !x.inactive).slice(0, 4).map((x) => x.id);
        controls.appendChild(group('Students', h('div', { class: 'checks' }, doc.students.map((x) => check(x.name, sel.includes(x.id), (on) => {
          const cur = ui.students || sel;
          ui.students = on ? [...cur, x.id] : cur.filter((y) => y !== x.id);
          draw();
        })))));
        controls.appendChild(group('Options', check('Class average (dashed)', ui.classLine, (v) => { ui.classLine = v; draw(); })));
        break;
      }
      case 'report':
        controls.appendChild(studentPick(true));
        break;
      case 'categories':
        controls.appendChild(studentPick(true));
        controls.appendChild(periodPick(false));
        break;
      case 'distribution':
        controls.appendChild(subjectPick(true));
        controls.appendChild(periodPick(true));
        break;
      default:
    }
  }

  // ---------- data ----------
  function rawSeries(stuId, p, s, cat) {
    const n = M.slotCount(doc, s, cat);
    const lm = letterMap();
    if (stuId === CLASS) {
      const arrays = app.activeStudents().map((st) => { const e = M.getEntry(doc, p, s.id, st.id); return e ? C.numbers(e[cat], lm) : null; });
      return C.columnAverages(arrays, n);
    }
    const e = M.getEntry(doc, p, s.id, stuId);
    return e ? C.numbers(e[cat], lm) : new Array(n).fill(null);
  }

  function xLabels(s, cat, n, weekly) {
    const out = [];
    const nd = doc.periodConfig.days.length;
    for (let i = 0; i < n; i++) {
      if (cat === 'hw' && s.type === 'daily') out.push(weekly ? `Week ${i + 1}` : `W${Math.floor(i / nd) + 1} ${doc.periodConfig.days[i % nd]}`);
      else if (cat === 'hw') out.push(`${s.type === 'letter' ? 'Grade' : 'Lesson'} ${i + 1}`);
      else out.push(`${cat === 'test' ? 'Test' : 'Quiz'} ${i + 1}`);
    }
    return out;
  }

  const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

  function compareData() {
    const s = subj();
    const cat = M.catsFor(s).includes(ui.cat) ? ui.cat : 'hw';
    const weekly = cat === 'hw' && s.type === 'daily' && ui.group === 'week';
    const nd = doc.periodConfig.days.length;
    const prep = (arr) => {
      let a = weekly ? C.weeklyAverages(arr, nd) : arr;
      if (ui.running) a = C.runningAverage(a);
      return a.map(r1);
    };
    const datasets = [];
    let maxLen = 0;
    const stats = [];
    ui.periods.forEach((p, k) => {
      const raw = rawSeries(ui.student, p, s, cat);
      const data = prep(raw);
      const last = lastIndex(data);
      maxLen = Math.max(maxLen, last + 1);
      const color = PERIOD_COLORS[p % PERIOD_COLORS.length];
      const isLatest = k === ui.periods.length - 1;
      datasets.push({ label: doc.periods[p].name, data, borderColor: color, backgroundColor: color, borderWidth: isLatest ? 3 : 2, pointRadius: isLatest ? 3.5 : 2.5, tension: 0.1, spanGaps: true, _p: p });
      const plotted = weekly ? C.weeklyAverages(raw, nd) : raw;
      stats.push({ p, avg: C.mean(raw), count: C.count(raw), slope: C.trendSlope(plotted), color });
    });
    if (ui.classLine && ui.student !== CLASS && ui.periods.length) {
      const p = ui.periods[ui.periods.length - 1];
      const data = prep(rawSeries(CLASS, p, s, cat));
      maxLen = Math.max(maxLen, lastIndex(data) + 1);
      datasets.push({ label: `Class average (${ordinal(p + 1)})`, data, borderColor: '#8a8f96', backgroundColor: '#8a8f96', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.1, spanGaps: true });
    }
    const n = Math.max(maxLen, 1);
    datasets.forEach((d) => { d.data = d.data.slice(0, n); });
    const unit = weekly ? 'week' : cat === 'hw' ? (s.type === 'daily' ? 'school day' : s.type === 'letter' ? 'grade' : 'lesson') : cat === 'test' ? 'test' : 'quiz';
    return {
      type: 'line',
      title: `${stuName(ui.student)} — ${s.name} ${M.catLabel(s, cat).toLowerCase()}`,
      subtitle: `${ui.periods.map((p) => doc.periods[p].name).join(' vs. ')}${weekly ? ' · weekly averages' : ''}${ui.running ? ' · running average' : ''}`,
      labels: xLabels(s, cat, n, weekly),
      datasets,
      stats: stats.map((x, i) => {
        const prev = stats[i - 1];
        const delta = prev && prev.avg !== null && x.avg !== null ? x.avg - prev.avg : null;
        return {
          k: doc.periods[x.p].name, v: x.avg === null ? '—' : app.fmt(x.avg), color: x.color,
          d: [x.count ? `${x.count} grade${x.count === 1 ? '' : 's'}` : 'no grades', delta !== null ? arrow(delta, 'vs. before') : null,
            x.slope !== null && x.count > 2 ? trendText(x.slope, unit) : null].filter(Boolean),
        };
      }),
      tooltipExtra: (ds, i) => {
        if (ds._p === undefined || cat !== 'hw' || s.type !== 'daily' || weekly) return '';
        const d = M.slotDate(doc, ds._p, i);
        return d ? ` (${shortDate(d)})` : '';
      },
    };
  }

  function trendData() {
    const R = app.results();
    const sel = ui.subjects || doc.subjects.map((x) => x.id);
    const labels = doc.periods.map((p) => p.name);
    const get = (fnStu, fnClass) => doc.periods.map((_, p) => r1(ui.student === CLASS ? fnClass(p) : fnStu(p)));
    const datasets = doc.subjects.filter((s) => sel.includes(s.id)).map((s, i) => ({
      label: s.name, data: get((p) => R.rc[p][s.id][ui.student], (p) => R.classRc[p][s.id]),
      borderColor: SERIES_COLORS[i % SERIES_COLORS.length], backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length], borderWidth: 2, pointRadius: 3, tension: 0.2, spanGaps: true,
    }));
    datasets.push({ label: 'All Subjects', data: get((p) => R.periodAll[p][ui.student], (p) => R.classPeriodAll[p]), borderColor: '#1d2733', backgroundColor: '#1d2733', borderWidth: 4, pointRadius: 4, tension: 0.2, spanGaps: true });
    if (ui.classLine && ui.student !== CLASS) datasets.push({ label: 'Class — All Subjects', data: doc.periods.map((_, p) => r1(R.classPeriodAll[p])), borderColor: '#8a8f96', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, spanGaps: true });
    const all = datasets.find((d) => d.label === 'All Subjects').data;
    const filled = all.map((v, i) => [v, i]).filter(([v]) => v !== null);
    const stats = [];
    if (filled.length) {
      const [lastV, lastI] = filled[filled.length - 1];
      stats.push({ k: `All Subjects — ${doc.periods[lastI].name}`, v: app.fmt(lastV), d: [app.letter(lastV), filled.length > 1 ? arrow(lastV - filled[filled.length - 2][0], `vs. ${doc.periods[filled[filled.length - 2][1]].name}`) : null].filter(Boolean) });
      const valFor = (s) => (ui.student === CLASS ? R.classRc[lastI][s.id] : R.rc[lastI][s.id][ui.student]);
      const best = doc.subjects.filter((s) => sel.includes(s.id)).map((s) => [s, valFor(s)]).filter(([, v]) => v !== null && v !== undefined).sort((a, b) => b[1] - a[1]);
      if (best.length) {
        stats.push({ k: 'Strongest subject', v: best[0][0].name, d: [app.fmt(best[0][1])] });
        stats.push({ k: 'Needs the most help', v: best[best.length - 1][0].name, d: [app.fmt(best[best.length - 1][1])] });
      }
      if (ui.student !== CLASS) stats.push({ k: 'All Grades (year so far)', v: app.fmt(R.allGrades[ui.student]), d: [app.letter(R.allGrades[ui.student])] });
    }
    return { type: 'line', title: `${stuName(ui.student)} — progress over the year`, subtitle: 'RC Grade for each subject by marking period', labels, datasets, stats };
  }

  function vsClassData() {
    const R = app.results();
    const s = subj();
    const stu = ui.student === CLASS ? (doc.students[0] || {}).id : ui.student;
    const labels = doc.periods.map((p) => p.name);
    const datasets = [
      { label: stuName(stu), data: doc.periods.map((_, p) => r1(R.rc[p][s.id][stu])), borderColor: '#2f5f8f', backgroundColor: '#2f5f8f', borderWidth: 3.5, pointRadius: 4, spanGaps: true, tension: 0.2 },
      { label: 'Class average', data: doc.periods.map((_, p) => r1(R.classRc[p][s.id])), borderColor: '#8a8f96', backgroundColor: '#8a8f96', borderDash: [6, 5], borderWidth: 2.5, pointRadius: 3, spanGaps: true, tension: 0.2 },
    ];
    if (ui.labels && s.type !== 'letter') {
      const cols = { hw: '#2e6a4f', test: '#b4432e', quiz: '#b7862b' };
      M.CATS.forEach((c) => datasets.push({ label: `${M.catLabel(s, c)} (${stuName(stu).split(' ')[0]})`, data: doc.periods.map((_, p) => r1(R.cat[p][s.id][stu][c])), borderColor: cols[c], backgroundColor: cols[c], borderWidth: 1.5, pointRadius: 2.5, spanGaps: true, tension: 0.2 }));
    }
    const stats = [];
    const diffs = doc.periods.map((_, p) => (R.rc[p][s.id][stu] !== null && R.classRc[p][s.id] !== null ? R.rc[p][s.id][stu] - R.classRc[p][s.id] : null));
    const lastP = lastIndex(diffs);
    if (lastP >= 0) {
      stats.push({ k: `${stuName(stu)} — ${doc.periods[lastP].name}`, v: app.fmt(R.rc[lastP][s.id][stu]), d: [app.letter(R.rc[lastP][s.id][stu])] });
      stats.push({ k: 'Class average', v: app.fmt(R.classRc[lastP][s.id]), d: [app.letter(R.classRc[lastP][s.id])] });
      stats.push({ k: 'Difference', v: `${diffs[lastP] >= 0 ? '+' : ''}${app.fmt(diffs[lastP])}`, d: [diffs[lastP] >= 0 ? 'above the class' : 'below the class'], cls: diffs[lastP] >= 0 ? 'up' : 'down' });
    }
    return { type: 'line', title: `${stuName(stu)} vs. the class — ${s.name}`, subtitle: 'RC Grade by marking period', labels, datasets, stats };
  }

  function studentsData() {
    const R = app.results();
    const all = ui.distSubject === 'all';
    const s = all ? null : app.subject(ui.distSubject);
    const sel = ui.students || doc.students.filter((x) => !x.inactive).slice(0, 4).map((x) => x.id);
    const labels = doc.periods.map((p) => p.name);
    const val = (p, id) => (all ? R.periodAll[p][id] : R.rc[p][s.id][id]);
    const datasets = doc.students.filter((x) => sel.includes(x.id)).map((x, i) => ({
      label: x.name, data: doc.periods.map((_, p) => r1(val(p, x.id))), borderColor: SERIES_COLORS[i % SERIES_COLORS.length], backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length], borderWidth: 2.5, pointRadius: 3, spanGaps: true, tension: 0.2,
    }));
    if (ui.classLine) datasets.push({ label: 'Class average', data: doc.periods.map((_, p) => r1(all ? R.classPeriodAll[p] : R.classRc[p][s.id])), borderColor: '#8a8f96', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, spanGaps: true });
    return { type: 'line', title: `Compare students — ${all ? 'All Subjects' : s.name}`, subtitle: 'RC Grade by marking period', labels, datasets, stats: [] };
  }

  function reportData() {
    const R = app.results();
    const labels = doc.subjects.map((s) => s.name).concat('All Subjects');
    const datasets = doc.periods.map((per, p) => ({
      label: per.name,
      data: doc.subjects.map((s) => r1(ui.student === CLASS ? R.classRc[p][s.id] : R.rc[p][s.id][ui.student])).concat(r1(ui.student === CLASS ? R.classPeriodAll[p] : R.periodAll[p][ui.student])),
      backgroundColor: PERIOD_COLORS[p % PERIOD_COLORS.length], borderRadius: 3,
    })).filter((d) => d.data.some((v) => v !== null));
    return { type: 'bar', title: `${stuName(ui.student)} — subject averages`, subtitle: `${doc.info.schoolYear} · one bar per marking period`, labels, datasets, stats: [] };
  }

  function categoriesData() {
    const R = app.results();
    const p = ui.period === 'final' ? 0 : ui.period;
    const subs = doc.subjects.filter((s) => s.type !== 'letter');
    const cols = { hw: '#2e6a4f', test: '#b4432e', quiz: '#b7862b' };
    const datasets = M.CATS.map((c) => ({
      label: c === 'hw' ? 'Homework / Lessons' : M.CAT_LABELS[c],
      data: subs.map((s) => r1(ui.student === CLASS ? R.classCat[p][s.id][c] : R.cat[p][s.id][ui.student][c])),
      backgroundColor: cols[c], borderRadius: 3,
    }));
    datasets.push({ label: 'RC Grade', type: 'line', data: subs.map((s) => r1(ui.student === CLASS ? R.classRc[p][s.id] : R.rc[p][s.id][ui.student])), borderColor: '#1d2733', backgroundColor: '#1d2733', showLine: false, pointRadius: 6, pointStyle: 'rectRot' });
    return { type: 'bar', title: `${stuName(ui.student)} — homework, tests & quizzes`, subtitle: doc.periods[p].name, labels: subs.map((s) => s.name), datasets, stats: [] };
  }

  function distributionData() {
    const R = app.results();
    const all = ui.distSubject === 'all';
    const final = ui.period === 'final';
    const vals = app.activeStudents().map((st) => {
      if (all) return final ? R.finalAll[st.id] : R.periodAll[ui.period][st.id];
      return final ? R.final[ui.distSubject][st.id] : R.rc[ui.period][ui.distSubject][st.id];
    }).filter((v) => v !== null && v !== undefined);
    const letters = doc.scale.slice().reverse().map((r) => r.letter);
    const counts = letters.map((L) => vals.filter((v) => app.letter(v) === L).length);
    const colorFor = (L) => ({ A: '#2e6a4f', B: '#2f5f8f', C: '#b7862b', D: '#c8692c', E: '#b4432e', F: '#b4432e' }[L.charAt(0)] || '#888');
    const mean = C.mean(vals);
    return {
      type: 'bar',
      title: `Grade distribution — ${all ? 'All Subjects' : app.subject(ui.distSubject).name}`,
      subtitle: final ? 'Final' : doc.periods[ui.period].name,
      labels: letters,
      datasets: [{ label: 'Students', data: counts, backgroundColor: letters.map(colorFor), borderRadius: 4 }],
      yInt: true,
      stats: vals.length ? [
        { k: 'Class average', v: app.fmt(mean), d: [app.letter(mean)] },
        { k: 'Highest', v: app.fmt(Math.max(...vals)), d: [] },
        { k: 'Lowest', v: app.fmt(Math.min(...vals)), d: [] },
        { k: `Below ${doc.settings.highlightBelow}`, v: String(vals.filter((v) => app.isLow(v)).length), d: ['students'] },
      ] : [],
    };
  }

  // ---------- drawing ----------
  function buildConfig(data, forPrint) {
    const yMinData = Math.min(...data.datasets.flatMap((d) => d.data).filter((v) => typeof v === 'number'));
    const minY = data.yInt ? 0 : Math.max(0, Math.floor(Math.min(isFinite(yMinData) ? yMinData : 60, 60) / 10) * 10);
    return {
      type: data.type,
      data: { labels: data.labels, datasets: data.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: forPrint ? false : { duration: 250 },
        devicePixelRatio: forPrint ? 2.5 : undefined,
        interaction: { mode: data.type === 'line' ? 'index' : 'nearest', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                if (v === null || v === undefined) return null;
                if (data.yInt) return `${ctx.dataset.label}: ${v}`;
                const extra = data.tooltipExtra ? data.tooltipExtra(ctx.dataset, ctx.dataIndex) : '';
                return `${ctx.dataset.label}: ${app.fmt(v)} ${app.letter(v)}${extra}`;
              },
            },
          },
        },
        scales: {
          y: data.yInt ? { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Students' } }
            : { min: minY, suggestedMax: 100, ticks: { stepSize: 10 }, grid: { color: '#ece9e1' } },
          x: { grid: { display: data.type === 'bar' ? false : true, color: '#f2f0ea' }, ticks: { autoSkip: true, maxRotation: 0, font: { size: 11 } } },
        },
      },
    };
  }

  function currentData() {
    switch (ui.preset) {
      case 'compare': return compareData();
      case 'trend': return trendData();
      case 'vsclass': return vsClassData();
      case 'students': return studentsData();
      case 'report': return reportData();
      case 'categories': return categoriesData();
      case 'distribution': return distributionData();
      default: return compareData();
    }
  }

  function draw() {
    if (chart) { chart.destroy(); chart = null; }
    clear(main);
    const data = currentData();
    const canvas = h('canvas');
    const empty = !data.datasets.some((d) => d.data.some((v) => v !== null && v !== 0)) && !data.yInt;
    main.appendChild(h('div', { class: 'graph-card' },
      h('h2', null, data.title), h('div', { class: 'gsub' }, data.subtitle),
      empty ? h('div', { class: 'grid-empty' }, 'No grades to show yet for this choice.') : h('div', { class: 'chart-box' }, canvas)));
    if (data.stats && data.stats.length) {
      main.appendChild(h('div', { class: 'stats' }, data.stats.map((s) => h('div', { class: 'stat', style: s.color ? { borderTop: `3px solid ${s.color}` } : null },
        h('div', { class: 'k' }, s.k), h('div', { class: `v ${s.cls || ''}` }, s.v),
        (s.d || []).map((x) => (x instanceof Node ? h('div', { class: 'd' }, x) : h('div', { class: 'd' }, x)))))));
    }
    if (!empty) chart = new window.Chart(canvas, buildConfig(data));
  }

  function chartImage(width, height) {
    // Render a fresh, print-quality copy of the chart on a white background.
    const data = currentData();
    const off = h('canvas', { width, height, style: { width: `${width}px`, height: `${height}px`, position: 'fixed', left: '-10000px', top: '0' } });
    const holder = h('div', { style: { width: `${width}px`, height: `${height}px`, position: 'fixed', left: '-10000px', top: '0' } }, off);
    document.body.appendChild(holder);
    const cfg = buildConfig(data, true);
    cfg.options.responsive = false;
    cfg.plugins = [{ id: 'white', beforeDraw: (c) => { const ctx = c.ctx; ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); } }];
    const ch = new window.Chart(off, cfg);
    const url = ch.toBase64Image('image/png');
    ch.destroy();
    holder.remove();
    return { url, data };
  }

  async function savePng() {
    const { url, data } = chartImage(1400, 760);
    const file = await app.api.saveImage(url, data.title.replace(/[—]/g, '-'));
    if (file) toast('Picture saved', 'ok');
  }

  function printChart(pdf) {
    const { url, data } = chartImage(1500, 820);
    const page = h('div', { class: 'page landscape' },
      h('div', { class: 'rc-head' }, h('div', null, h('h1', null, data.title), h('div', { class: 'rc-school' }, data.subtitle)),
        h('div', { class: 'rc-meta' }, doc.info.school ? h('div', null, doc.info.school) : null, h('div', null, doc.info.schoolYear))),
      h('img', { src: url, style: { width: '100%', height: '5.6in', objectFit: 'contain' } }),
      data.stats && data.stats.length ? h('div', { style: { display: 'flex', gap: '28px', marginTop: '10px' } }, data.stats.map((s) => h('div', null, h('div', { style: { fontSize: '10px', color: '#666', textTransform: 'uppercase' } }, s.k), h('div', { style: { fontSize: '18px', fontWeight: 700 } }, s.v), h('div', { style: { fontSize: '11px' } }, (s.d || []).map((x) => (x instanceof Node ? x.textContent : x)).join(' · '))))) : null);
    outputPages(app, [page], { landscape: true, pdf, name: data.title.replace(/[—]/g, '-') });
  }

  function arrow(delta, suffix) {
    const up = delta >= 0;
    return h('span', { class: up ? 'up' : 'down' }, `${up ? '▲' : '▼'} ${app.fmt(Math.abs(delta))} ${suffix}`);
  }
  function trendText(slope, unit) {
    if (Math.abs(slope) < 0.05) return 'holding steady';
    return h('span', { class: slope > 0 ? 'up' : 'down' }, `${slope > 0 ? 'rising' : 'falling'} ~${Math.abs(slope).toFixed(1)} pts per ${unit}`);
  }

  renderControls();
  draw();
  return {
    unmount() { if (chart) chart.destroy(); },
    command(cmd) { if (cmd === 'print') { printChart(false); return true; } return false; },
  };
}

function lastIndex(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && arr[i] !== undefined) return i;
  return -1;
}
