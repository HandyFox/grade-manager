// Printing helper: puts pages into #print-area, then prints or saves a PDF.
import { clear, toast } from './ui.js';

export async function outputPages(app, pages, { landscape = false, pdf = false, name = 'Grade Manager' } = {}) {
  const area = clear(document.getElementById('print-area'));
  pages.forEach((p) => area.appendChild(p));
  let style = document.getElementById('page-style');
  if (!style) { style = document.createElement('style'); style.id = 'page-style'; document.head.appendChild(style); }
  style.textContent = `@page { size: letter ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
  await Promise.all([...area.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    if (pdf) {
      const file = await app.api.savePdf(name, landscape);
      if (file) toast('PDF saved', 'ok');
    } else {
      await app.api.printPage();
    }
  } catch (e) {
    toast(`Printing failed: ${e.message}`, 'error');
  } finally {
    clear(area);
  }
}
