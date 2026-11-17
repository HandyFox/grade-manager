// Welcome screen shown when no gradebook is open.
import { h, icon } from '../ui.js';

export function mount(app, root) {
  const cmds = app.commands;
  const action = (ic, title, text, fn) => h('button', { class: 'big-action', onclick: fn }, icon(ic), h('div', null, h('b', null, title), h('span', null, text)));
  const recent = (app.recent || []);
  root.appendChild(h('div', { class: 'welcome' }, h('div', { class: 'welcome-inner' },
    h('h1', null, 'Grade Manager'),
    h('p', { class: 'lead' }, 'Weekly grade books, report-card averages, graphs and printable report cards — saved on your computer, no internet needed.'),
    h('div', { class: 'welcome-actions' },
      action('new', 'New gradebook', 'Start a school year with your students and subjects.', () => cmds.newGradebook()),
      action('open', 'Open gradebook', 'Open a .gradebook file you saved before.', () => cmds.openGradebook()),
      action('import', 'Import from the spreadsheet', 'Bring in students, subjects, weights and every grade from your Grade Manager Excel file.', () => cmds.importSpreadsheet()),
      action('spark', 'Try a sample', 'Explore with a made-up class that already has grades.', () => cmds.openSample())),
    recent.length ? h('div', { class: 'recent' }, h('h4', null, 'Recent'),
      recent.map((p) => h('div', { class: 'recent-item', onclick: () => cmds.openGradebook(p), title: p },
        icon('reports'), h('div', null, h('div', null, p.split(/[\\/]/).pop().replace(/\.gradebook$/i, '')), h('div', { class: 'p' }, p))))) : null)));
  return {};
}
