const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/shared/model.js');
const C = require('../src/shared/calc.js');

function smallDoc() {
  const doc = M.createDoc({ students: ['Ann', 'Ben', 'Cal'], subjects: ['Math', 'English'], periodCount: 6 });
  return doc;
}

test('letter grades follow the spreadsheet scale', () => {
  const s = M.DEFAULT_SCALE;
  assert.equal(C.letterFor(s, 0), 'F');
  assert.equal(C.letterFor(s, 62.49), 'F');
  assert.equal(C.letterFor(s, 62.5), 'E');
  assert.equal(C.letterFor(s, 79.5), 'C');
  assert.equal(C.letterFor(s, 91.49), 'B');
  assert.equal(C.letterFor(s, 99.5), 'A+');
  assert.equal(C.letterFor(s, 120), 'A+');
  assert.equal(C.letterFor(s, null), '');
});

test('RC grade re-weights over the categories a student has', () => {
  const doc = smallDoc();
  const [math] = doc.subjects; const [ann, ben] = doc.students;
  // Ann: homework avg 90, tests avg 70, no quizzes -> (90*33+70*33)/66 = 80
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 0, 100);
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 3, 80);
  M.setGrade(doc, 0, math.id, ann.id, 'test', 0, 70);
  // Ben: all three categories, custom weights 25/50/25
  doc.weights[0][math.id] = { hw: 25, test: 50, quiz: 25 };
  M.setGrade(doc, 0, math.id, ben.id, 'hw', 0, 100);
  M.setGrade(doc, 0, math.id, ben.id, 'test', 0, 80);
  M.setGrade(doc, 0, math.id, ben.id, 'quiz', 0, 60);
  const R = C.computeAll(doc);
  // Ann was computed with weights after the change too (25/50/25): (90*25 + 70*50)/75
  assert.ok(Math.abs(R.rc[0][math.id][ann.id] - (90 * 25 + 70 * 50) / 75) < 1e-9);
  assert.ok(Math.abs(R.rc[0][math.id][ben.id] - (100 * 25 + 80 * 50 + 60 * 25) / 100) < 1e-9);
});

test('equal weights with one category = that category average', () => {
  const doc = smallDoc();
  const [math] = doc.subjects; const [ann] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'quiz', 2, 88);
  const R = C.computeAll(doc);
  assert.equal(R.rc[0][math.id][ann.id], 88);
});

test('zeros count as grades; blanks do not', () => {
  const doc = smallDoc();
  const [math] = doc.subjects; const [ann] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 0, 0);
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 1, 100);
  const R = C.computeAll(doc);
  assert.equal(R.cat[0][math.id][ann.id].hw, 50);
});

test('all-subjects, final, final-all and all-grades averages', () => {
  const doc = smallDoc();
  const [math, eng] = doc.subjects; const [ann, ben, cal] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 0, 90);
  M.setGrade(doc, 0, eng.id, ann.id, 'hw', 0, 80);
  M.setGrade(doc, 1, math.id, ann.id, 'hw', 0, 70);
  const R = C.computeAll(doc);
  assert.equal(R.periodAll[0][ann.id], 85);
  assert.equal(R.periodAll[1][ann.id], 70);
  assert.equal(R.final[math.id][ann.id], 80);
  assert.equal(R.final[eng.id][ann.id], 80);
  assert.equal(R.finalAll[ann.id], 80);
  assert.equal(R.allGrades[ann.id], 77.5);
  assert.equal(R.periodAll[0][ben.id], null);
  // class averages skip inactive students
  M.setGrade(doc, 0, math.id, ben.id, 'hw', 0, 50);
  M.setGrade(doc, 0, math.id, cal.id, 'hw', 0, 10);
  cal.inactive = true;
  const R2 = C.computeAll(doc);
  assert.equal(R2.classRc[0][math.id], 70);
});

test('subjects excluded from the average are left out of All Subjects', () => {
  const doc = smallDoc();
  const [math, eng] = doc.subjects; const [ann] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 0, 90);
  M.setGrade(doc, 0, eng.id, ann.id, 'hw', 0, 50);
  eng.countInAverage = false;
  const R = C.computeAll(doc);
  assert.equal(R.periodAll[0][ann.id], 90);
});

