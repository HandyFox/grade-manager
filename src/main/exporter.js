// Exports a gradebook to an Excel workbook: report-card grades plus every raw grade.
const XLSX = require('xlsx');
const M = require('../shared/model');
const C = require('../shared/calc');

const r1 = (v) => (v === null || v === undefined ? '' : Math.round(v * 10) / 10);

function buildWorkbook(doc) {
  M.normalize(doc);
  const R = C.computeAll(doc);
  const wb = XLSX.utils.book_new();
  const letter = (v) => C.letterFor(doc.scale, v);

  // 1. Report card grades: one row per student per subject.
  const head = ['Student', 'Subject'];
  doc.periods.forEach((p) => head.push(`${p.name} %`, `${p.name} Letter`));
  head.push('Final %', 'Final Letter');
  const rows = [head];
  for (const st of doc.students) {
    for (const subj of doc.subjects) {
      const row = [st.name, subj.name];
      doc.periods.forEach((_, p) => { const v = R.rc[p][subj.id][st.id]; row.push(r1(v), letter(v)); });
      const f = R.final[subj.id][st.id];
      row.push(r1(f), letter(f));
      rows.push(row);
    }
    const all = [st.name, 'All Subjects'];
    doc.periods.forEach((_, p) => { const v = R.periodAll[p][st.id]; all.push(r1(v), letter(v)); });
    all.push(r1(R.finalAll[st.id]), letter(R.finalAll[st.id]));
    rows.push(all);
    rows.push([st.name, 'All Grades', ...doc.periods.flatMap(() => ['', '']), r1(R.allGrades[st.id]), letter(R.allGrades[st.id])]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, ...head.slice(2).map(() => ({ wch: 9 }))];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: head.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'Report Card Grades');

  // 2. Class summary per period: students × subjects.
  const sum = [];
  doc.periods.forEach((per, p) => {
    sum.push([per.name]);
    sum.push(['Student', ...doc.subjects.map((s) => s.name), 'All Subjects']);
    for (const st of doc.students) sum.push([st.name, ...doc.subjects.map((s) => r1(R.rc[p][s.id][st.id])), r1(R.periodAll[p][st.id])]);
    sum.push(['Class Average', ...doc.subjects.map((s) => r1(R.classRc[p][s.id])), r1(R.classPeriodAll[p])]);
    sum.push([]);
  });
  sum.push(['Final']);
  sum.push(['Student', ...doc.subjects.map((s) => s.name), 'All Subjects', 'All Grades']);
  for (const st of doc.students) sum.push([st.name, ...doc.subjects.map((s) => r1(R.final[s.id][st.id])), r1(R.finalAll[st.id]), r1(R.allGrades[st.id])]);
  const ws2 = XLSX.utils.aoa_to_sheet(sum);
  ws2['!cols'] = [{ wch: 22 }, ...doc.subjects.map(() => ({ wch: 11 })), { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Averages');

  // 3. One sheet per marking period with every grade, laid out like the original spreadsheet.
  doc.periods.forEach((per, p) => {
    const aoa = [];
    for (const subj of doc.subjects) {
      const cats = M.catsFor(subj);
      const sizes = M.sizesFor(doc, subj);
      const w = C.weightsFor(doc, p, subj.id);
      aoa.push([subj.name, subj.type === 'letter' ? 'Letter grades' : `Weights: ${M.catLabel(subj, 'hw')} ${w.hw}%, Tests ${w.test}%, Quizzes ${w.quiz}%`]);
      const h = ['Student', 'RC Grade', 'Letter', ...cats.map((c) => M.catShort(subj, c))];
      for (const c of cats) {
        for (let i = 0; i < sizes[c]; i++) {
          if (c === 'hw' && subj.type === 'daily') {
            const nd = doc.periodConfig.days.length;
            h.push(`W${Math.floor(i / nd) + 1} ${doc.periodConfig.days[i % nd]}`);
          } else {
            const lbl = M.getLabel(doc, p, subj.id, c, i);
            const base = c === 'hw' ? (subj.type === 'lessons' ? 'Lesson' : 'Grade') : c === 'test' ? 'Test' : 'Quiz';
            h.push(lbl ? `${base} ${i + 1}: ${lbl}` : `${base} ${i + 1}`);
          }
        }
      }
      aoa.push(h);
      for (const st of doc.students) {
        const e = M.getEntry(doc, p, subj.id, st.id);
        const avg = R.cat[p][subj.id][st.id];
        const rc = R.rc[p][subj.id][st.id];
        const row = [st.name, r1(rc), letter(rc), ...cats.map((c) => r1(avg[c]))];
        for (const c of cats) for (let i = 0; i < sizes[c]; i++) { const v = e ? e[c][i] : null; row.push(v === null ? '' : v); }
        aoa.push(row);
      }
      aoa.push([]);
    }
    const sh = XLSX.utils.aoa_to_sheet(aoa);
    sh['!cols'] = [{ wch: 22 }, { wch: 9 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
    XLSX.utils.book_append_sheet(wb, sh, per.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
  });

  // 4. Setup: scale and students.
  const setup = [['School year', doc.info.schoolYear], ['School', doc.info.school], ['Teacher', doc.info.teacher], [],
    ['Grading scale'], ['Minimum %', 'Letter'], ...doc.scale.map((s) => [s.min, s.letter]), [],
    ['Letter chart (letter-graded subjects)'], ['Letter', '%'], ...doc.letterValues.map((s) => [s.letter, s.value])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setup), 'Setup');
  return wb;
}

function exportWorkbook(doc, file) {
  XLSX.writeFile(buildWorkbook(doc), file, { compression: true });
}

module.exports = { exportWorkbook, buildWorkbook };
