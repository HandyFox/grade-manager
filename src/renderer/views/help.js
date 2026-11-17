// Help: how the app works and keyboard shortcuts.
import { h } from '../ui.js';

export function mount(app, root) {
  const mac = app.platform === 'darwin';
  const k = (s) => h('kbd', null, mac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥') : s);
  const row = (keys, text) => h('tr', null, h('td', null, ...keys.flatMap((x, i) => (i ? [' ', k(x)] : [k(x)]))), h('td', null, text));
  root.appendChild(h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'How to use Grade Manager')));
  root.appendChild(h('div', { class: 'view-scroll' }, h('div', { class: 'help' },
    h('h2', null, 'Getting started'),
    h('p', null, 'One gradebook holds one class for one school year. It is saved automatically every time you make a change, to the file you chose when you created it. You can open it again from File › Open Recent.'),
    h('ol', null,
      h('li', null, h('b', null, 'Setup'), ': type or paste your students, check the subjects, and set the date week 1 starts for each marking period. Changes to student or subject names appear everywhere.'),
      h('li', null, h('b', null, 'Grades'), ': pick a marking period and a subject, then type grades into the weekly grid. The RC Grade, letter, and Homework / Tests / Quizzes averages update as you type.'),
      h('li', null, h('b', null, 'Averages'), ': every student’s RC Grades for each period, plus Final and All Grades — the same as the old Averages sheet.'),
      h('li', null, h('b', null, 'Graphs'), ': compare marking periods day by day, follow trends, compare students with the class.'),
      h('li', null, h('b', null, 'Report Cards'), ': print or save PDF report cards and progress reports, with comments.')),
    h('p', null, 'Already using the Excel Grade Manager? Use File › Import from Grade Manager Spreadsheet. Students, subjects, weights, the letter scale and all grades come across.'),

    h('h2', null, 'Entering grades quickly'),
    h('table', null, h('tbody', null,
      row(['0–9', 'Enter'], 'Type a grade and press Enter to move down to the next student. Reach the bottom and it wraps to the top of the next column.'),
      row(['Tab'], 'Save the grade and move right.'),
      row(['17/20'], 'Points are converted to a percentage (85).'),
      row(['Ctrl+Enter'], 'Put what you typed into every selected cell.'),
      row(['Ctrl+V'], 'Paste grades copied from Excel or Google Sheets — a single grade fills the whole selection.'),
      row(['Ctrl+Shift+F'], 'Fill… — e.g. give everyone without a grade 100.'),
      row(['Ctrl+D'], 'Fill down: copy the top grade of the selection down.'),
      row(['Delete'], 'Clear the selected grades.'),
      row(['Ctrl+Z', mac ? 'Ctrl+Shift+Z' : 'Ctrl+Y'], 'Undo / redo.'),
      row(['Shift+Arrows'], 'Select a range. Click a column header to select the whole column, or a name to select the row.'),
      row(['F2'], 'Edit the grade in the cell instead of replacing it.'),
      row(['Ctrl+F'], 'Find a student.'),
      row(['Ctrl+PageDown', 'Ctrl+PageUp'], 'Next / previous subject.'),
      row(['Ctrl+1 … 5'], 'Switch between Grades, Averages, Graphs, Report Cards and Setup.'))),
    h('p', null, 'Double-click a test, quiz or lesson column header to give it a name (like “Ch. 3”). Right-click a header for more.'),

    h('h2', null, 'How grades are calculated'),
    h('p', null, 'These match the Excel Grade Manager:'),
    h('ul', null,
      h('li', null, h('b', null, 'Homework, Tests, Quizzes'), ' — the average of the grades entered (blank cells don’t count; a 0 does).'),
      h('li', null, h('b', null, 'RC Grade'), ' — the weighted average of those three. If a student has no grades yet in one kind, the others share its weight. Weights can be different for each subject in each marking period.'),
      h('li', null, h('b', null, 'Letter-graded subjects'), ' (Penmanship, Art) — each letter is changed to a percentage with the letter chart in Setup (A+ = 100, A = 99, A- = 95 …) and averaged. Type a letter, or the code numbers the spreadsheet used (1 = A+, 2 = A …).'),
      h('li', null, h('b', null, 'All Subjects'), ' — the average of the RC Grades for a marking period.'),
      h('li', null, h('b', null, 'Final'), ' — the average of a subject’s RC Grades over the marking periods. ', h('b', null, 'All Grades'), ' — the average of the marking periods’ All Subjects averages.'),
      h('li', null, 'Letters come from the grading scale in Setup. Students marked “withdrawn” keep their grades but are left out of class averages.')),

    h('h2', null, 'Your data'),
    h('p', null, 'Gradebooks are ordinary files (.gradebook) — keep them in a folder you back up, or in OneDrive / Dropbox / Google Drive. Grade Manager also keeps its own backup copy every 10 minutes while you work: File › Backups. File › Export to Excel makes a spreadsheet of everything. File › Start a New School Year copies your setup into a fresh gradebook.'),
    h('p', { class: 'muted' }, `Grade Manager ${app.version || ''} · Based on the Excel Grade Manager by Keith R. Martin, with modifications by Ryan Stauffer.`))));
  return {};
}
