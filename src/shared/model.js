/*
 * Grade Manager — data model.
 *
 * A gradebook is one JSON document (saved as a .gradebook file). It mirrors the
 * structure of the original Excel Grade Manager:
 *   - one class of students
 *   - a list of subjects
 *   - marking periods (default 6), each with a weekly Monday–Friday homework
 *     grid (default 10 weeks), plus test and quiz slots (default 12 / 15)
 *   - homework / test / quiz weights per subject per marking period
 *   - an editable letter-grade scale
 *
 * Works both in the browser (window.GMModel) and in Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'grade-manager';
  const VERSION = 1;
  const CATS = ['hw', 'test', 'quiz'];
  const CAT_LABELS = { hw: 'Homework', test: 'Tests', quiz: 'Quizzes' };
  const CAT_SHORT = { hw: 'Homewk', test: 'Tests', quiz: 'Quizzes' };

  function catLabel(subj, cat) {
    const t = subj && subj.type;
    if (cat === 'hw') return t === 'lessons' ? 'Lessons' : t === 'letter' ? 'Grades' : 'Homework';
    return CAT_LABELS[cat];
  }
  function catShort(subj, cat) {
    const t = subj && subj.type;
    if (cat === 'hw') return t === 'lessons' ? 'Lessons' : t === 'letter' ? 'Average' : 'Homewk';
    return CAT_SHORT[cat];
  }
  function catsFor(subj) { return subj && subj.type === 'letter' ? ['hw'] : CATS; }
  function isLetter(subj) { return !!subj && subj.type === 'letter'; }

  const DEFAULT_PERIOD_NAMES = [
    'First Period', 'Second Period', 'Third Period',
    'Fourth Period', 'Fifth Period', 'Sixth Period',
    'Seventh Period', 'Eighth Period', 'Ninth Period', 'Tenth Period',
  ];

  // Subject types, matching the three kinds of blocks in the original spreadsheet:
  //   daily   — weekly Monday–Friday homework grid + tests + quizzes, weighted (Math, English, …)
  //   lessons — numbered lesson grades + tests + quizzes, weighted (Spelling, Music, Bible)
  //   letter  — letter grades (A+, A, A-, …) converted to percentages and averaged (Penmanship, Art)
  const TYPES = ['daily', 'lessons', 'letter'];
  const TYPE_LABELS = { daily: 'Daily (weekly M–F grid)', lessons: 'Lessons (numbered)', letter: 'Letter grades' };
  const TYPE_DEFAULTS = {
    daily: { lessons: 15, tests: 12, quizzes: 15 },
    lessons: { lessons: 15, tests: 9, quizzes: 9 },
    letter: { lessons: 15, tests: 0, quizzes: 0 },
  };

  const DEFAULT_SUBJECTS = [
    ['Math', 'daily'], ['English', 'daily'], ['Reading', 'daily'], ['History', 'daily'], ['Science', 'daily'],
    ['Bible Memory', 'daily'], ['Spelling', 'lessons'], ['Music', 'lessons'], ['Bible', 'lessons'],
    ['Penmanship', 'letter'], ['Art', 'letter'],
  ];

  // Letter → percentage chart for letter-graded subjects (the "red numbers" in the spreadsheet).
  // Order matters: entry codes 1, 2, 3 … map to A+, A, A- … just like the spreadsheet.
  const DEFAULT_LETTER_VALUES = [
    { letter: 'A+', value: 100 }, { letter: 'A', value: 99 }, { letter: 'A-', value: 95 },
    { letter: 'B+', value: 93 }, { letter: 'B', value: 91 }, { letter: 'B-', value: 87 },
    { letter: 'C+', value: 85 }, { letter: 'C', value: 83 }, { letter: 'C-', value: 79 },
    { letter: 'D', value: 75 }, { letter: 'E', value: 69 }, { letter: 'F', value: 62 },
  ];

  // The scale from the original spreadsheet (Averages!A3:B14).
  const DEFAULT_SCALE = [
    { min: 0, letter: 'F' },
    { min: 62.5, letter: 'E' },
    { min: 69.5, letter: 'D' },
    { min: 75.5, letter: 'C-' },
    { min: 79.5, letter: 'C' },
    { min: 83.5, letter: 'C+' },
    { min: 85.5, letter: 'B-' },
    { min: 87.5, letter: 'B' },
    { min: 91.5, letter: 'B+' },
    { min: 93.5, letter: 'A-' },
    { min: 95.5, letter: 'A' },
    { min: 99.5, letter: 'A+' },
  ];

  const DEFAULT_WEIGHTS = { hw: 33, test: 33, quiz: 33 };

  let idCounter = 0;
  function uid(prefix) {
    idCounter = (idCounter + 1) % 1e6;
    return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + idCounter.toString(36);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function currentSchoolYear(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    // School years roll over in July.
    return d.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }

  function nextSchoolYear(sy) {
    const m = /^(\d{4})\s*[-–\/]\s*(\d{2,4})$/.exec(String(sy || '').trim());
    if (!m) return currentSchoolYear();
    const a = parseInt(m[1], 10) + 1;
    return `${a}-${a + 1}`;
  }

  function createDoc(opts) {
    opts = opts || {};
    const periodCount = opts.periodCount || 6;
    const doc = {
      format: FORMAT,
      version: VERSION,
      info: {
        schoolYear: opts.schoolYear || currentSchoolYear(),
        school: opts.school || '',
        teacher: opts.teacher || '',
        className: opts.className || '',
      },
      settings: {
        decimals: 1,
        enterDirection: 'down',
        highlightBelow: 69.5,
        showLetters: true,
        currentPeriod: 0,
      },
      periodConfig: { weeks: 10, days: ['M', 'T', 'W', 'T', 'F'] },
      letterValues: clone(DEFAULT_LETTER_VALUES),
      periods: [],
      students: [],
      subjects: [],
      scale: clone(DEFAULT_SCALE),
      defaultWeights: clone(DEFAULT_WEIGHTS),
      weights: [],
      grades: [],
      labels: [],
      comments: [],
      created: new Date().toISOString(),
    };
    for (let i = 0; i < periodCount; i++) {
      doc.periods.push({ name: DEFAULT_PERIOD_NAMES[i] || `Period ${i + 1}`, start: '' });
    }
    (opts.subjects || DEFAULT_SUBJECTS).forEach((n) => (Array.isArray(n) ? addSubject(doc, n[0], n[1]) : addSubject(doc, n)));
    (opts.students || []).forEach((n) => addStudent(doc, n));
    return normalize(doc);
  }

  /** Make sure every structural array exists and has the right size. Safe to call often. */
  function normalize(doc) {
    if (!doc || typeof doc !== 'object') throw new Error('Not a gradebook');
    doc.format = FORMAT;
    doc.version = VERSION;
    doc.info = Object.assign({ schoolYear: currentSchoolYear(), school: '', teacher: '', className: '' }, doc.info || {});
    doc.settings = Object.assign({ decimals: 1, enterDirection: 'down', highlightBelow: 69.5, showLetters: true, currentPeriod: 0 }, doc.settings || {});
    doc.periodConfig = Object.assign({ weeks: 10, days: ['M', 'T', 'W', 'T', 'F'] }, doc.periodConfig || {});
    const pc = doc.periodConfig;
    pc.weeks = clampInt(pc.weeks, 1, 30, 10);
    if (!Array.isArray(pc.days) || !pc.days.length) pc.days = ['M', 'T', 'W', 'T', 'F'];
    doc.letterValues = Array.isArray(doc.letterValues) && doc.letterValues.length ? doc.letterValues : clone(DEFAULT_LETTER_VALUES);
    doc.letterValues = doc.letterValues
      .filter((r) => r && String(r.letter || '').trim() && isFinite(parseFloat(r.value)))
      .map((r) => ({ letter: normLetter(r.letter), value: parseFloat(r.value) }));
    doc.periods = Array.isArray(doc.periods) && doc.periods.length ? doc.periods : [{ name: 'First Period', start: '' }];
    doc.periods.forEach((p, i) => {
      if (!p.name) p.name = DEFAULT_PERIOD_NAMES[i] || `Period ${i + 1}`;
      if (typeof p.start !== 'string') p.start = '';
    });
    doc.students = Array.isArray(doc.students) ? doc.students : [];
    doc.subjects = Array.isArray(doc.subjects) ? doc.subjects : [];
    doc.students.forEach((s) => { if (!s.id) s.id = uid('s'); if (typeof s.name !== 'string') s.name = String(s.name || ''); s.inactive = !!s.inactive; });
    doc.subjects.forEach((s) => {
      if (!s.id) s.id = uid('j');
      if (typeof s.name !== 'string') s.name = String(s.name || '');
      if (s.countInAverage === undefined) s.countInAverage = true;
      if (!TYPES.includes(s.type)) s.type = 'daily';
      const d = TYPE_DEFAULTS[s.type];
      s.lessons = clampInt(s.lessons, 1, 100, d.lessons);
      s.tests = s.type === 'letter' ? 0 : clampInt(s.tests, 0, 60, d.tests);
      s.quizzes = s.type === 'letter' ? 0 : clampInt(s.quizzes, 0, 60, d.quizzes);
    });
    doc.scale = Array.isArray(doc.scale) && doc.scale.length ? doc.scale : clone(DEFAULT_SCALE);
    doc.scale = doc.scale
      .filter((r) => r && r.letter !== undefined && isFinite(parseFloat(r.min)))
      .map((r) => ({ min: parseFloat(r.min), letter: String(r.letter).trim() }))
      .sort((a, b) => a.min - b.min);
    doc.defaultWeights = Object.assign(clone(DEFAULT_WEIGHTS), doc.defaultWeights || {});
    const np = doc.periods.length;
    for (const key of ['weights', 'grades', 'labels', 'comments']) {
      if (!Array.isArray(doc[key])) doc[key] = [];
      while (doc[key].length < np) doc[key].push({});
      if (doc[key].length > np) doc[key].length = np;
      doc[key] = doc[key].map((x) => (x && typeof x === 'object' ? x : {}));
    }
    for (let p = 0; p < np; p++) {
      for (const subj of doc.subjects) {
        if (!doc.weights[p][subj.id]) doc.weights[p][subj.id] = clone(doc.defaultWeights);
      }
    }
    resizeAll(doc);
    return doc;
  }

  function clampInt(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  function subjectById(doc, id) {
    return doc.subjects.find((s) => s.id === id) || null;
  }

  /** Number of grade slots of a category for a subject (accepts a subject object or id). */
  function slotCount(doc, subj, cat) {
    const s = typeof subj === 'string' ? subjectById(doc, subj) : subj;
    if (!s) return 0;
    const pc = doc.periodConfig;
    if (s.type === 'letter') return cat === 'hw' ? s.lessons : 0;
    if (cat === 'hw') return s.type === 'lessons' ? s.lessons : pc.weeks * pc.days.length;
    if (cat === 'test') return s.tests;
    return s.quizzes;
  }

  function validValue(v, letter) {
    if (letter) return typeof v === 'string' && v !== '' ? v : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function fitArray(arr, n, letter) {
    const out = Array.isArray(arr) ? arr.slice(0, n) : [];
    while (out.length < n) out.push(null);
    for (let i = 0; i < out.length; i++) out[i] = validValue(out[i], letter);
    return out;
  }

  /** Resize every stored grade array to the current period configuration. */
  function sizesFor(doc, subj) {
    return { hw: slotCount(doc, subj, 'hw'), test: slotCount(doc, subj, 'test'), quiz: slotCount(doc, subj, 'quiz') };
  }

  function resizeAll(doc) {
    doc.grades.forEach((bySubj) => {
      Object.keys(bySubj).forEach((sid) => {
        const subj = subjectById(doc, sid);
        if (!subj) { delete bySubj[sid]; return; }
        const sizes = sizesFor(doc, subj);
        const byStu = bySubj[sid];
        Object.keys(byStu).forEach((stid) => {
          const e = byStu[stid];
          for (const c of CATS) e[c] = fitArray(e[c], sizes[c], isLetter(subj));
        });
      });
    });
    doc.labels.forEach((bySubj) => {
      Object.keys(bySubj).forEach((sid) => {
        const subj = subjectById(doc, sid);
        if (!subj) { delete bySubj[sid]; return; }
        const sizes = sizesFor(doc, subj);
        const l = bySubj[sid];
        for (const c of CATS) {
          if (!Array.isArray(l[c])) l[c] = [];
          l[c] = l[c].slice(0, sizes[c]);
        }
      });
    });
  }

  /**
   * How many entered grades would be thrown away by a change?
   * `change` may contain periodConfig changes ({weeks}) and/or a subject change ({subjectId, lessons, tests, quizzes, type}).
   */
  function gradesLostByResize(doc, change) {
    const tmp = { periodConfig: Object.assign({}, doc.periodConfig, change.periodConfig || {}), subjects: doc.subjects.map((s) => (change.subjectId === s.id ? Object.assign({}, s, change.subject) : s)) };
    let lost = 0;
    eachEntry(doc, (e, _p, sid) => {
      const subj = tmp.subjects.find((s) => s.id === sid);
      if (!subj) return;
      const orig = subjectById(doc, sid);
      const typeFlip = orig && (orig.type === 'letter') !== (subj.type === 'letter');
      const sizes = sizesFor(tmp, subj);
      for (const c of CATS) {
        const from = typeFlip ? 0 : sizes[c];
        for (let i = from; i < e[c].length; i++) if (e[c][i] !== null) lost++;
      }
    });
    return lost;
  }

  /** Change a subject's type or slot counts, keeping grades where they still fit. */
  function updateSubjectLayout(doc, subjId, changes) {
    const subj = subjectById(doc, subjId);
    if (!subj) return;
    const flip = changes.type && (changes.type === 'letter') !== (subj.type === 'letter');
    if (changes.type && changes.type !== subj.type) {
      const d = TYPE_DEFAULTS[changes.type];
      subj.type = changes.type;
      subj.lessons = changes.lessons || d.lessons;
      subj.tests = changes.tests !== undefined ? changes.tests : d.tests;
      subj.quizzes = changes.quizzes !== undefined ? changes.quizzes : d.quizzes;
    } else {
      for (const k of ['lessons', 'tests', 'quizzes']) if (changes[k] !== undefined) subj[k] = changes[k];
    }
    if (flip) doc.grades.forEach((bySubj) => { delete bySubj[subjId]; });
    normalize(doc);
  }

  /** When the number of days per week changes, keep each grade on the same week+day where possible. */
  function changeDays(doc, newDays) {
    const oldDays = doc.periodConfig.days.length;
    const weeks = doc.periodConfig.weeks;
    const nd = newDays.length;
    eachEntry(doc, (e, _p, sid) => {
      const subj = subjectById(doc, sid);
      if (!subj || subj.type !== 'daily') return;
      const out = new Array(weeks * nd).fill(null);
      for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < Math.min(oldDays, nd); d++) out[w * nd + d] = e.hw[w * oldDays + d] ?? null;
      }
      e.hw = out;
    });
    doc.periodConfig.days = newDays.slice();
    resizeAll(doc);
  }

  function eachEntry(doc, fn) {
    doc.grades.forEach((bySubj, p) => {
      Object.keys(bySubj).forEach((sid) => {
        Object.keys(bySubj[sid]).forEach((stid) => fn(bySubj[sid][stid], p, sid, stid));
      });
    });
  }

  function getEntry(doc, p, subjId, stuId) {
    const bySubj = doc.grades[p];
    if (!bySubj) return null;
    const byStu = bySubj[subjId];
    if (!byStu) return null;
    return byStu[stuId] || null;
  }

  function ensureEntry(doc, p, subjId, stuId) {
    const bySubj = doc.grades[p];
    if (!bySubj[subjId]) bySubj[subjId] = {};
    let e = bySubj[subjId][stuId];
    if (!e) {
      const sizes = sizesFor(doc, subjectById(doc, subjId));
      e = { hw: fitArray([], sizes.hw), test: fitArray([], sizes.test), quiz: fitArray([], sizes.quiz) };
      bySubj[subjId][stuId] = e;
    }
    return e;
  }

  function getGrade(doc, p, subjId, stuId, cat, idx) {
    const e = getEntry(doc, p, subjId, stuId);
    if (!e) return null;
    const v = e[cat][idx];
    return v === undefined ? null : v;
  }

  function setGrade(doc, p, subjId, stuId, cat, idx, value) {
    if (value === null || value === undefined || value === '') {
      const e = getEntry(doc, p, subjId, stuId);
      if (e) e[cat][idx] = null;
      return;
    }
    const e = ensureEntry(doc, p, subjId, stuId);
    e[cat][idx] = value;
  }

  function getLabel(doc, p, subjId, cat, idx) {
    const l = doc.labels[p] && doc.labels[p][subjId];
    return (l && l[cat] && l[cat][idx]) || '';
  }

  function setLabel(doc, p, subjId, cat, idx, text) {
    if (!doc.labels[p][subjId]) doc.labels[p][subjId] = { hw: [], test: [], quiz: [] };
    const arr = doc.labels[p][subjId][cat] || (doc.labels[p][subjId][cat] = []);
    while (arr.length <= idx) arr.push('');
    arr[idx] = text || '';
  }

  function addStudent(doc, name) {
    const s = { id: uid('s'), name: String(name || '').trim() || `Student ${doc.students.length + 1}`, inactive: false };
    doc.students.push(s);
    return s;
  }

  function removeStudent(doc, id) {
    doc.students = doc.students.filter((s) => s.id !== id);
    doc.grades.forEach((bySubj) => Object.values(bySubj).forEach((byStu) => { delete byStu[id]; }));
    doc.comments.forEach((c) => { delete c[id]; });
  }

  function addSubject(doc, name, type) {
    const t = TYPES.includes(type) ? type : 'daily';
    const d = TYPE_DEFAULTS[t];
    const s = { id: uid('j'), name: String(name || '').trim() || `Subject ${doc.subjects.length + 1}`, type: t, countInAverage: true, lessons: d.lessons, tests: d.tests, quizzes: d.quizzes };
    doc.subjects.push(s);
    if (Array.isArray(doc.weights)) {
      doc.weights.forEach((w) => { w[s.id] = clone(doc.defaultWeights || DEFAULT_WEIGHTS); });
    }
    return s;
  }

  function removeSubject(doc, id) {
    doc.subjects = doc.subjects.filter((s) => s.id !== id);
    for (const key of ['grades', 'weights', 'labels']) doc[key].forEach((x) => { delete x[id]; });
  }

  function addPeriod(doc) {
    const i = doc.periods.length;
    doc.periods.push({ name: DEFAULT_PERIOD_NAMES[i] || `Period ${i + 1}`, start: '' });
    return normalize(doc);
  }

  function removeLastPeriod(doc) {
    if (doc.periods.length <= 1) return doc;
    doc.periods.pop();
    return normalize(doc);
  }

  function periodHasGrades(doc, p) {
    let found = false;
    const bySubj = doc.grades[p] || {};
    Object.values(bySubj).forEach((byStu) => Object.values(byStu).forEach((e) => {
      if (found) return;
      for (const c of CATS) if (e[c].some((v) => v !== null)) { found = true; return; }
    }));
    return found;
  }

  function normLetter(t) {
    return String(t || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  /** Map of letter -> percentage for letter-graded subjects. */
  function letterValueMap(doc) {
    const m = {};
    (doc.letterValues || DEFAULT_LETTER_VALUES).forEach((r) => { m[normLetter(r.letter)] = r.value; });
    return m;
  }

  function studentHasGrades(doc, stuId) {
    let n = 0;
    doc.grades.forEach((bySubj) => Object.values(bySubj).forEach((byStu) => {
      const e = byStu[stuId];
      if (e) for (const c of CATS) n += e[c].filter((v) => v !== null).length;
    }));
    return n;
  }

  function subjectHasGrades(doc, subjId) {
    let n = 0;
    doc.grades.forEach((bySubj) => {
      const byStu = bySubj[subjId];
      if (byStu) Object.values(byStu).forEach((e) => { for (const c of CATS) n += e[c].filter((v) => v !== null).length; });
    });
    return n;
  }

  /** Date (YYYY-MM-DD) of a homework slot, if the period has a start date. */
  function slotDate(doc, p, hwIndex) {
    const start = doc.periods[p] && doc.periods[p].start;
    if (!start) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    if (!m) return null;
    const nd = doc.periodConfig.days.length;
    const week = Math.floor(hwIndex / nd);
    const day = hwIndex % nd;
    // Find the Monday on/before the start date, then step forward.
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow + week * 7 + day);
    return d;
  }

  // Row order of the paper report card, with the subject names each row usually goes by.
  const CARD_ROWS = [
    ['Bible', ['bible']],
    ['Bible Memory', ['bible memory', 'memory', 'memory work']],
    ['Reading', ['reading']],
    ['English', ['english', 'language', 'grammar', 'language arts']],
    ['Arithmetic', ['arithmetic', 'math', 'mathematics']],
    ['Spelling', ['spelling']],
    ['Social Studies', ['social studies', 'history', 'geography']],
    ['Science/Health', ['science/health', 'science', 'health']],
    ['Penmanship', ['penmanship', 'handwriting']],
    ['Music', ['music']],
    ['Art', ['art']],
    ['Typing', ['typing', 'keyboarding']],
  ];

  /** Default rows for the copy sheet: the paper card's order, matched to this gradebook's subjects. */
  function defaultCopyRows(doc) {
    const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const used = new Set();
    const rows = CARD_ROWS.map(([label, aliases]) => {
      const s = doc.subjects.find((x) => !used.has(x.id) && aliases.includes(norm(x.name)));
      if (s) used.add(s.id);
      return { label, subjectId: s ? s.id : null };
    });
    doc.subjects.forEach((s) => { if (!used.has(s.id)) rows.push({ label: s.name, subjectId: s.id }); });
    return rows;
  }

  /** The copy-sheet rows to use: the teacher's saved order, or the default. Rows for deleted subjects become blank. */
  function copyRows(doc) {
    const saved = doc.settings && doc.settings.copyRows;
    if (!Array.isArray(saved) || !saved.length) return defaultCopyRows(doc);
    const ids = new Set(doc.subjects.map((s) => s.id));
    return saved.map((r) => ({ label: String(r.label || ''), subjectId: r.subjectId && ids.has(r.subjectId) ? r.subjectId : null }));
  }

  /** Start a new school year: keeps the setup, clears all grades and comments. */
  function newYearFrom(doc, opts) {
    opts = opts || {};
    const n = clone(doc);
    n.info.schoolYear = opts.schoolYear || nextSchoolYear(doc.info.schoolYear);
    if (!opts.keepStudents) n.students = [];
    n.grades = n.periods.map(() => ({}));
    n.comments = n.periods.map(() => ({}));
    if (!opts.keepLabels) n.labels = n.periods.map(() => ({}));
    n.periods.forEach((p) => { p.start = ''; });
    n.settings.currentPeriod = 0;
    n.created = new Date().toISOString();
    return normalize(n);
  }

  /** Parse what a teacher typed into a grade cell. Returns {ok, value} — value null means "clear". */
  function parseGradeInput(text, letterValues) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return { ok: true, value: null };
    if (letterValues) {
      // Letter-graded subject: accept a letter (b+) or the spreadsheet's code number (1 = A+, 2 = A, …).
      const L = normLetter(t);
      const hit = letterValues.find((r) => normLetter(r.letter) === L);
      if (hit) return { ok: true, value: normLetter(hit.letter) };
      if (/^\d+$/.test(t)) {
        const code = parseInt(t, 10);
        if (code >= 1 && code <= letterValues.length) return { ok: true, value: normLetter(letterValues[code - 1].letter) };
      }
      return { ok: false, error: `“${t}” isn’t one of the letter grades (${letterValues.map((r) => r.letter).join(', ')}) or a code 1–${letterValues.length}.` };
    }
    let m = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (m) {
      const num = parseFloat(m[1]);
      const den = parseFloat(m[2]);
      if (den <= 0 || num < 0) return { ok: false, error: 'Points must be positive, like 17/20' };
      return { ok: true, value: round(num / den * 100, 2) };
    }
    m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(t.replace(/,/g, '.'));
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 200) return { ok: false, error: 'Grades above 200 aren\'t allowed' };
      return { ok: true, value: v };
    }
    return { ok: false, error: `“${t}” isn’t a grade. Type a number (like 92) or points (like 17/20).` };
  }

  function round(v, d) {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  /** A realistic demo gradebook so people can try every feature. */
  function sampleDoc() {
    const names = ['Abigail Martin', 'Benjamin Hoover', 'Caleb Zimmerman', 'Daniel Weaver', 'Elizabeth Nolt', 'Faith Burkholder',
      'Grace Stauffer', 'Hannah Good', 'Isaac Martin', 'Jacob Horst', 'Katie Sensenig', 'Levi Hurst', 'Mary Ann Leid', 'Nathan Groff'];
    const doc = createDoc({ students: names, school: 'Maple Grove Christian School', teacher: 'Mr. Stauffer' });
    doc.info.className = 'Grade 5';
    doc.periods.forEach((p, i) => {
      const d = new Date(Date.UTC(2026, 7, 31 + i * 7 * 6));
      p.start = d.toISOString().slice(0, 10);
    });
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
    const filledPeriods = 3; // first three marking periods have grades, like mid-year
    doc.students.forEach((st, si) => {
      const ability = 80 + gauss() * 18 + (si % 3) * 2;
      doc.subjects.forEach((sub) => {
        const subjBias = gauss() * 6;
        const g = (extra, spread) => Math.round(Math.max(30, Math.min(100, ability + subjBias + extra + gauss() * spread)));
        for (let p = 0; p < filledPeriods; p++) {
          const trend = (p - 1) * (gauss() * 3);
          const partial = p === filledPeriods - 1;
          if (sub.type === 'letter') {
            const n = partial ? 6 : 12;
            for (let i = 0; i < n; i++) {
              const v = g(trend, 8);
              const row = doc.letterValues.find((r) => v >= r.value - 2) || doc.letterValues[doc.letterValues.length - 1];
              setGrade(doc, p, sub.id, st.id, 'hw', i, row.letter);
            }
            continue;
          }
          if (sub.type === 'lessons') {
            const n = partial ? 8 : 14;
            for (let i = 0; i < n; i++) setGrade(doc, p, sub.id, st.id, 'hw', i, g(trend, 10));
          } else {
            const lastWeek = partial ? 6 : doc.periodConfig.weeks;
            const nd = doc.periodConfig.days.length;
            for (let w = 0; w < lastWeek; w++) {
              for (let d = 0; d < nd; d++) {
                if (rnd() < 0.35) continue;
                setGrade(doc, p, sub.id, st.id, 'hw', w * nd + d, g(trend + w * 0.3, 12));
              }
            }
          }
          const nTests = partial ? 2 : 4;
          for (let t = 0; t < nTests; t++) setGrade(doc, p, sub.id, st.id, 'test', t, g(trend - 3, 14));
          const nQuiz = sub.type === 'lessons' ? (partial ? 3 : 6) : (partial ? 4 : 7);
          for (let q = 0; q < nQuiz; q++) setGrade(doc, p, sub.id, st.id, 'quiz', q, g(trend, 13));
        }
      });
    });
    for (let p = 0; p < 3; p++) {
      doc.subjects.filter((x) => x.type === 'daily').forEach((sub) => {
        for (let i = 0; i < 4; i++) setLabel(doc, p, sub.id, 'test', i, `Ch. ${p * 4 + i + 1}`);
      });
    }
    doc.weights.forEach((w) => { const math = doc.subjects[0].id; w[math] = { hw: 25, test: 50, quiz: 25 }; });
    doc.comments[0][doc.students[0].id] = 'Abigail is a diligent worker and a joy to have in class.';
    doc.settings.currentPeriod = 2;
    return normalize(doc);
  }

  return {
    FORMAT, VERSION, CATS, CAT_LABELS, CAT_SHORT, TYPES, TYPE_LABELS, TYPE_DEFAULTS,
    DEFAULT_SCALE, DEFAULT_WEIGHTS, DEFAULT_SUBJECTS, DEFAULT_PERIOD_NAMES, DEFAULT_LETTER_VALUES,
    catLabel, catShort, catsFor, isLetter, subjectById, normLetter, letterValueMap,
    uid, clone, createDoc, normalize, slotCount, sizesFor, resizeAll, gradesLostByResize, updateSubjectLayout, changeDays, eachEntry,
    getEntry, ensureEntry, getGrade, setGrade, getLabel, setLabel,
    addStudent, removeStudent, addSubject, removeSubject, addPeriod, removeLastPeriod,
    periodHasGrades, studentHasGrades, subjectHasGrades, slotDate, newYearFrom, nextSchoolYear, currentSchoolYear,
    parseGradeInput, round, sampleDoc, CARD_ROWS, defaultCopyRows, copyRows,
  };
});
