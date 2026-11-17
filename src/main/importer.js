// Imports an existing Excel "Grade Manager" workbook (.xltm / .xlsm / .xlsx).
//
// Each "First Period" … "Sixth Period" sheet is a stack of subject blocks, 34 rows apart,
// starting at row 2. Every block has its title in column A and 30 student rows starting
// 4 rows below the title. There are three kinds of block:
//
//   daily    (Math, English …)   F:BC  10 weeks × M–F homework,  BE:BP 12 tests, BQ:CE 15 quizzes
//                                C/D/E on title+2 = weights
//   lessons  (Spelling, Music, Bible)  F:T 15 lessons, U:AC 9 tests, AD:AL 9 quizzes, weights as above
//   letter   (Penmanship, Art)   U:AI 15 code numbers (1 = A+, 2 = A, …); AJ/AK/AL hold the
//                                letter / code / percentage chart
//
// The "Averages" sheet holds the letter-grade scale in A3:B14, and the Instructions sheet the
// number of students (E25).
const XLSX = require('xlsx');
const M = require('../shared/model');

const col = (c) => XLSX.utils.decode_col(c);
const LAYOUTS = {
  daily: { hw: [col('F'), col('BC')], test: [col('BE'), col('BP')], quiz: [col('BQ'), col('CE')] },
  lessons: { hw: [col('F'), col('T')], test: [col('U'), col('AC')], quiz: [col('AD'), col('AL')] },
  letter: { hw: [col('U'), col('AI')] },
};
const BLOCK_STRIDE = 34;
const FIRST_TOP = 1; // row 2
const STUDENT_OFFSET = 4;

function cell(ws, r, c) {
  const x = ws[XLSX.utils.encode_cell({ r, c })];
  return x ? x.v : undefined;
}
function text(ws, r, c) {
  const v = cell(ws, r, c);
  return v === undefined || v === null ? '' : String(v).trim();
}
function num(ws, r, c) {
  const v = cell(ws, r, c);
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return null;
}

function blockTops(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const tops = [];
  for (let r = FIRST_TOP; r + STUDENT_OFFSET <= range.e.r; r += BLOCK_STRIDE) {
    if (!text(ws, r, 0)) break;
    tops.push(r);
  }
  return tops;
}

function blockType(ws, top) {
  if (/do not enter/i.test(text(ws, top, col('M'))) || text(ws, top + STUDENT_OFFSET, col('AJ')) === 'A+') return 'letter';
  if (/lessons/i.test(text(ws, top, col('J')))) return 'lessons';
  return 'daily';
}

/** The letter chart of a letter-graded block: [{code, letter, value}] */
function letterChart(ws, top) {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const r = top + STUDENT_OFFSET + i;
    const letter = text(ws, r, col('AJ'));
    const code = num(ws, r, col('AK'));
    const value = num(ws, r, col('AL'));
    if (!letter || code === null || value === null) break;
    rows.push({ code, letter: M.normLetter(letter), value });
  }
  return rows;
}

function importWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
  const periodNames = wb.SheetNames.filter((n) => /period/i.test(n) && blockTops(wb.Sheets[n]).length);
  if (!periodNames.length) {
    throw new Error('This doesn’t look like a Grade Manager spreadsheet — no “First Period”, “Second Period” … sheets were found.');
  }
  const first = wb.Sheets[periodNames[0]];
  const tops = blockTops(first);
  const blocks = tops.map((top) => ({ top, name: text(first, top, 0), type: blockType(first, top) }));
  const studentRows = BLOCK_STRIDE - STUDENT_OFFSET;

  // Number of students set on the Instructions sheet (Instructions!E25).
  let declaredCount = null;
  if (wb.Sheets.Instructions) {
    const n = num(wb.Sheets.Instructions, 24, 4);
    if (n && n > 0 && n <= studentRows) declaredCount = Math.round(n);
  }

  // Letter chart from the first letter-graded block.
  const letterBlock = blocks.find((b) => b.type === 'letter');
  const chart = letterBlock ? letterChart(first, letterBlock.top) : [];

  // raw[p][blockIndex] = { weights, rows: [{hw, test, quiz}] }
  const raw = periodNames.map((name) => {
    const ws = wb.Sheets[name];
    return blocks.map((b) => {
      const lay = LAYOUTS[b.type];
      const localChart = b.type === 'letter' ? letterChart(ws, b.top) : null;
      const codeToLetter = (code) => {
        const src = localChart && localChart.length ? localChart : chart;
        const hit = src.find((r) => r.code === code);
        if (hit) return hit.letter;
        const d = M.DEFAULT_LETTER_VALUES[code - 1];
        return d ? d.letter : null;
      };
      const rows = [];
      for (let i = 0; i < studentRows; i++) {
        const r = b.top + STUDENT_OFFSET + i;
        const read = (range) => {
          const out = [];
          if (!range) return out;
          for (let c = range[0]; c <= range[1]; c++) {
            const v = num(ws, r, c);
            out.push(b.type === 'letter' ? (v === null ? null : codeToLetter(Math.round(v))) : v);
          }
          return out;
        };
        rows.push({ hw: read(lay.hw), test: read(lay.test), quiz: read(lay.quiz) });
      }
      const weights = b.type === 'letter' ? null : { hw: num(ws, b.top + 2, 2), test: num(ws, b.top + 2, 3), quiz: num(ws, b.top + 2, 4) };
      return { rows, weights };
    });
  });

  const hasAny = (e) => [e.hw, e.test, e.quiz].some((a) => a.some((v) => v !== null));
  const studentHas = (i) => raw.some((pb) => pb.some((b) => hasAny(b.rows[i])));
  const blockHas = (bi) => raw.some((pb) => pb[bi].rows.some(hasAny));

  // Students: names in the first block of the first period sheet.
  const students = [];
  for (let i = 0; i < studentRows; i++) {
    const name = text(first, tops[0] + STUDENT_OFFSET + i, 0);
    const placeholder = !name || /^student\s*\d+$/i.test(name);
    const wanted = declaredCount === null ? !placeholder : i < declaredCount;
    if (wanted || studentHas(i)) students.push({ i, name: name || `Student ${i + 1}` });
  }

  // Subjects: skip unused "Blank" placeholders.
  const subjects = [];
  blocks.forEach((b, bi) => {
    const unused = !b.name || /^blank$/i.test(b.name);
    if (!unused || blockHas(bi)) subjects.push({ bi, name: b.name || `Subject ${bi + 1}`, type: b.type });
  });

  const doc = M.createDoc({ subjects: [], students: [], periodCount: periodNames.length });
  doc.periods.forEach((p, i) => { p.name = periodNames[i]; });
  if (chart.length >= 2) doc.letterValues = chart.map((r) => ({ letter: r.letter, value: r.value }));
  const stuIds = students.map((s) => M.addStudent(doc, s.name).id);
  const subIds = subjects.map((s) => M.addSubject(doc, s.name, s.type).id);
  M.normalize(doc);

  let gradeCount = 0;
  raw.forEach((pb, p) => {
    subjects.forEach((sj, k) => {
      const b = pb[sj.bi];
      if (b.weights) {
        const w = {};
        for (const c of M.CATS) {
          const v = b.weights[c];
          w[c] = v === null ? 0 : (v <= 1.5 ? Math.round(v * 1000) / 10 : v);
        }
        if (w.hw + w.test + w.quiz > 0) doc.weights[p][subIds[k]] = w;
      }
      const subj = doc.subjects[k];
      students.forEach((st, j) => {
        const e = b.rows[st.i];
        for (const c of M.CATS) {
          const n = M.slotCount(doc, subj, c);
          e[c].forEach((v, idx) => {
            if (v !== null && idx < n) {
              M.setGrade(doc, p, subIds[k], stuIds[j], c, idx, v);
              gradeCount++;
            }
          });
        }
      });
    });
  });

  // Letter-grade scale from the Averages sheet.
  const av = wb.Sheets.Averages;
  if (av) {
    const scale = [];
    for (let r = 2; r < 30; r++) {
      const min = num(av, r, 0);
      const letter = text(av, r, 1);
      if (min === null || !letter || letter === '.') break;
      scale.push({ min, letter });
    }
    if (scale.length >= 2) doc.scale = scale;
  }
  M.normalize(doc);
  return {
    doc,
    summary: { students: stuIds.length, subjects: subIds.length, periods: periodNames.length, grades: gradeCount },
  };
}

module.exports = { importWorkbook, LAYOUTS };
