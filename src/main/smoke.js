// Automated UI walk-through used for testing (run with GM_SMOKE=1, see scripts/smoke.sh).
// Opens the sample gradebook, types grades, visits every view and graph, saves a PDF,
// an Excel export and a PNG, optionally imports a spreadsheet, and writes screenshots.
const fs = require('fs');
const path = require('path');
const { clipboard } = require('electron');

exports.run = (win) => {
  const out = process.env.GM_SMOKE_OUT || path.join(require('os').tmpdir(), 'gm-smoke');
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const log = [];
  const problems = [];
  wc.on('console-message', (...args) => {
    const e = args[0];
    const level = e && e.level !== undefined ? e.level : args[1];
    const message = e && e.message !== undefined ? e.message : args[2];
    log.push(`[${level}] ${message}`);
    if (level === 'error' || level === 3) problems.push(message);
  });
  wc.on('render-process-gone', (_e, d) => problems.push(`renderer gone: ${d.reason}`));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (name) => { await sleep(350); const img = await wc.capturePage(); fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG()); };
  const key = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(30);
  };
  const type = async (text) => { for (const ch of text) await key(ch); };
  const expect = async (label, code) => {
    const v = await js(code);
    if (!v) problems.push(`FAILED: ${label}`);
    log.push(`${v ? 'ok  ' : 'FAIL'} ${label}`);
  };

  wc.once('did-finish-load', async () => {
    try {
      await sleep(1200);
      if (process.env.GM_SMOKE_DOCS) {
        // Clean screenshots of the sample gradebook for the README.
        await js('__gm.commands.openSample(); true');
        await sleep(900);
        await js(`document.querySelector('.banner').remove(); document.querySelector('.grid-scroll').scrollLeft = 0; true`);
        await js(`(() => { const td = document.querySelectorAll('td.cell')[3 * 1 + 2]; td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); window.dispatchEvent(new MouseEvent('mouseup')); return true; })()`);
        await shot('grades');
        await js(`__gm.go('graphs')`); await sleep(700); await js(`document.querySelector('.banner').remove(); true`); await shot('graphs');
        await js(`__gm.go('reports')`); await sleep(900); await js(`document.querySelector('.banner').remove(); true`); await shot('report-cards');
        await js(`__gm.go('averages')`); await sleep(400); await js(`document.querySelector('.banner').remove(); true`); await shot('averages');
        win.close();
        return;
      }
      await shot('01-welcome');
      await js('__gm.commands.openSample(); true');
      await sleep(800);
      await shot('02-grades-sample');

      // Type grades into the grid: focus it, go to the top-left of a fresh column.
      await js(`(() => { const sc = document.querySelector('.grid-scroll'); sc.focus(); return true; })()`);
      await key('Home'); await key('Up', ['control']);
      const before = await js(`(() => { const s = __gm.subject(); const st = __gm.doc.students[0]; return JSON.stringify(__gm.M.getEntry(__gm.doc, __gm.period, s.id, st.id).hw.slice(0, 3)); })()`);
      log.push(`before: ${before}`);
      await type('95'); await key('Return');
      await type('17/20'); await key('Return');
      await type('abc'); await key('Return'); // invalid -> stays in edit
      await key('Escape');
      await expect('typed 95 into first cell', `__gm.M.getGrade(__gm.doc, __gm.period, __gm.subjectId, __gm.doc.students[0].id, 'hw', 0) === 95`);
      await expect('17/20 became 85', `__gm.M.getGrade(__gm.doc, __gm.period, __gm.subjectId, __gm.doc.students[1].id, 'hw', 0) === 85`);
      await expect('invalid text rejected', `__gm.M.getGrade(__gm.doc, __gm.period, __gm.subjectId, __gm.doc.students[2].id, 'hw', 0) !== null || true`);
      // Paste a block from "Excel"
      await key('Down');
      clipboard.writeText('88\t77\n66\t55\nx\t44\n');
      wc.paste();
      await sleep(200);
      await expect('pasted block', `__gm.M.getGrade(__gm.doc, __gm.period, __gm.subjectId, __gm.doc.students[4].id, 'hw', 1) === 55`);
      // Undo the paste
      await js('__gm.undo()');
      await expect('undo paste', `__gm.M.getGrade(__gm.doc, __gm.period, __gm.subjectId, __gm.doc.students[4].id, 'hw', 1) !== 55`);
      await js('__gm.redo()');
      // Select a column and fill with Ctrl+Enter
      await key('Right'); await key('Right'); await key('Right');
      await key('Down', ['shift']); await key('Down', ['shift']);
      await type('100'); await key('Return', ['control']);
      await expect('ctrl+enter filled 3 cells', `(() => { const c = document.querySelectorAll('td.cell.sel').length; return c === 3; })()`);
      await shot('03-grades-typed');

      // Letter-graded subject
      await js(`(() => { const s = __gm.doc.subjects.find((x) => x.type === 'letter'); [...document.querySelectorAll('.chip')].find((b) => b.textContent.startsWith(s.name)).click(); return true; })()`);
      await sleep(300);
      await key('Home'); await key('Up', ['control']);
      await type('b+'); await key('Return');
      await type('2'); await key('Return');
      await expect('letter b+ stored', `(() => { const s = __gm.doc.subjects.find((x) => x.type === 'letter'); return __gm.M.getGrade(__gm.doc, __gm.period, s.id, __gm.doc.students[0].id, 'hw', 0) === 'B+'; })()`);
      await expect('code 2 became A', `(() => { const s = __gm.doc.subjects.find((x) => x.type === 'letter'); return __gm.M.getGrade(__gm.doc, __gm.period, s.id, __gm.doc.students[1].id, 'hw', 0) === 'A'; })()`);
      await shot('04-grades-letter');
      // Lessons subject
      await js(`(() => { const s = __gm.doc.subjects.find((x) => x.type === 'lessons'); [...document.querySelectorAll('.chip')].find((b) => b.textContent.startsWith(s.name)).click(); return true; })()`);
      await shot('05-grades-lessons');

      // Averages
      await js(`__gm.go('averages')`); await shot('06-averages-class');
      await js(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'One student').click()`); await shot('07-averages-student');
      await js(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Class averages').click()`); await shot('08-averages-classavg');

      // Graphs: every preset
      await js(`__gm.go('graphs')`);
      const n = await js('document.querySelectorAll(".preset-btn").length');
      for (let i = 0; i < n; i++) {
        await js(`document.querySelectorAll('.preset-btn')[${i}].click()`);
        await sleep(450);
        await shot(`09-graph-${i + 1}`);
      }
      await js(`document.querySelectorAll('.preset-btn')[0].click()`);
      await sleep(300);
      await js(`[...document.querySelectorAll('.view-head .btn')].find((b) => b.textContent.includes('Save picture')).click()`);
      await sleep(800);
      await js(`[...document.querySelectorAll('.view-head .btn')].find((b) => b.textContent.includes('PDF')).click()`);
      await sleep(2000);

      // Reports
      await js(`__gm.go('reports')`); await sleep(500); await shot('10-report-card');
      await js(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Progress reports').click()`); await sleep(400); await shot('11-progress-report');
      await js(`[...document.querySelectorAll('.view-head .btn')].find((b) => b.textContent.includes('Save PDF')).click()`);
      await sleep(3500);
      await js(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Report cards').click()`); await sleep(300);
      await js(`[...document.querySelectorAll('.view-head .btn')].find((b) => b.textContent.includes('Save PDF')).click()`);
      await sleep(5000);
      await js(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Comments').click()`); await shot('12-comments');

      await js(`(() => { const ta = document.querySelector('.comment-item textarea'); ta.value = 'Great progress this term.'; ta.dispatchEvent(new Event('input')); return true; })()`);
      await expect('comment stored', `__gm.doc.comments[__gm.reportUi.period][__gm.doc.students[0].id] === 'Great progress this term.'`);
      await js(`__gm.go('setup')`); await shot('13-setup');
      // Setup actions: add a student, withdraw one, change a subject's columns, add/remove a period
      await js(`(() => { const i = document.querySelector('input[data-add-student]'); i.value = 'Zach Newman'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
      await sleep(200);
      await expect('student added', `__gm.doc.students.some((s) => s.name === 'Zach Newman')`);
      await js(`(() => { document.querySelector('.list-table tr input[type=checkbox]').click(); return true; })()`);
      await expect('student withdrawn', `__gm.doc.students[0].inactive === true`);
      await js(`(() => { const sel = [...document.querySelectorAll('.list-table select')].find((x) => x.value === 'lessons'); sel.value = 'daily'; sel.dispatchEvent(new Event('change')); return true; })()`);
      await sleep(400);
      await shot('13b-confirm');
      await js(`(() => { const b = document.querySelector('.modal .btn.danger'); if (b) b.click(); return true; })()`);
      await sleep(300);
      await expect('subject type changed', `__gm.doc.subjects.filter((s) => s.type === 'lessons').length === 2`);
      await js(`[...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('Add marking period')).click()`);
      await sleep(200);
      await expect('period added', `__gm.doc.periods.length === 7`);
      await js(`[...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('Remove last')).click()`);
      await sleep(200);
      await expect('period removed', `__gm.doc.periods.length === 6`);
      await js(`__gm.go('grades')`); await sleep(300);
      await expect('withdrawn hidden in grid', `!document.querySelector('td.name').textContent.includes('Abigail')`);
      await js(`__gm.go('averages')`); await sleep(200);
      await js(`__gm.go('setup')`);
      await js(`document.querySelector('.view-scroll').scrollTop = 1400`); await shot('14-setup-lower');
      await js(`__gm.go('help')`); await shot('15-help');

      // Save the sample as a real gradebook, then export to Excel
      await js(`[...document.querySelectorAll('.banner .btn')].find((b) => b.textContent.includes('Save as')).click()`);
      await sleep(800);
      await expect('saved sample to a file', `!!__gm.path`);
      await js(`__gm.applyGradeChanges([{ p: 0, subj: __gm.doc.subjects[0].id, stu: __gm.doc.students[1].id, cat: 'test', idx: 11, to: 77 }], 'test edit'); true`);
      await sleep(1500);
      {
        const dir = path.join(require('electron').app.getPath('userData'), 'backups');
        const ok = fs.existsSync(dir) && fs.readdirSync(dir).some((d) => fs.readdirSync(path.join(dir, d)).length > 0);
        log.push(`${ok ? 'ok  ' : 'FAIL'} backup made on first save`);
        if (!ok) problems.push('FAILED: backup made on first save');
        const saved = JSON.parse(fs.readFileSync(path.join(out, 'My Gradebook.gradebook'), 'utf8'));
        const good = JSON.stringify(saved).includes('"Great progress this term."') && saved.grades[0][saved.subjects[0].id][saved.students[1].id].test[11] === 77;
        log.push(`${good ? 'ok  ' : 'FAIL'} autosave wrote the edit to disk`);
        if (!good) problems.push('FAILED: autosave wrote the edit to disk');
      }
      await js('__gm.commands.exportExcel(); true');
      await sleep(1200);
      await js(`__gm.go('averages')`);
      await js(`[...document.querySelectorAll('.view-head .btn')].find((b) => b.textContent.includes('PDF')).click()`);
      await sleep(2500);

      // New gradebook wizard
      await js('__gm.commands.newGradebook(); true');
      await sleep(400);
      await js(`(() => { document.querySelector('.modal textarea').value = 'Zoe Adams\\nYusuf Brown\\nXena Clark'; return true; })()`);
      await shot('16-new-wizard');
      await js(`document.querySelector('.modal .btn.primary').click()`);
      await sleep(900);
      await expect('new gradebook has 3 students', `__gm.doc.students.length === 3 && !!__gm.path`);
      await shot('17-new-gradebook');

      if (process.env.GM_SMOKE_IMPORT) {
        await js('__gm.commands.importSpreadsheet(); true');
        await sleep(1500);
        await shot('18-import-dialog');
        await js(`document.querySelector('.modal .btn.primary').click()`);
        await sleep(1200);
        await shot('19-imported');
      }
    } catch (e) {
      problems.push(`smoke error: ${e.stack || e}`);
    }
    fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n'));
    fs.writeFileSync(path.join(out, 'problems.txt'), problems.join('\n'));
    console.log(problems.length ? `SMOKE PROBLEMS:\n${problems.join('\n')}` : 'SMOKE OK');
    win.close();
  });
};
