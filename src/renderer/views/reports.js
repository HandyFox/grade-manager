// Report cards, progress reports and comments — preview, print, or save as PDF.
import { h, clear, icon, toast, ordinal } from '../ui.js';
import { outputPages } from '../print.js';

const PERIOD_COLORS = ['#2f5f8f', '#2e6a4f', '#b7862b', '#b4432e', '#7a4e9b', '#2f8c8c', '#6b6b6b', '#c0617f'];

export function mount(app, root) {
  const { M } = app;
  const doc = app.doc;
  const ui = app.reportUi || (app.reportUi = { tab: 'card', period: app.period, who: 'all', pct: true, chart: true, comments: true, scale: true, sign: true });
  if (ui.period >= doc.periods.length) ui.period = doc.periods.length - 1;
  if (ui.who !== 'all' && !app.student(ui.who)) ui.who = 'all';

  const head = h('div', { class: 'view-head' });
  const controls = h('div', { class: 'report-controls' });
  const preview = h('div', { class: 'report-preview' });
  root.append(head, h('div', { class: 'reports-layout' }, controls, preview));

  function seg(options, value, onPick) {
    return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'active' : '', onclick: () => onPick(v) }, label)));
  }
  function check(label, key) {
    const cb = h('input', { type: 'checkbox', checked: ui[key] });
    cb.addEventListener('change', () => { ui[key] = cb.checked; renderPreview(); });
    return h('label', { class: 'check' }, cb, label);
  }
  const group = (label, ...c) => h('div', { class: 'ctrl-group' }, h('div', { class: 'lbl' }, label), ...c);

  function renderHead() {
    clear(head);
    head.append(h('h1', { class: 'view-title' }, 'Report Cards'),
      seg([['card', 'Report cards'], ['progress', 'Progress reports'], ['comments', 'Comments']], ui.tab, (v) => { ui.tab = v; render(); }),
      h('span', { class: 'spacer' }));
    if (ui.tab !== 'comments') {
      head.append(h('button', { class: 'btn', onclick: () => output(false) }, icon('print'), 'Print…'),
        h('button', { class: 'btn primary', onclick: () => output(true) }, icon('pdf'), 'Save PDF'));
    }
  }

  function students() {
    const list = doc.students.filter((s) => !s.inactive);
    return ui.who === 'all' ? list : list.filter((s) => s.id === ui.who).concat(doc.students.filter((s) => s.inactive && s.id === ui.who));
  }

  function renderControls() {
    clear(controls);
    const psel = h('select', null, doc.periods.map((p, i) => h('option', { value: i, selected: i === ui.period }, p.name)));
    psel.addEventListener('change', () => { ui.period = +psel.value; render(); });
    if (ui.tab === 'comments') {
      controls.append(group('Marking period', psel), h('p', { class: 'hint' }, 'Comments appear on that marking period’s report card and progress report. They save as you type.'));
      return;
    }
    const wsel = h('select', null, h('option', { value: 'all', selected: ui.who === 'all' }, `All students (${doc.students.filter((s) => !s.inactive).length})`),
      doc.students.map((s) => h('option', { value: s.id, selected: ui.who === s.id }, s.name)));
    wsel.addEventListener('change', () => { ui.who = wsel.value; renderPreview(); });
    controls.append(
      group(ui.tab === 'card' ? 'Grades through' : 'Marking period', psel),
      group('Students', wsel),
      group('Include',
        check('Percentages next to letters', 'pct'),
        check(ui.tab === 'card' ? 'Bar chart of subject averages' : 'Chart: this period vs. last', 'chart'),
        check('Teacher comments', 'comments'),
        check('Grading scale', 'scale'),
        check('Signature lines', 'sign')),
      h('p', { class: 'hint' }, ui.tab === 'card'
        ? 'One page per student with every marking period so far, the Final, and comments. Later marking periods are left blank.'
        : 'One page per student for a single marking period: homework, test and quiz averages, the RC Grade, and the change from last period. Grades below your red-line are flagged.'));
  }

  // ---------- pages ----------
  function pageHead(title, sub) {
    return h('div', { class: 'rc-head' },
      h('div', null, h('h1', null, doc.info.school || 'Report Card'), h('div', { class: 'rc-school' }, title)),
      h('div', { class: 'rc-meta' }, h('div', null, h('b', null, doc.info.schoolYear)), doc.info.className ? h('div', null, doc.info.className) : null, doc.info.teacher ? h('div', null, `Teacher: ${doc.info.teacher}`) : null, sub ? h('div', null, sub) : null));
  }

  function gradeCell(v, pending) {
    if (pending) return h('td', { class: 'pending' }, '');
    if (v === null || v === undefined) return h('td', { class: 'pending' }, '—');
    const L = app.letter(v);
    return h('td', null, h('b', null, L), ui.pct ? h('span', { style: { color: '#555', marginLeft: '5px' } }, app.fmt(v)) : null);
  }

  function scaleLegend() {
    const parts = doc.scale.slice().reverse().map((r) => `${r.letter} ${r.min}+`);
    parts[parts.length - 1] = `${doc.scale[0].letter} below ${doc.scale[1] ? doc.scale[1].min : ''}`;
    return h('div', { class: 'rc-scale' }, h('b', null, 'Grading scale: '), parts.join(' · '));
  }

  function commentsBox(stu, p) {
    const text = (doc.comments[p] && doc.comments[p][stu.id]) || '';
    return [h('div', { class: 'rc-section' }, `Comments — ${doc.periods[p].name}`), h('div', { class: 'rc-comments' }, text)];
  }

  function signatures() {
    return h('div', { class: 'rc-sign' }, h('div', null, 'Teacher'), h('div', null, 'Parent / Guardian'), h('div', null, 'Date'));
  }

  function reportCard(stu) {
    const R = app.results();
    const through = ui.period;
    const P = doc.periods;
    const isFinal = through === P.length - 1;
    const table = h('table', { class: 'rc' },
      h('thead', null, h('tr', null, h('th', { style: { textAlign: 'left' } }, 'Subject'), P.map((p, i) => h('th', { title: p.name }, ordinal(i + 1))), h('th', null, isFinal ? 'Final' : 'Year to date'))),
      h('tbody', null,
        doc.subjects.filter((s) => P.some((_, p) => R.rc[p][s.id][stu.id] !== null)).map((s) => h('tr', null, h('td', { class: 'subj' }, s.name),
          P.map((_, p) => gradeCell(R.rc[p][s.id][stu.id], p > through)),
          gradeCell(M_mean(P.map((_, p) => (p <= through ? R.rc[p][s.id][stu.id] : null)))))),
        h('tr', { class: 'total' }, h('td', { class: 'subj' }, 'All Subjects'), P.map((_, p) => gradeCell(R.periodAll[p][stu.id], p > through)),
          gradeCell(M_mean(doc.subjects.filter((s) => s.countInAverage !== false).map((s) => M_mean(P.map((_, p) => (p <= through ? R.rc[p][s.id][stu.id] : null))))))),
        h('tr', { class: 'total' }, h('td', { class: 'subj' }, 'All Grades'), P.map(() => h('td', { class: 'pending' })), gradeCell(M_mean(P.map((_, p) => (p <= through ? R.periodAll[p][stu.id] : null)))))));
    return h('div', { class: 'page' },
      pageHead('Report Card', `Through ${P[through].name}`),
      h('div', { class: 'rc-student' }, stu.name),
      table,
      ui.chart ? h('div', { class: 'rc-chart' }, h('img', { src: reportChart(stu, through) })) : null,
      ui.comments ? commentsBox(stu, through) : null,
      ui.scale ? scaleLegend() : null,
      ui.sign ? signatures() : null);
  }

  function progressReport(stu) {
    const R = app.results();
    const p = ui.period;
    const prev = p - 1;
    const low = Number(doc.settings.highlightBelow) || 0;
    const rows = doc.subjects.filter((s) => R.rc[p][s.id][stu.id] !== null || (prev >= 0 && R.rc[prev][s.id][stu.id] !== null)).map((s) => {
      const a = R.cat[p][s.id][stu.id];
      const rc = R.rc[p][s.id][stu.id];
      const before = prev >= 0 ? R.rc[prev][s.id][stu.id] : null;
      const delta = rc !== null && before !== null ? rc - before : null;
      const cat = (c) => (s.type === 'letter' && c !== 'hw' ? h('td', { class: 'pending' }) : h('td', { class: a[c] !== null && a[c] < low ? 'flag' : '' }, app.fmt(a[c]) || '—'));
      return h('tr', null, h('td', { class: 'subj' }, s.name, rc !== null && rc < low ? h('span', { class: 'flag' }, ' ⚑') : null),
        cat('hw'), cat('test'), cat('quiz'),
        h('td', null, h('b', null, app.fmt(rc) || '—')), h('td', null, h('b', null, app.letter(rc))),
        h('td', { style: { color: delta === null ? '#999' : delta >= 0 ? '#2e6a4f' : '#a33' } }, delta === null ? '' : `${delta >= 0 ? '▲' : '▼'} ${app.fmt(Math.abs(delta))}`));
    });
    const all = R.periodAll[p][stu.id];
    const allPrev = prev >= 0 ? R.periodAll[prev][stu.id] : null;
    const table = h('table', { class: 'rc' },
      h('thead', null, h('tr', null, h('th', { style: { textAlign: 'left' } }, 'Subject'), h('th', null, 'Homework / Lessons'), h('th', null, 'Tests'), h('th', null, 'Quizzes'), h('th', null, 'Grade'), h('th', null, 'Letter'), h('th', null, prev >= 0 ? `vs. ${ordinal(prev + 1)}` : ''))),
      h('tbody', null, rows, h('tr', { class: 'total' }, h('td', { class: 'subj' }, 'All Subjects'), h('td'), h('td'), h('td'), h('td', null, app.fmt(all)), h('td', null, app.letter(all)),
        h('td', null, all !== null && allPrev !== null ? `${all - allPrev >= 0 ? '▲' : '▼'} ${app.fmt(Math.abs(all - allPrev))}` : ''))));
    const flagged = doc.subjects.filter((s) => { const v = R.rc[p][s.id][stu.id]; return v !== null && v < low; });
    return h('div', { class: 'page' },
      pageHead(`Progress Report — ${doc.periods[p].name}`, new Date().toLocaleDateString()),
      h('div', { class: 'rc-student' }, stu.name),
      table,
      flagged.length ? h('p', null, h('span', { class: 'flag' }, '⚑ '), `Below ${low} in: ${flagged.map((s) => s.name).join(', ')}.`) : null,
      ui.chart ? h('div', { class: 'rc-chart' }, h('img', { src: progressChart(stu, p) })) : null,
      ui.comments ? commentsBox(stu, p) : null,
      ui.scale ? scaleLegend() : null,
      ui.sign ? signatures() : null);
  }

  // ---------- charts as images ----------
  function chartImage(cfg, w, hgt) {
    const canvas = h('canvas', { width: w, height: hgt });
    const holder = h('div', { style: { position: 'fixed', left: '-10000px', top: 0, width: `${w}px`, height: `${hgt}px` } }, canvas);
    document.body.appendChild(holder);
    cfg.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 2 }, cfg.options || {});
    cfg.plugins = [{ id: 'white', beforeDraw: (c) => { c.ctx.save(); c.ctx.fillStyle = '#fff'; c.ctx.fillRect(0, 0, c.width, c.height); c.ctx.restore(); } }];
    const ch = new window.Chart(canvas, cfg);
    const url = ch.toBase64Image('image/png');
    ch.destroy();
    holder.remove();
    return url;
  }

  const baseOptions = (legend) => ({
    plugins: { legend: { display: legend, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    scales: { y: { min: 50, suggestedMax: 100, ticks: { stepSize: 10, font: { size: 10 } } }, x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: false } } },
  });

  function reportChart(stu, through) {
    const R = app.results();
    const subs = doc.subjects.filter((s) => doc.periods.some((_, p) => p <= through && R.rc[p][s.id][stu.id] !== null));
    const datasets = doc.periods.map((per, p) => ({ label: per.name, data: subs.map((s) => (p <= through ? R.rc[p][s.id][stu.id] : null)), backgroundColor: PERIOD_COLORS[p % PERIOD_COLORS.length] }))
      .filter((d, p) => p <= through && d.data.some((v) => v !== null));
    return chartImage({ type: 'bar', data: { labels: subs.map((s) => s.name), datasets }, options: baseOptions(true) }, 900, 290);
  }

  function progressChart(stu, p) {
    const R = app.results();
    const subs = doc.subjects.filter((s) => R.rc[p][s.id][stu.id] !== null);
    const datasets = [];
    if (p > 0) datasets.push({ label: doc.periods[p - 1].name, data: subs.map((s) => R.rc[p - 1][s.id][stu.id]), backgroundColor: '#c9cfd6' });
    datasets.push({ label: doc.periods[p].name, data: subs.map((s) => R.rc[p][s.id][stu.id]), backgroundColor: PERIOD_COLORS[p % PERIOD_COLORS.length] });
    datasets.push({ label: 'Class average', type: 'line', data: subs.map((s) => R.classRc[p][s.id]), borderColor: '#555', backgroundColor: '#555', showLine: false, pointStyle: 'line', pointRadius: 14, pointBorderWidth: 2 });
    return chartImage({ type: 'bar', data: { labels: subs.map((s) => s.name), datasets }, options: baseOptions(true) }, 900, 290);
  }

  // ---------- comments ----------
  function renderComments() {
    clear(preview);
    const p = ui.period;
    const list = h('div', { class: 'comments-list card card-pad', style: { maxWidth: '820px', margin: '0 auto' } },
      h('h3', null, `Comments — ${doc.periods[p].name}`),
      h('div', { class: 'sub' }, 'Written on each student’s report card and progress report.'),
      doc.students.filter((s) => !s.inactive).map((s) => {
        const ta = h('textarea', { rows: 3, placeholder: `Comment for ${s.name}…` });
        ta.value = (doc.comments[p] && doc.comments[p][s.id]) || '';
        ta.addEventListener('input', () => {
          if (ta.value.trim()) doc.comments[p][s.id] = ta.value; else delete doc.comments[p][s.id];
          app.changed();
        });
        const R = app.results();
        const v = R.periodAll[p][s.id];
        return h('div', { class: 'comment-item' }, h('label', null, s.name, v !== null ? h('span', { class: 'muted small', style: { fontWeight: 400, marginLeft: '8px' } }, `All Subjects ${app.fmt(v)} ${app.letter(v)}`) : null), ta);
      }));
    preview.appendChild(list);
    preview.style.background = 'var(--paper)';
  }

  // ---------- render ----------
  function buildPages() {
    return students().map((s) => (ui.tab === 'card' ? reportCard(s) : progressReport(s)));
  }

  function renderPreview() {
    clear(preview);
    preview.style.background = '';
    if (!doc.students.length) { preview.appendChild(h('p', { class: 'muted' }, 'Add students in Setup first.')); return; }
    const list = students();
    // Preview the first few pages so it stays quick; printing builds them all.
    const shown = list.slice(0, ui.who === 'all' ? 3 : 1);
    shown.forEach((s) => preview.appendChild(ui.tab === 'card' ? reportCard(s) : progressReport(s)));
    if (list.length > shown.length) preview.appendChild(h('p', { style: { textAlign: 'center', color: '#444' } }, `…and ${list.length - shown.length} more page${list.length - shown.length === 1 ? '' : 's'} when printed.`));
  }

  function render() {
    renderHead();
    renderControls();
    if (ui.tab === 'comments') renderComments(); else renderPreview();
  }

  async function output(pdf) {
    if (ui.tab === 'comments') return;
    const pages = buildPages();
    if (!pages.length) { toast('No students to print'); return; }
    const kind = ui.tab === 'card' ? 'Report Cards' : 'Progress Reports';
    const who = ui.who === 'all' ? '' : ` ${app.student(ui.who).name}`;
    await outputPages(app, pages, { pdf, name: `${kind}${who} ${doc.periods[ui.period].name} ${doc.info.schoolYear}` });
  }

  render();
  return {
    command(cmd) { if (cmd === 'print') { output(false); return true; } return false; },
  };

  function M_mean(vals) { return app.C.mean(vals); }
}