test('grade input parsing', () => {
  assert.deepEqual(M.parseGradeInput('92'), { ok: true, value: 92 });
  assert.deepEqual(M.parseGradeInput(' 87.5 '), { ok: true, value: 87.5 });
  assert.deepEqual(M.parseGradeInput('17/20'), { ok: true, value: 85 });
  assert.deepEqual(M.parseGradeInput('95%'), { ok: true, value: 95 });
  assert.deepEqual(M.parseGradeInput(''), { ok: true, value: null });
  assert.equal(M.parseGradeInput('abc').ok, false);
  assert.equal(M.parseGradeInput('-5').ok, false);
  assert.equal(M.parseGradeInput('5/0').ok, false);
});

test('resizing keeps grades and reports losses', () => {
  const doc = smallDoc();
  const [math] = doc.subjects; const [ann] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 49, 90);
  M.setGrade(doc, 0, math.id, ann.id, 'test', 11, 80);
  assert.equal(M.gradesLostByResize(doc, { periodConfig: { weeks: 9 } }), 1);
  assert.equal(M.gradesLostByResize(doc, { periodConfig: { weeks: 12 } }), 0);
  assert.equal(M.gradesLostByResize(doc, { subjectId: math.id, subject: { tests: 11 } }), 1);
  doc.periodConfig.weeks = 12;
  M.resizeAll(doc);
  assert.equal(M.getEntry(doc, 0, math.id, ann.id).hw.length, 60);
  assert.equal(M.getGrade(doc, 0, math.id, ann.id, 'hw', 49), 90);
});

test('changing days per week keeps grades on the same week/day', () => {
  const doc = smallDoc();
  const [math] = doc.subjects; const [ann] = doc.students;
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 7, 77); // week 2, Wednesday
  M.changeDays(doc, ['M', 'T', 'W', 'T']);
  assert.equal(M.getGrade(doc, 0, math.id, ann.id, 'hw', 4 + 2), 77);
});

test('new school year keeps setup and clears grades', () => {
  const doc = M.sampleDoc();
  const n = M.newYearFrom(doc, { keepStudents: true });
  assert.equal(n.info.schoolYear, M.nextSchoolYear(doc.info.schoolYear));
  assert.equal(n.students.length, doc.students.length);
  assert.equal(n.subjects.length, doc.subjects.length);
  assert.equal(Object.keys(n.grades[0]).length, 0);
  assert.deepEqual(n.weights[0][n.subjects[0].id], doc.weights[0][doc.subjects[0].id]);
});

test('weekly and running averages', () => {
  assert.deepEqual(C.weeklyAverages([100, null, 80, null, null, 50, 70, null, null, null], 5), [90, 60]);
  assert.deepEqual(C.runningAverage([100, null, 80]), [100, null, 90]);
  assert.ok(C.trendSlope([70, 75, 80]) > 4.9);
});

test('format rounds half up and trims zeros', () => {
  assert.equal(C.format(92, 1), '92');
  assert.equal(C.format(92.25, 1), '92.3');
  assert.equal(C.format(79.45, 1), '79.5');
  assert.equal(C.format(null, 1), '');
});

