// Small DOM helpers, dialogs, toasts and icons.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function toast(msg, type, ms) {
  const t = h('div', { class: `toast ${type || ''}` }, msg);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms || (type === 'error' ? 5000 : 2600));
}

/** Show a modal. buttons: [{label, value, primary, danger}]. Resolves with the clicked value (or null on Esc). */
export function modal({ title, body, buttons, wide, onOpen }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const btns = (buttons || [{ label: 'OK', value: true, primary: true }]).map((b) =>
      h('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger solid' : ''}`, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label));
    const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog' },
      h('div', { class: 'modal-head' }, title || ''),
      h('div', { class: 'modal-body' }, typeof body === 'string' ? h('p', null, body) : body),
      h('div', { class: 'modal-foot' }, btns));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(null); } }, box);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
        const primary = (buttons || []).find((b) => b.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); close(typeof primary.value === 'function' ? primary.value() : primary.value); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    const first = box.querySelector('input, select, textarea');
    if (first) { first.focus(); if (first.select) first.select(); } else { const p = box.querySelector('.btn.primary, .btn.danger'); if (p) p.focus(); }
    if (onOpen) onOpen(box);
  });
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return modal({
    title,
    body: typeof message === 'string' ? h('p', null, message) : message,
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}

export function promptDialog(title, label, value, { okLabel = 'OK', placeholder = '' } = {}) {
  const input = h('input', { type: 'text', value: value || '', placeholder, style: { width: '100%' } });
  return modal({
    title,
    body: h('label', { class: 'field' }, h('span', null, label), input),
    buttons: [{ label: 'Cancel', value: null }, { label: okLabel, value: () => input.value, primary: true }],
  });
}

export function popupMenu(anchor, items) {
  document.querySelectorAll('.menu-pop').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu-pop' }, items.map((it) => (it === '-' ? h('hr') : h('button', { onclick: () => { menu.remove(); it.action(); } }, it.label))));
  menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    document.addEventListener('mousedown', off, true);
  });
}

export function letterClass(letter) {
  const c = String(letter || '').trim().charAt(0).toUpperCase();
  if (c === 'A') return 'lg-a';
  if (c === 'B') return 'lg-b';
  if (c === 'C') return 'lg-c';
  if (c === 'D') return 'lg-d';
  if (c === 'E' || c === 'F') return 'lg-f';
  return 'lg-x';
}

export function letterPill(letter) {
  if (!letter) return '';
  return h('span', { class: `lg ${letterClass(letter)}` }, letter);
}

const ICONS = {
  grades: '<path d="M4 4h16v16H4z" fill="none"/><path d="M4 9h16M4 14h16M9 4v16M14 4v16" fill="none"/>',
  averages: '<path d="M5 19V9m5 10V5m5 14v-7m5 7V8" fill="none"/>',
  graphs: '<path d="M3 17l5-6 4 3 7-9" fill="none"/><path d="M3 21h18" fill="none"/>',
  reports: '<path d="M6 3h9l4 4v14H6z" fill="none"/><path d="M9 12h7M9 16h7M9 8h3" fill="none"/>',
  setup: '<circle cx="12" cy="12" r="3" fill="none"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1M4.9 19.1l2.1-2.1m10-10l2.1-2.1" fill="none"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4" fill="none"/><circle cx="12" cy="17" r=".6"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z" fill="none"/>',
  pdf: '<path d="M6 3h9l4 4v14H6z" fill="none"/><path d="M9 15h6M12 10v8" fill="none"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none"/><path d="M3 16l5-5 4 4 3-3 6 6" fill="none"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z" fill="none"/>',
  new: '<path d="M6 3h9l4 4v14H6z" fill="none"/><path d="M12 10v7M8.5 13.5h7" fill="none"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5" fill="none"/><path d="M4 17v4h16v-4" fill="none"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" fill="none"/>',
  fill: '<path d="M4 20h16M7 16l8-8 3 3-8 8H7z" fill="none"/>',
  today: '<rect x="4" y="5" width="16" height="15" rx="2" fill="none"/><path d="M4 10h16M9 3v4M15 3v4" fill="none"/>',
  search: '<circle cx="11" cy="11" r="6" fill="none"/><path d="M20 20l-4.5-4.5" fill="none"/>',
  undo: '<path d="M9 14L4 9l5-5" fill="none"/><path d="M4 9h11a5 5 0 010 10h-3" fill="none"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  excel: '<rect x="4" y="3" width="16" height="18" rx="2" fill="none"/><path d="M8 8l8 8M16 8l-8 8" fill="none"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none"/><path d="M16 8V4H4v12h4" fill="none"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'inline-grid';
  span.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="currentColor">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => t !== null;
  return d;
}

export function shortDate(d) {
  if (!d) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${m} ${d.getUTCDate()}`;
}

export function todayUTC() {
  const t = new Date();
  return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
