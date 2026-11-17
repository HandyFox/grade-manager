const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const M = require('../src/shared/model.js');
const C = require('../src/shared/calc.js');
const { importWorkbook } = require('../src/main/importer.js');
const { buildWorkbook } = require('../src/main/exporter.js');

// Build a small workbook with the same layout as the original Excel Grade Manager.
function fakeGradeManager() {
  const wb = XLSX.utils.book_new();
  const blocks = [['Math', 'daily'], ['Spelling', 'lessons'], ['Penmanship', 'letter'], ['Blank', 'daily']];
  const letters = M.DEFAULT_LETTER_VALUES;
  const names = ['Period One', 'Second Period'];
  const instr = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(instr, [[3]], { origin: 'E25' });
  XLSX.utils.book_append_sheet(wb, instr, 'Instructions');
  names.forEach((sheetName, p) => {
    const ws = XLSX.utils.aoa_to_sheet([[]]);
    const put = (addr, v) => XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: addr });
    blocks.forEach(([name, type], k) => {
      const top = 2 + 34 * k;
      put(`A${top}`, name);
      if (type === 'lessons') put(`J${top}`, 'Lessons');
      if (type === 'letter') {
        put(`M${top}`, 'Do not enter anything here.');
        letters.forEach((l, i) => { put(`AJ${top + 4 + i}`, l.letter); put(`AK${top + 4 + i}`, i + 1); put(`AL${top + 4 + i}`, l.value - (i === 1 ? 1 : 0)); });
      } else {
        put(`B${top + 1}`, 'RC Grade');
        put(`C${top + 2}`, 0.33); put(`D${top + 2}`, 0.33); put(`E${top + 2}`, 0.33);
      }
      for (let i = 0; i < 30; i++) put(`A${top + 4 + i}`, i < 3 ? ['Ann', 'Ben', 'Cy'][i] : `Student ${i + 1}`);
    });
    // Math: Ann homework 90, 80 (W1 M, T) and test 70; quizzes empty
    if (p === 0) { put('F6', 90); put('G6', 80); put('BE6', 70); put('C4', 0.25); put('D4', 0.5); put('E4', 0.25); }
    // Spelling (top 36): Ben lesson 95, test 85, quiz 75
    if (p === 1) { put('F41', 95); put('U41', 85); put('AD41', 75); }
    // Penmanship (top 70): Ann codes 1 and 2 -> A+, A
    if (p === 0) { put('U74', 1); put('V74', 2); }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const av = XLSX.utils.aoa_to_sheet([[]]);
  M.DEFAULT_SCALE.forEach((s, i) => XLSX.utils.sheet_add_aoa(av, [[s.min, s.letter]], { origin: `A${3 + i}` }));
  XLSX.utils.book_append_sheet(wb, av, 'Averages');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('imports an original Grade Manager workbook', () => {
  const { doc, summary } = importWorkbook(fakeGradeManager());
  assert.deepEqual(doc.students.map((s) => s.name), ['Ann', 'Ben', 'Cy']);
  assert.deepEqual(doc.subjects.map((s) => [s.name, s.type]), [['Math', 'daily'], ['Spelling', 'lessons'], ['Penmanship', 'letter']]);
  assert.equal(doc.periods.length, 2);
  assert.equal(summary.grades, 8);
  const R = C.computeAll(doc);
  const [math, spell, pen] = doc.subjects; const [ann, ben] = doc.students;
  assert.deepEqual(doc.weights[0][math.id], { hw: 25, test: 50, quiz: 25 });
  assert.deepEqual(doc.weights[1][math.id], { hw: 33, test: 33, quiz: 33 });
  assert.equal(R.rc[0][math.id][ann.id], (85 * 25 + 70 * 50) / 75);
  assert.equal(R.rc[1][spell.id][ben.id], 85);
  assert.deepEqual(M.getEntry(doc, 0, pen.id, ann.id).hw.slice(0, 2), ['A+', 'A']);
  assert.equal(doc.letterValues[1].value, 98); // custom chart value carried over
  assert.equal(R.rc[0][pen.id][ann.id], 99);
  assert.equal(doc.scale.length, 12);
});

test('rejects workbooks that are not a Grade Manager', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hello']]), 'Sheet1');
  assert.throws(() => importWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /Grade Manager/);
});

test('exports every sheet', () => {
  const doc = M.sampleDoc();
  const wb = buildWorkbook(doc);
  assert.deepEqual(wb.SheetNames.slice(0, 3), ['Report Card Grades', 'Averages', 'First Period']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Report Card Grades'], { header: 1 });
  assert.equal(rows.length, 1 + doc.students.length * (doc.subjects.length + 2));
  const R = C.computeAll(doc);
  assert.equal(rows[1][2], Math.round(R.rc[0][doc.subjects[0].id][doc.students[0].id] * 10) / 10);
  XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
});
