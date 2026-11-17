// Grades view: marking period + subject selector and a fast, keyboard-driven grade grid.
import { h, clear, toast, modal, promptDialog, icon, shortDate, todayUTC, popupMenu, letterClass, ordinal } from '../ui.js';

const NAME_W = 190, RC_W = 54, LT_W = 42, CAT_W = 58;

export function mount(app, root) {
  const { M, C } = app;
  const doc = app.doc;

  if (!doc.subjects.length || !doc.students.length) {
    root.appendChild(h('div', { class: 'view-scroll' }, h('div', { class: 'grid-empty' },
      h('h2', { class: 'view-title' }, doc.students.length ? 'No subjects yet' : 'No students yet'),
      h('p', null, 'Add your students and subjects in Setup, then come back here to enter grades.'),
      h('button', { class: 'btn primary', onclick: () => app.go('setup') }, 'Go to Setup'))));
    return {};
  }
  if (!app.subject(app.subjectId) || !doc.subjects.some((s) => s.id === app.subjectId)) app.subjectId = doc.subjects[0].id;
  if (app.period >= doc.periods.length) app.period = 0;

  // ---------- state ----------
  const st = {
    rows: [], cols: [], groups: [],
    anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 },
    editing: null, dragging: false,
    filter: '', showInactive: false,
    cellEls: [], sumEls: [], footEls: {}, colHeadEls: [], nameEls: [],
    stickyW: 0, letterMap: C.letterMapOf(doc),
  };

  // ---------- toolbar ----------
  const periodSeg = h('div', { class: 'seg' });
  const findInput = h('input', { type: 'search', placeholder: 'Find student…', style: { width: '170px' } });
  const startInput = h('input', { type: 'date', title: 'The Monday of week 1 — used to show dates over the daily columns' });
  const chips = h('div', { class: 'chips' });
  const subjHead = h('div', { class: 'subject-head' });
  const toolbar = h('div', { class: 'grades-toolbar' },
    h('div', { class: 'tb-row' },
      h('h1', { class: 'view-title', style: { marginRight: '6px' } }, 'Grades'),
      periodSeg,
      h('label', { class: 'check small muted', title: 'The Monday of week 1 — dates then appear over each day' }, 'Week 1 starts', startInput),
      h('span', { class: 'spacer' }),
      findInput),
    chips,
    subjHead);
  const scrollEl = h('div', { class: 'grid-scroll', tabindex: '0' });
  const gridWrap = h('div', { class: 'grid-wrap' }, scrollEl);
  const statusbar = h('div', { class: 'statusbar' });
  root.append(toolbar, gridWrap, statusbar);

  function subj() { return app.subject(app.subjectId); }

  function renderPeriods() {
    clear(periodSeg);
    doc.periods.forEach((p, i) => {
      periodSeg.appendChild(h('button', { class: i === app.period ? 'active' : '', title: p.name, onclick: () => { commitEdit(); app.period = i; doc.settings.currentPeriod = i; renderAll(); } },
        ordinal(i + 1), M.periodHasGrades(doc, i) ? h('span', { class: 'dot', title: 'Has grades' }) : null));
    });
    startInput.value = doc.periods[app.period].start || '';
  }
  startInput.addEventListener('change', () => {
    doc.periods[app.period].start = startInput.value || '';
    app.changed();
    renderGrid();
  });

  function renderChips() {
    clear(chips);
    doc.subjects.forEach((s) => {
      chips.appendChild(h('button', { class: `chip ${s.id === app.subjectId ? 'active' : ''}`, onclick: () => { commitEdit(); app.subjectId = s.id; renderAll(); } },
        s.name, s.type !== 'daily' ? h('span', { class: 'tag' }, s.type === 'letter' ? 'A–F' : 'lessons') : null));
    });
  }

  function renderSubjectHead() {
    clear(subjHead);
    const s = subj();
    subjHead.appendChild(h('h2', { class: 'subject-title' }, s.name));
    subjHead.appendChild(h('span', { class: 'type-tag' }, M.TYPE_LABELS[s.type]));
    if (s.type !== 'letter') {
      const w = doc.weights[app.period][s.id];
      const box = h('div', { class: 'weights', title: 'How much each kind of grade counts toward the RC Grade. They’re relative: 33 / 33 / 33 means equal.' }, h('b', null, 'Weights'));
      for (const c of M.CATS) {
        const inp = h('input', { type: 'number', min: '0', max: '1000', step: '1', value: w[c] });
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          w[c] = isFinite(v) && v >= 0 ? v : 0;
          inp.value = w[c];
          app.changed();
          refreshSummaries();
        });
        box.append(h('span', { class: 'w-label' }, M.catLabel(s, c)), inp);
      }
      const more = h('button', { class: 'icon-btn', title: 'Copy these weights…' }, icon('more'));
      more.addEventListener('click', () => popupMenu(more, [
        { label: 'Use for every marking period', action: () => copyWeights('periods') },
        { label: 'Use for every subject (this period)', action: () => copyWeights('subjects') },
        { label: 'Use for every subject and period', action: () => copyWeights('all') },
      ]));
      box.appendChild(more);
      subjHead.appendChild(box);
    } else {
      subjHead.appendChild(h('span', { class: 'hint' }, `Type letters (A+, B-, …) or code numbers 1–${doc.letterValues.length} (1 = ${doc.letterValues[0].letter}). Letters convert using the letter chart in Setup.`));
    }
    subjHead.appendChild(h('span', { class: 'spacer' }));
    if (s.type === 'daily') {
      const jump = h('select', { title: 'Jump to a week' }, h('option', { value: '' }, 'Jump to…'));
      st.groups.forEach((g, gi) => jump.appendChild(h('option', { value: gi }, g.label)));
      jump.addEventListener('change', () => { if (jump.value !== '') scrollToCol(st.groups[+jump.value].start, true); jump.value = ''; scrollEl.focus(); });
      subjHead.appendChild(jump);
      subjHead.appendChild(h('button', { class: 'btn sm', onclick: goToday, title: 'Jump to today’s column' }, icon('today'), 'Today'));
    }
    subjHead.appendChild(h('button', { class: 'btn sm', onclick: () => fillDialog(), title: 'Fill the selected cells with a grade (Ctrl+Shift+F)' }, icon('fill'), 'Fill…'));
    const anyInactive = doc.students.some((x) => x.inactive);
    if (anyInactive) {
      const cb = h('input', { type: 'checkbox', checked: st.showInactive });
      cb.addEventListener('change', () => { st.showInactive = cb.checked; renderGrid(); });
      subjHead.appendChild(h('label', { class: 'check small' }, cb, 'Show withdrawn'));
    }
  }

  async function copyWeights(scope) {
    const s = subj();
    const w = M.clone(doc.weights[app.period][s.id]);
    const targets = [];
    doc.periods.forEach((_, p) => doc.subjects.forEach((x) => {
      if (x.type === 'letter') return;
      if (scope === 'periods' && x.id !== s.id) return;
      if (scope === 'subjects' && p !== app.period) return;
      targets.push([p, x.id]);
    }));
    targets.forEach(([p, id]) => { doc.weights[p][id] = M.clone(w); });
    app.changed();
    toast(`Weights copied to ${targets.length - 1} other ${scope === 'periods' ? 'marking periods' : 'places'}`, 'ok');
  }

  // ---------- grid model ----------
  function buildModel() {
    const s = subj();
    const p = app.period;
    const q = st.filter.trim().toLowerCase();
    st.rows = doc.students.filter((x) => (st.showInactive || !x.inactive) && (!q || x.name.toLowerCase().includes(q)));
    st.cols = [];
    st.groups = [];
    const today = todayUTC().getTime();
    const sizes = M.sizesFor(doc, s);
    const addGroup = (label, sub) => { st.groups.push({ label, sub, start: st.cols.length, span: 0 }); };
    const pushCol = (col) => { st.groups[st.groups.length - 1].span++; st.cols.push(col); };
    if (s.type === 'daily') {
      const nd = doc.periodConfig.days.length;
      for (let w = 0; w < doc.periodConfig.weeks; w++) {
        const monday = M.slotDate(doc, p, w * nd);
        addGroup(`Week ${w + 1}`, monday ? shortDate(monday) : '');
        for (let d = 0; d < nd; d++) {
          const idx = w * nd + d;
          const date = M.slotDate(doc, p, idx);
          pushCol({ cat: 'hw', idx, head: doc.periodConfig.days[d], sub: date ? String(date.getUTCDate()) : '', title: `Week ${w + 1}, ${dayName(d, nd)}${date ? ` (${shortDate(date)})` : ''}`, groupStart: d === 0, today: date && date.getTime() === today, date });
        }
      }
    } else {
      addGroup(s.type === 'letter' ? 'Grades' : 'Lessons', '');
      for (let i = 0; i < sizes.hw; i++) {
        const lbl = M.getLabel(doc, p, s.id, 'hw', i);
        pushCol({ cat: 'hw', idx: i, head: String(i + 1), sub: lbl, label: lbl, title: `${s.type === 'letter' ? 'Grade' : 'Lesson'} ${i + 1}${lbl ? `: ${lbl}` : ''}`, groupStart: i === 0 });
      }
    }
    for (const cat of ['test', 'quiz']) {
      if (!sizes[cat]) continue;
      addGroup(cat === 'test' ? 'Tests' : 'Quizzes', '');
      for (let i = 0; i < sizes[cat]; i++) {
        const lbl = M.getLabel(doc, p, s.id, cat, i);
        pushCol({ cat, idx: i, head: String(i + 1), sub: lbl, label: lbl, title: `${cat === 'test' ? 'Test' : 'Quiz'} ${i + 1}${lbl ? `: ${lbl}` : ''}`, groupStart: i === 0 });
      }
    }
    st.anchor.r = clamp(st.anchor.r, 0, st.rows.length - 1); st.focus.r = clamp(st.focus.r, 0, st.rows.length - 1);
    st.anchor.c = clamp(st.anchor.c, 0, st.cols.length - 1); st.focus.c = clamp(st.focus.c, 0, st.cols.length - 1);
  }

  function dayName(d, nd) {
    if (nd === 5) return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][d];
    return doc.periodConfig.days[d];
  }

  // ---------- rendering ----------
  function renderGrid() {
    st.editing = null;
    const keepLeft = scrollEl.scrollLeft, keepTop = scrollEl.scrollTop;
    buildModel();
    st.letterMap = C.letterMapOf(doc);
    const s = subj();
    const p = app.period;
    const cats = M.catsFor(s);
    const R = app.results();
    st.cellEls = []; st.sumEls = []; st.colHeadEls = []; st.nameEls = []; st.footEls = { cols: [] };

    // sticky column offsets
    const stickies = [{ key: 'name', w: NAME_W }, { key: 'rc', w: RC_W }, { key: 'lt', w: LT_W }];
    if (s.type !== 'letter') cats.forEach((c) => stickies.push({ key: c, w: CAT_W }));
    let left = 0;
    stickies.forEach((x) => { x.left = left; left += x.w; });
    st.stickyW = left;
    const stickStyle = (x, last) => ({ left: `${x.left}px`, minWidth: `${x.w}px`, maxWidth: `${x.w}px`, width: `${x.w}px`, ...(last ? { borderRight: '2px solid var(--rule-2)' } : {}) });
    const stickyTh = (x, i, label, title) => h('th', { class: `stick ${x.key === 'name' ? 'name' : 'sum'}`, rowspan: '2', style: stickStyle(x, i === stickies.length - 1), title }, label);

    const r1 = h('tr', { class: 'r1' });
    const r2 = h('tr', { class: 'r2' });
    stickies.forEach((x, i) => {
      const label = x.key === 'name' ? 'Student' : x.key === 'rc' ? 'RC' : x.key === 'lt' ? 'Ltr' : M.catShort(s, x.key);
      const title = x.key === 'rc' ? 'Report-card grade for this marking period' : x.key === 'lt' ? 'Letter grade' : x.key === 'name' ? '' : `${M.catLabel(s, x.key)} average`;
      r1.appendChild(stickyTh(x, i, label, title));
    });
    st.groups.forEach((g) => {
      r1.appendChild(h('th', { class: 'group', colspan: String(g.span) }, g.label, g.sub ? h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '6px' } }, g.sub) : null));
    });
    st.cols.forEach((col, c) => {
      const th = h('th', { class: `slot ${col.groupStart ? 'week-start' : ''} ${col.today ? 'today' : ''} ${col.label ? 'labeled' : ''}`, title: col.title + (col.cat !== 'hw' || s.type !== 'daily' ? '\nDouble-click to name it' : '') },
        col.head, col.sub ? h('span', { class: 'dd' }, col.sub.length > 6 ? `${col.sub.slice(0, 5)}…` : col.sub) : null);
      th.addEventListener('mousedown', (e) => { e.preventDefault(); commitEdit(); selectColumn(c, e.shiftKey); });
      th.addEventListener('dblclick', () => renameSlot(col));
      th.addEventListener('contextmenu', (e) => { e.preventDefault(); selectColumn(c, false); columnMenu(th, col); });
      st.colHeadEls.push(th);
      r2.appendChild(th);
    });
    const thead = h('thead', null, r1, r2);

    const tbody = h('tbody');
    st.rows.forEach((stu, r) => {
      const tr = h('tr');
      const nameTd = h('td', { class: 'name stick', style: stickStyle(stickies[0]), title: stu.name }, stu.inactive ? h('span', { class: 'inactive' }, `${stu.name} (withdrawn)`) : stu.name);
      nameTd.addEventListener('mousedown', (e) => { e.preventDefault(); commitEdit(); selectRow(r, e.shiftKey); });
      st.nameEls.push(nameTd);
      tr.appendChild(nameTd);
      const sums = {};
      stickies.slice(1).forEach((x, i) => {
        const td = h('td', { class: 'sum stick', style: stickStyle(x, i === stickies.length - 2) });
        sums[x.key] = td;
        tr.appendChild(td);
      });
      st.sumEls.push(sums);
      const e = M.getEntry(doc, p, s.id, stu.id);
      const rowEls = [];
      st.cols.forEach((col, c) => {
        const td = h('td', { class: `cell ${col.groupStart ? 'week-start' : ''} ${col.today ? 'today' : ''}` });
        td.dataset.r = r; td.dataset.c = c;
        paintCell(td, e ? e[col.cat][col.idx] : null);
        rowEls.push(td);
        tr.appendChild(td);
      });
      st.cellEls.push(rowEls);
      tbody.appendChild(tr);
      paintSummary(r, R);
    });

    const ftr = h('tr');
    ftr.appendChild(h('td', { class: 'stick name', style: stickStyle(stickies[0]) }, 'Class average'));
    stickies.slice(1).forEach((x, i) => {
      const td = h('td', { class: 'stick', style: stickStyle(x, i === stickies.length - 2) });
      st.footEls[x.key] = td;
      ftr.appendChild(td);
    });
    st.cols.forEach((col) => { const td = h('td', { class: col.groupStart ? 'week-start' : '' }); st.footEls.cols.push(td); ftr.appendChild(td); });
    const tfoot = h('tfoot', null, ftr);

    const table = h('table', { class: 'grid' }, thead, tbody, tfoot);
    clear(scrollEl).appendChild(table);
    if (!st.rows.length) scrollEl.appendChild(h('div', { class: 'grid-empty' }, st.filter ? `No student matches “${st.filter}”.` : 'No students to show.'));
    paintFooter(R);
    scrollEl.scrollLeft = keepLeft; scrollEl.scrollTop = keepTop;
    paintSelection();
    updateStatus();
  }

  function display(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    return String(Math.round(v * 100) / 100);
  }

  function paintCell(td, v) {
    td.textContent = display(v);
    const n = C.toNumber(v, st.letterMap);
    td.classList.toggle('low', app.isLow(n));
    td.classList.toggle('over', typeof v === 'number' && v > 100);
  }

  function paintSummary(r, R) {
    const s = subj();
    const stu = st.rows[r];
    const els = st.sumEls[r];
    const p = app.period;
    const rc = R.rc[p][s.id][stu.id];
    els.rc.textContent = app.fmt(rc);
    els.rc.classList.toggle('low', app.isLow(rc));
    clear(els.lt);
    const L = app.letter(rc);
    if (L) els.lt.appendChild(h('span', { class: `lg ${letterClass(L)}` }, L));
    const avg = R.cat[p][s.id][stu.id];
    for (const c of M.CATS) {
      if (!els[c]) continue;
      els[c].textContent = app.fmt(avg[c]);
      els[c].classList.toggle('low', app.isLow(avg[c]));
    }
  }

  function paintFooter(R) {
    const s = subj();
    const p = app.period;
    const f = st.footEls;
    f.rc.textContent = app.fmt(R.classRc[p][s.id]);
    clear(f.lt);
    const L = app.letter(R.classRc[p][s.id]);
    if (L) f.lt.appendChild(h('span', { class: `lg ${letterClass(L)}` }, L));
    for (const c of M.CATS) if (f[c]) f[c].textContent = app.fmt(R.classCat[p][s.id][c]);
    const active = doc.students.filter((x) => !x.inactive);
    st.cols.forEach((col, c) => {
      const vals = active.map((stu) => C.toNumber(M.getGrade(doc, p, s.id, stu.id, col.cat, col.idx), st.letterMap));
      const m = C.mean(vals);
      f.cols[c].textContent = m === null ? '' : String(Math.round(m));
      f.cols[c].title = m === null ? '' : `${C.count(vals)} grades · average ${app.fmt(m)}`;
    });
  }

  function refreshSummaries() {
    const R = app.results();
    st.rows.forEach((_, r) => paintSummary(r, R));
    paintFooter(R);
    updateStatus();
  }

  function refreshCells(changes) {
    const s = subj();
    for (const ch of changes) {
      if (ch.p !== app.period || ch.subj !== s.id) continue;
      const r = st.rows.findIndex((x) => x.id === ch.stu);
      const c = st.cols.findIndex((x) => x.cat === ch.cat && x.idx === ch.idx);
      if (r >= 0 && c >= 0) paintCell(st.cellEls[r][c], M.getGrade(doc, ch.p, ch.subj, ch.stu, ch.cat, ch.idx));
    }
    refreshSummaries();
    periodDots();
  }

  function periodDots() {
    const btns = periodSeg.querySelectorAll('button');
    doc.periods.forEach((_, i) => {
      const has = M.periodHasGrades(doc, i);
      const dot = btns[i] && btns[i].querySelector('.dot');
      if (has && !dot && btns[i]) btns[i].appendChild(h('span', { class: 'dot', title: 'Has grades' }));
      if (!has && dot) dot.remove();
    });
  }

  // ---------- selection ----------
  function rect() {
    return {
      r0: Math.min(st.anchor.r, st.focus.r), r1: Math.max(st.anchor.r, st.focus.r),
      c0: Math.min(st.anchor.c, st.focus.c), c1: Math.max(st.anchor.c, st.focus.c),
    };
  }

  function paintSelection() {
    const R = rect();
    st.cellEls.forEach((row, r) => row.forEach((td, c) => {
      const inSel = r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1;
      td.classList.toggle('sel', inSel && (R.r0 !== R.r1 || R.c0 !== R.c1));
      td.classList.toggle('active', r === st.focus.r && c === st.focus.c);
    }));
    st.colHeadEls.forEach((th, c) => th.classList.toggle('col-active', c >= R.c0 && c <= R.c1));
    st.nameEls.forEach((td, r) => td.classList.toggle('row-active', r >= R.r0 && r <= R.r1));
  }

  function setFocus(r, c, extend) {
    if (!st.rows.length || !st.cols.length) return;
    st.focus = { r: clamp(r, 0, st.rows.length - 1), c: clamp(c, 0, st.cols.length - 1) };
    if (!extend) st.anchor = { ...st.focus };
    paintSelection();
    scrollIntoView(st.focus.r, st.focus.c);
    updateStatus();
  }

  function selectColumn(c, extend) {
    if (!extend) st.anchor = { r: 0, c };
    else st.anchor = { r: 0, c: st.anchor.c };
    st.focus = { r: st.rows.length - 1, c };
    paintSelection();
    updateStatus();
    scrollEl.focus({ preventScroll: true });
  }

  function selectRow(r, extend) {
    if (!extend) st.anchor = { r, c: 0 };
    else st.anchor = { r: st.anchor.r, c: 0 };
    st.focus = { r, c: st.cols.length - 1 };
    paintSelection();
    updateStatus();
    scrollEl.focus({ preventScroll: true });
  }

  function selectAll() {
    st.anchor = { r: 0, c: 0 };
    st.focus = { r: st.rows.length - 1, c: st.cols.length - 1 };
    paintSelection();
    updateStatus();
  }

  function scrollIntoView(r, c) {
    const td = st.cellEls[r] && st.cellEls[r][c];
    if (!td) return;
    const cr = scrollEl.getBoundingClientRect();
    const tr = td.getBoundingClientRect();
    const head = scrollEl.querySelector('thead');
    const foot = scrollEl.querySelector('tfoot');
    const topEdge = cr.top + (head ? head.offsetHeight : 0);
    const botEdge = cr.top + scrollEl.clientHeight - (foot ? foot.offsetHeight : 0);
    const leftEdge = cr.left + st.stickyW;
    const rightEdge = cr.left + scrollEl.clientWidth;
    if (tr.left < leftEdge) scrollEl.scrollLeft -= leftEdge - tr.left;
    else if (tr.right > rightEdge) scrollEl.scrollLeft += tr.right - rightEdge;
    if (tr.top < topEdge) scrollEl.scrollTop -= topEdge - tr.top;
    else if (tr.bottom > botEdge) scrollEl.scrollTop += tr.bottom - botEdge;
  }

  function scrollToCol(c, select) {
    const th = st.colHeadEls[c];
    if (!th) return;
    scrollEl.scrollLeft = Math.max(0, th.offsetLeft - st.stickyW - 8);
    if (select) setFocus(st.focus.r, c);
  }

  function goToday() {
    const c = st.cols.findIndex((x) => x.today);
    if (c < 0) {
      toast(doc.periods[app.period].start ? 'Today isn’t in this marking period.' : 'Set “Week 1 starts” above to show dates and find today.');
      return;
    }
    scrollToCol(c, true);
    scrollEl.focus();
  }

  /** The first column after the last one that has any grades — where you probably want to type next. */
  function nextEmptyCol() {
    const s = subj();
    let last = -1;
    st.cols.forEach((col, c) => {
      if (col.cat !== 'hw') return;
      if (st.rows.some((stu) => M.getGrade(doc, app.period, s.id, stu.id, col.cat, col.idx) !== null)) last = c;
    });
    return Math.min(last + 1, st.cols.length - 1);
  }

  // ---------- editing ----------
  function startEdit(mode, initial) {
    if (st.editing) return;
    const { r, c } = st.focus;
    const td = st.cellEls[r] && st.cellEls[r][c];
    if (!td) return;
    const col = st.cols[c];
    const cur = M.getGrade(doc, app.period, subj().id, st.rows[r].id, col.cat, col.idx);
    const input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off' });
    input.value = initial !== undefined ? initial : display(cur);
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    if (initial === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    st.editing = { r, c, input, mode };
    input.addEventListener('blur', () => {
      // Clicking somewhere else saves the grade (or drops it if it isn't valid).
      setTimeout(() => { if (st.editing && st.editing.input === input && document.activeElement !== input) commitEdit(false, true); }, 0);
    });
  }

  function parse(text) {
    const s = subj();
    return M.parseGradeInput(text, s.type === 'letter' ? doc.letterValues : null);
  }

  function commitEdit(toSelection, fromBlur) {
    const ed = st.editing;
    if (!ed) return true;
    const res = parse(ed.input.value);
    if (!res.ok) {
      toast(res.error, 'error');
      if (fromBlur) { cancelEdit(true); return false; }
      ed.input.focus();
      ed.input.select();
      return false;
    }
    st.editing = null;
    const s = subj();
    const changes = [];
    if (toSelection) {
      const R = rect();
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) changes.push(change(r, c, res.value));
    } else {
      changes.push(change(ed.r, ed.c, res.value));
    }
    const td = st.cellEls[ed.r][ed.c];
    if (ed.input.parentNode === td) td.removeChild(ed.input);
    const wasFocused = !fromBlur;
    const n = app.applyGradeChanges(changes, toSelection ? `Fill ${changes.length} cells` : `Grade for ${st.rows[ed.r].name}`);
    if (!n) paintCell(td, M.getGrade(doc, app.period, s.id, st.rows[ed.r].id, st.cols[ed.c].cat, st.cols[ed.c].idx));
    else refreshCells(changes);
    if (wasFocused) scrollEl.focus({ preventScroll: true });
    return true;
  }

  function cancelEdit(keepFocus) {
    const ed = st.editing;
    if (!ed) return;
    st.editing = null;
    const td = st.cellEls[ed.r] && st.cellEls[ed.r][ed.c];
    if (!td) return;
    if (ed.input.parentNode === td) td.removeChild(ed.input);
    const col = st.cols[ed.c];
    paintCell(td, M.getGrade(doc, app.period, subj().id, st.rows[ed.r].id, col.cat, col.idx));
    if (!keepFocus) scrollEl.focus({ preventScroll: true });
  }

  function change(r, c, to) {
    const col = st.cols[c];
    return { p: app.period, subj: subj().id, stu: st.rows[r].id, cat: col.cat, idx: col.idx, to };
  }

  function clearSelection() {
    const R = rect();
    const changes = [];
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) changes.push(change(r, c, null));
    if (app.applyGradeChanges(changes, `Clear ${changes.length > 1 ? `${changes.length} cells` : 'grade'}`)) refreshCells(changes);
  }

  function fillDown() {
    const R = rect();
    if (R.r0 === R.r1) { toast('Select a range that’s taller than one row, then Fill Down copies the top grade down.'); return; }
    const changes = [];
    for (let c = R.c0; c <= R.c1; c++) {
      const col = st.cols[c];
      const v = M.getGrade(doc, app.period, subj().id, st.rows[R.r0].id, col.cat, col.idx);
      for (let r = R.r0 + 1; r <= R.r1; r++) changes.push(change(r, c, v));
    }
    if (app.applyGradeChanges(changes, 'Fill down')) refreshCells(changes);
  }

  async function fillDialog() {
    commitEdit();
    const R = rect();
    const single = R.r0 === R.r1 && R.c0 === R.c1;
    const valueInput = h('input', { type: 'text', placeholder: subj().type === 'letter' ? 'e.g. A' : 'e.g. 100', style: { width: '120px' } });
    const scope = h('select', null,
      h('option', { value: 'empty-cols', selected: single }, 'Empty cells in the selected column(s) — everyone without a grade'),
      h('option', { value: 'cols' }, 'Every cell in the selected column(s)'),
      h('option', { value: 'sel', selected: !single }, 'The selected cells'),
      h('option', { value: 'empty-sel' }, 'Only empty selected cells'));
    const colNames = [...new Set(st.cols.slice(R.c0, R.c1 + 1).map((c) => c.title))];
    const body = h('div', null,
      h('p', null, h('b', null, colNames.length === 1 ? colNames[0] : `${colNames.length} columns`)),
      h('div', { class: 'form-row' }, h('label', { class: 'field', style: { flex: '0 0 auto' } }, h('span', null, 'Grade'), valueInput), h('label', { class: 'field' }, h('span', null, 'Put it in'), scope)),
      h('p', { class: 'hint' }, 'Tip: to give the whole class 100 except a few, type the few grades first, then fill the empty cells with 100. Leave the grade blank to clear cells.'));
    const ok = await modal({ title: 'Fill grades', body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Fill', value: true, primary: true }] });
    if (!ok) return;
    const res = parse(valueInput.value);
    if (!res.ok) { toast(res.error, 'error'); return; }
    const sc = scope.value;
    const rows = sc === 'cols' || sc === 'empty-cols' ? [0, st.rows.length - 1] : [R.r0, R.r1];
    const onlyEmpty = sc.startsWith('empty');
    const changes = [];
    for (let r = rows[0]; r <= rows[1]; r++) {
      for (let c = R.c0; c <= R.c1; c++) {
        const col = st.cols[c];
        if (onlyEmpty && M.getGrade(doc, app.period, subj().id, st.rows[r].id, col.cat, col.idx) !== null) continue;
        changes.push(change(r, c, res.value));
      }
    }
    const n = app.applyGradeChanges(changes, `Fill ${changes.length} cells`);
    refreshCells(changes);
    toast(n ? `Filled ${n} cell${n === 1 ? '' : 's'}` : 'Nothing to fill', n ? 'ok' : '');
  }

  async function renameSlot(col) {
    const s = subj();
    if (col.cat === 'hw' && s.type === 'daily') { toast('Daily columns are named by date. Set “Week 1 starts” to show dates.'); return; }
    const kind = col.cat === 'test' ? 'test' : col.cat === 'quiz' ? 'quiz' : s.type === 'letter' ? 'grade' : 'lesson';
    const v = await promptDialog(`Name ${kind} ${col.idx + 1}`, `Name for ${s.name} ${kind} ${col.idx + 1} (${doc.periods[app.period].name})`, col.label, { placeholder: kind === 'test' ? 'e.g. Chapter 3' : 'e.g. Lesson 12' });
    if (v === null) return;
    M.setLabel(doc, app.period, s.id, col.cat, col.idx, v.trim());
    app.changed();
    renderGrid();
  }

  function columnMenu(anchor, col) {
    const s = subj();
    const items = [];
    if (!(col.cat === 'hw' && s.type === 'daily')) items.push({ label: 'Name this column…', action: () => renameSlot(col) });
    items.push({ label: 'Fill empty cells…', action: () => fillDialog() });
    items.push({ label: 'Clear this column', action: () => clearSelection() });
    popupMenu(anchor, items);
  }

  // ---------- clipboard ----------
  function selectionTSV() {
    const R = rect();
    const lines = [];
    for (let r = R.r0; r <= R.r1; r++) {
      const vals = [];
      for (let c = R.c0; c <= R.c1; c++) {
        const col = st.cols[c];
        vals.push(display(M.getGrade(doc, app.period, subj().id, st.rows[r].id, col.cat, col.idx)));
      }
      lines.push(vals.join('\t'));
    }
    return lines.join('\n');
  }

  function paste(text) {
    let lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const block = lines.map((l) => l.split('\t'));
    const R = rect();
    const changes = [];
    let bad = 0, clipped = 0;
    if (block.length === 1 && block[0].length === 1) {
      const res = parse(block[0][0]);
      if (!res.ok) { toast(res.error, 'error'); return; }
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) changes.push(change(r, c, res.value));
    } else {
      block.forEach((cells, i) => cells.forEach((txt, j) => {
        const r = R.r0 + i, c = R.c0 + j;
        if (r >= st.rows.length || c >= st.cols.length) { if (txt.trim()) clipped++; return; }
        const res = parse(txt);
        if (!res.ok) { bad++; return; }
        changes.push(change(r, c, res.value));
      }));
      st.anchor = { r: R.r0, c: R.c0 };
      st.focus = { r: Math.min(R.r0 + block.length - 1, st.rows.length - 1), c: Math.min(R.c0 + Math.max(...block.map((b) => b.length)) - 1, st.cols.length - 1) };
    }
    const n = app.applyGradeChanges(changes, `Paste ${changes.length} cells`);
    refreshCells(changes);
    paintSelection();
    const notes = [];
    if (n) notes.push(`Pasted ${n} grade${n === 1 ? '' : 's'}`);
    if (bad) notes.push(`${bad} cell${bad === 1 ? '' : 's'} skipped (not a grade)`);
    if (clipped) notes.push(`${clipped} didn’t fit`);
    if (notes.length) toast(notes.join(' · '), bad || clipped ? '' : 'ok');
  }

  function gridFocused() {
    return document.activeElement === scrollEl || (st.editing && document.activeElement === st.editing.input);
  }
  function onCopy(e) {
    if (!gridFocused() || st.editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTSV());
  }
  function onCut(e) {
    if (!gridFocused() || st.editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTSV());
    clearSelection();
  }
  function onPaste(e) {
    if (!gridFocused() || st.editing) return;
    e.preventDefault();
    paste(e.clipboardData.getData('text/plain'));
  }
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);

  // ---------- keyboard ----------
  scrollEl.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const { r, c } = st.focus;
    const enterDown = doc.settings.enterDirection !== 'right';
    if (st.editing) {
      const ed = st.editing;
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (mod) { commitEdit(true); return; }
          if (commitEdit()) moveAfterEnter(e.shiftKey, enterDown);
          return;
        case 'Tab':
          e.preventDefault();
          if (commitEdit()) setFocus(r, c + (e.shiftKey ? -1 : 1));
          return;
        case 'Escape': e.preventDefault(); cancelEdit(); return;
        case 'ArrowUp': case 'ArrowDown':
          e.preventDefault();
          if (commitEdit()) setFocus(r + (e.key === 'ArrowUp' ? -1 : 1), c);
          return;
        case 'ArrowLeft': case 'ArrowRight':
          if (ed.mode === 'enter') { e.preventDefault(); if (commitEdit()) setFocus(r, c + (e.key === 'ArrowLeft' ? -1 : 1)); }
          return;
        default: return;
      }
    }
    if (mod) {
      if (e.key === 'Enter') { e.preventDefault(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.key === 'ArrowRight') setFocus(r, st.cols.length - 1, e.shiftKey);
        if (e.key === 'ArrowLeft') setFocus(r, 0, e.shiftKey);
        if (e.key === 'ArrowDown') setFocus(st.rows.length - 1, c, e.shiftKey);
        if (e.key === 'ArrowUp') setFocus(0, c, e.shiftKey);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); setFocus(r - 1, c, e.shiftKey); return;
      case 'ArrowDown': e.preventDefault(); setFocus(r + 1, c, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); setFocus(r, c - 1, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); setFocus(r, c + 1, e.shiftKey); return;
      case 'Tab': e.preventDefault(); setFocus(r, c + (e.shiftKey ? -1 : 1)); return;
      case 'Enter': e.preventDefault(); moveAfterEnter(e.shiftKey, enterDown); return;
      case 'Home': e.preventDefault(); setFocus(r, 0, e.shiftKey); return;
      case 'End': e.preventDefault(); setFocus(r, st.cols.length - 1, e.shiftKey); return;
      case 'PageDown': e.preventDefault(); setFocus(r + 10, c, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); setFocus(r - 10, c, e.shiftKey); return;
      case 'Delete': case 'Backspace': e.preventDefault(); clearSelection(); return;
      case 'F2': e.preventDefault(); startEdit('edit'); return;
      default:
        if (e.key.length === 1 && !e.altKey && /[0-9a-zA-Z.+\-\/%]/.test(e.key)) {
          e.preventDefault();
          startEdit('enter', e.key);
        }
    }
  });

  function moveAfterEnter(back, down) {
    const { r, c } = st.focus;
    if (down) {
      const nr = r + (back ? -1 : 1);
      if (!back && nr >= st.rows.length) setFocus(0, c + 1); // wrap to the top of the next column
      else setFocus(nr, c);
    } else {
      setFocus(r, c + (back ? -1 : 1));
    }
  }

  // ---------- mouse ----------
  scrollEl.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td.cell');
    if (!td || (st.editing && e.target === st.editing.input)) return;
    e.preventDefault();
    if (st.editing && !commitEdit()) return;
    scrollEl.focus({ preventScroll: true });
    setFocus(+td.dataset.r, +td.dataset.c, e.shiftKey);
    st.dragging = true;
  });
  scrollEl.addEventListener('mouseover', (e) => {
    if (!st.dragging) return;
    const td = e.target.closest('td.cell');
    if (!td) return;
    st.focus = { r: +td.dataset.r, c: +td.dataset.c };
    paintSelection();
    updateStatus();
  });
  const onUp = () => { st.dragging = false; };
  window.addEventListener('mouseup', onUp);
  scrollEl.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td.cell');
    if (td && !st.editing) startEdit('edit');
  });

  // ---------- status bar ----------
  function updateStatus() {
    clear(statusbar);
    const add = (...els) => statusbar.append(...els.filter(Boolean));
    if (!st.rows.length || !st.cols.length) return;
    const R = rect();
    const s = subj();
    if (R.r0 === R.r1 && R.c0 === R.c1) {
      const stu = st.rows[st.focus.r];
      const col = st.cols[st.focus.c];
      const v = M.getGrade(doc, app.period, s.id, stu.id, col.cat, col.idx);
      add(h('b', null, stu.name), h('span', null, col.title), v !== null ? h('span', null, 'Grade: ', h('b', null, display(v)), typeof v === 'string' ? ` = ${st.letterMap[v] ?? '?'}%` : '') : null);
    } else {
      const vals = [];
      for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
        const col = st.cols[c];
        vals.push(C.toNumber(M.getGrade(doc, app.period, s.id, st.rows[r].id, col.cat, col.idx), st.letterMap));
      }
      const m = C.mean(vals);
      add(h('span', null, h('b', null, (R.r1 - R.r0 + 1) * (R.c1 - R.c0 + 1)), ' cells selected'), h('span', null, h('b', null, C.count(vals)), ' grades'), m !== null ? h('span', null, 'Average ', h('b', null, app.fmt(m))) : null);
    }
    add(h('span', { class: 'spacer' }), h('span', { class: 'muted' },
      s.type === 'letter' ? 'Type a letter or code and press Enter · Ctrl+Enter fills the selection · paste from Excel' : 'Type a grade and press Enter · 17/20 becomes 85 · Ctrl+Enter fills the selection · paste from Excel'));
  }

  // ---------- find ----------
  findInput.addEventListener('input', () => { st.filter = findInput.value; renderGrid(); });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); scrollEl.focus(); setFocus(0, st.focus.c); }
    if (e.key === 'Escape') { findInput.value = ''; st.filter = ''; renderGrid(); scrollEl.focus(); }
  });

  // ---------- lifecycle ----------
  function renderAll() {
    renderPeriods();
    renderChips();
    buildModel();
    renderSubjectHead();
    renderGrid();
    const c = st.cols.findIndex((x) => x.today);
    const target = c >= 0 ? c : nextEmptyCol();
    st.anchor = { r: 0, c: target }; st.focus = { r: 0, c: target };
    scrollEl.scrollLeft = 0; scrollEl.scrollTop = 0;
    paintSelection();
    if (target > 0) scrollToCol(Math.max(0, target - 2), false);
    updateStatus();
    scrollEl.focus({ preventScroll: true });
  }

  renderAll();

  return {
    unmount() {
      commitEdit();
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('mouseup', onUp);
    },
    afterUndo(changes) { refreshCells(changes); },
    command(cmd, arg) {
      switch (cmd) {
        case 'selectAll':
          if (document.activeElement !== scrollEl) return false;
          selectAll(); return true;
        case 'fill': fillDialog(); return true;
        case 'fillDown': fillDown(); return true;
        case 'find': findInput.focus(); findInput.select(); return true;
        case 'subject': {
          const i = doc.subjects.findIndex((x) => x.id === app.subjectId);
          const n = doc.subjects[(i + arg + doc.subjects.length) % doc.subjects.length];
          commitEdit(); app.subjectId = n.id; renderAll();
          return true;
        }
        default: return false;
      }
    },
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
