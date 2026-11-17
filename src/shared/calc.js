/*
 * Grade Manager — grade calculations.
 *
 * These follow the formulas in the original Excel Grade Manager:
 *
 *   Category average (Homewk / Tests / Quizzes)
 *       = average of the grades entered in that category (blank cells are ignored).
 *
 *   RC Grade (report-card grade for one subject in one marking period)
 *       = weighted average of the category averages the student actually has,
 *         re-weighted over just those categories. E.g. with weights 33/33/33 and
 *         no quizzes yet, homework and tests each count 50%.
 *
 *   All Subjects (one marking period)  = average of that period's RC grades.
 *   Final (one subject)                = average of that subject's RC grades across the marking periods.
 *   Final — All Subjects               = average of the subject Finals.
 *   All Grades                         = average of the marking-period "All Subjects" averages.
 *
 *   Letter grade = the highest scale row whose minimum is <= the percentage.
 *
 *   Letter-graded subjects (Penmanship, Art): each letter is converted with the
 *   letter chart (A+ = 100, A = 99, A- = 95 …) and the RC Grade is the plain average.
 *
 * One small, deliberate difference: in the spreadsheet a category whose average
 * is exactly 0 (e.g. a single missed homework scored 0) was silently dropped from
 * the RC grade. Here a 0 counts like any other grade.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATS = ['hw', 'test', 'quiz'];

  function mean(values) {
    let s = 0, n = 0;
    for (const v of values) {
      if (typeof v === 'number' && isFinite(v)) { s += v; n++; }
    }
    return n ? s / n : null;
  }

  function count(values) {
    let n = 0;
    for (const v of values) if (typeof v === 'number' && isFinite(v)) n++;
    return n;
  }

  function weightedRc(avgs, weights) {
    let num = 0, den = 0;
    for (const c of CATS) {
      const a = avgs[c];
      const w = Number(weights && weights[c]) || 0;
      if (a !== null && a !== undefined && w > 0) { num += a * w; den += w; }
    }
    return den > 0 ? num / den : null;
  }

  function letterFor(scale, value) {
    if (value === null || value === undefined || !isFinite(value)) return '';
    let letter = '';
    for (const row of scale) { // scale is sorted ascending by min
      if (value >= row.min) letter = row.letter;
      else break;
    }
    return letter;
  }

  function weightsFor(doc, p, subjId) {
    return (doc.weights[p] && doc.weights[p][subjId]) || doc.defaultWeights;
  }

  function letterMapOf(doc) {
    const m = {};
    (doc.letterValues || []).forEach((r) => { m[String(r.letter).trim().toUpperCase().replace(/\s+/g, '')] = Number(r.value); });
    return m;
  }

  /** Convert a stored grade to a number: letter grades go through the letter chart. */
  function toNumber(v, letterMap) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && letterMap) {
      const n = letterMap[v.trim().toUpperCase()];
      return n === undefined ? null : n;
    }
    return null;
  }

  function numbers(arr, letterMap) {
    return (arr || []).map((v) => toNumber(v, letterMap));
  }

  function entryAverages(entry, subj, letterMap) {
    if (!entry) return { hw: null, test: null, quiz: null };
    if (subj && subj.type === 'letter') return { hw: mean(numbers(entry.hw, letterMap)), test: null, quiz: null };
    return { hw: mean(entry.hw), test: mean(entry.test), quiz: mean(entry.quiz) };
  }

  /** RC grade for one subject from its category averages. Letter-graded subjects are a plain average. */
  function rcFrom(avgs, subj, weights) {
    if (subj && subj.type === 'letter') return avgs.hw;
    return weightedRc(avgs, weights);
  }

  /**
   * Compute every average in the gradebook in one pass.
   * Students marked inactive (withdrawn) still get their own grades but are left out of class averages.
   */
  function computeAll(doc) {
    const P = doc.periods.length;
    const R = {
      cat: [], rc: [], periodAll: [], final: {}, finalAll: {}, allGrades: {},
      classCat: [], classRc: [], classPeriodAll: [], classFinal: {}, classFinalAll: null, classAllGrades: null,
    };
    const active = doc.students.filter((s) => !s.inactive);
    const letterMap = letterMapOf(doc);
    const counted = doc.subjects.filter((s) => s.countInAverage !== false);

    for (let p = 0; p < P; p++) {
      R.cat[p] = {}; R.rc[p] = {}; R.periodAll[p] = {}; R.classCat[p] = {}; R.classRc[p] = {};
      const bySubj = doc.grades[p] || {};
      for (const subj of doc.subjects) {
        const byStu = bySubj[subj.id] || {};
        const w = weightsFor(doc, p, subj.id);
        R.cat[p][subj.id] = {}; R.rc[p][subj.id] = {};
        for (const st of doc.students) {
          const a = entryAverages(byStu[st.id], subj, letterMap);
          R.cat[p][subj.id][st.id] = a;
          R.rc[p][subj.id][st.id] = rcFrom(a, subj, w);
        }
        R.classRc[p][subj.id] = mean(active.map((st) => R.rc[p][subj.id][st.id]));
        R.classCat[p][subj.id] = {
          hw: mean(active.map((st) => R.cat[p][subj.id][st.id].hw)),
          test: mean(active.map((st) => R.cat[p][subj.id][st.id].test)),
          quiz: mean(active.map((st) => R.cat[p][subj.id][st.id].quiz)),
        };
      }
      for (const st of doc.students) {
        R.periodAll[p][st.id] = mean(counted.map((subj) => R.rc[p][subj.id][st.id]));
      }
      R.classPeriodAll[p] = mean(active.map((st) => R.periodAll[p][st.id]));
    }

    for (const subj of doc.subjects) {
      R.final[subj.id] = {};
      for (const st of doc.students) {
        const vals = [];
        for (let p = 0; p < P; p++) vals.push(R.rc[p][subj.id][st.id]);
        R.final[subj.id][st.id] = mean(vals);
      }
      R.classFinal[subj.id] = mean(active.map((st) => R.final[subj.id][st.id]));
    }
    for (const st of doc.students) {
      R.finalAll[st.id] = mean(counted.map((subj) => R.final[subj.id][st.id]));
      const pv = [];
      for (let p = 0; p < P; p++) pv.push(R.periodAll[p][st.id]);
      R.allGrades[st.id] = mean(pv);
    }
    R.classFinalAll = mean(active.map((st) => R.finalAll[st.id]));
    R.classAllGrades = mean(active.map((st) => R.allGrades[st.id]));
    return R;
  }

  /** Average of each week's entries in a daily homework array. */
  function weeklyAverages(arr, daysPerWeek) {
    const out = [];
    for (let i = 0; i < arr.length; i += daysPerWeek) out.push(mean(arr.slice(i, i + daysPerWeek)));
    return out;
  }

  /** Running (cumulative) average — what the category average was after each entry. */
  function runningAverage(arr) {
    let s = 0, n = 0;
    return arr.map((v) => {
      if (typeof v === 'number' && isFinite(v)) { s += v; n++; return s / n; }
      return n ? null : null;
    });
  }

  /** Average across students for each slot (class average per day / test / quiz). */
  function columnAverages(arrays, length) {
    const out = [];
    for (let i = 0; i < length; i++) out.push(mean(arrays.map((a) => (a ? a[i] : null))));
    return out;
  }

  /** Least-squares slope of the non-null values, per step. Positive = improving. */
  function trendSlope(values) {
    const pts = [];
    values.forEach((v, i) => { if (typeof v === 'number' && isFinite(v)) pts.push([i, v]); });
    if (pts.length < 2) return null;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, den = 0;
    for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); }
    return den ? num / den : null;
  }

  function format(value, decimals) {
    if (value === null || value === undefined || !isFinite(value)) return '';
    const d = decimals === undefined ? 1 : decimals;
    // Round half up (like Excel), then drop trailing zeros: 92.0 -> "92", 92.50 -> "92.5".
    const f = Math.pow(10, d);
    return String(Math.round((Number(value) + Number.EPSILON) * f) / f);
  }

  return { CATS, mean, count, weightedRc, rcFrom, letterFor, weightsFor, letterMapOf, toNumber, numbers, entryAverages, computeAll, weeklyAverages, runningAverage, columnAverages, trendSlope, format };
});