test('sample gradebook computes without errors', () => {
  const doc = M.sampleDoc();
  const R = C.computeAll(doc);
  const st = doc.students[0];
  assert.ok(R.periodAll[0][st.id] > 0);
  assert.ok(R.allGrades[st.id] > 0);
  // JSON round trip
  const again = M.normalize(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(C.computeAll(again).allGrades, R.allGrades);
});

test('letter-graded subjects convert letters and average them', () => {
  const doc = M.createDoc({ students: ['Ann'], subjects: [['Penmanship', 'letter'], ['Math', 'daily']] });
  const [pen, math] = doc.subjects; const [ann] = doc.students;
  assert.equal(M.slotCount(doc, pen, 'hw'), 15);
  assert.equal(M.slotCount(doc, pen, 'test'), 0);
  const lv = doc.letterValues;
  assert.deepEqual(M.parseGradeInput('b+', lv), { ok: true, value: 'B+' });
  assert.deepEqual(M.parseGradeInput('1', lv), { ok: true, value: 'A+' });
  assert.deepEqual(M.parseGradeInput('12', lv), { ok: true, value: 'F' });
  assert.equal(M.parseGradeInput('13', lv).ok, false);
  assert.equal(M.parseGradeInput('Q', lv).ok, false);
  M.setGrade(doc, 0, pen.id, ann.id, 'hw', 0, 'A+');
  M.setGrade(doc, 0, pen.id, ann.id, 'hw', 1, 'B');
  M.setGrade(doc, 0, math.id, ann.id, 'hw', 0, 80);
  const R = C.computeAll(doc);
  assert.equal(R.rc[0][pen.id][ann.id], (100 + 91) / 2);
  assert.equal(R.periodAll[0][ann.id], ((100 + 91) / 2 + 80) / 2);
  // editing the letter chart changes the grade, like the spreadsheet's red numbers
  doc.letterValues[3].value = 90; // 'B+' row
  doc.letterValues[4].value = 89; // 'B'
  assert.equal(C.computeAll(doc).rc[0][pen.id][ann.id], (100 + 89) / 2);
  // JSON round trip keeps letters
  const again = M.normalize(JSON.parse(JSON.stringify(doc)));
  assert.equal(M.getGrade(again, 0, pen.id, ann.id, 'hw', 1), 'B');
});

test('lessons subjects use their own slot counts', () => {
  const doc = M.createDoc({ students: ['Ann'], subjects: [['Spelling', 'lessons']] });
  const [sp] = doc.subjects;
  assert.deepEqual(M.sizesFor(doc, sp), { hw: 15, test: 9, quiz: 9 });
  M.setGrade(doc, 0, sp.id, doc.students[0].id, 'quiz', 8, 90);
  M.updateSubjectLayout(doc, sp.id, { quizzes: 12 });
  assert.equal(M.getGrade(doc, 0, sp.id, doc.students[0].id, 'quiz', 8), 90);
  assert.equal(M.getEntry(doc, 0, sp.id, doc.students[0].id).quiz.length, 12);
  // switching to letter grades clears numeric grades
  assert.equal(M.gradesLostByResize(doc, { subjectId: sp.id, subject: { type: 'letter' } }), 1);
  M.updateSubjectLayout(doc, sp.id, { type: 'letter' });
  assert.equal(M.getEntry(doc, 0, sp.id, doc.students[0].id), null);
});

test('default subjects mirror the spreadsheet', () => {
  const doc = M.createDoc();
  const types = Object.fromEntries(doc.subjects.map((s) => [s.name, s.type]));
  assert.equal(types.Math, 'daily');
  assert.equal(types.Spelling, 'lessons');
  assert.equal(types.Penmanship, 'letter');
  const math = doc.subjects[0];
  assert.deepEqual(M.sizesFor(doc, math), { hw: 50, test: 12, quiz: 15 });
});

test('copy sheet rows follow the paper report card', () => {
  const doc = M.createDoc(); // spreadsheet subjects: Math, English, Reading, History, Science, ...
  const rows = M.defaultCopyRows(doc);
  const name = (r) => (r.subjectId ? M.subjectById(doc, r.subjectId).name : null);
  assert.deepEqual(rows.map((r) => r.label), ['Bible', 'Bible Memory', 'Reading', 'English', 'Arithmetic', 'Spelling', 'Social Studies', 'Science/Health', 'Penmanship', 'Music', 'Art', 'Typing']);
  assert.deepEqual(rows.map(name), ['Bible', 'Bible Memory', 'Reading', 'English', 'Math', 'Spelling', 'History', 'Science', 'Penmanship', 'Music', 'Art', null]);
  // extra subjects go at the end; deleted subjects become blank rows
  const extra = M.addSubject(doc, 'Phonics');
  assert.equal(M.defaultCopyRows(doc).pop().subjectId, extra.id);
  doc.settings.copyRows = [{ label: 'Arithmetic', subjectId: doc.subjects[0].id }, { label: 'Gone', subjectId: 'nope' }];
  assert.deepEqual(M.copyRows(doc).map((r) => r.subjectId), [doc.subjects[0].id, null]);
});

test('copy sheet cells read like the handwritten card', () => {
  const s = M.DEFAULT_SCALE;
  assert.equal(C.copyText(s, 92.3), 'B+ 92');
  assert.equal(C.copyText(s, 99.6), 'A+ 100');
  assert.equal(C.copyText(s, 86.4), 'B- 86');
  assert.equal(C.copyText(s, 91.5), 'B+ 92');
  assert.equal(C.copyText(s, 98.7, true), 'A');
  assert.equal(C.copyText(s, null), '');
});
