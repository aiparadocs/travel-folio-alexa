// Run using the Playwright browser tool's browser_run_code_unsafe filename option.
// Isolated contexts and synthetic route fixtures never read or change user journals.
async (page) => {
  const base = new URL('/phone/', page.url()).href;
  const browser = page.context().browser();
  const checks = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const stop = (id, day, extra = {}) => ({ id, day, time: '10:00', title: 'Print stop ' + id, kind: 'other', planNote: 'Plan note ' + id, locked: false, done: false, caption: '', photo: null, stickers: [], ...extra });
  const seed = stops => ({ format: 'journey-light', version: 1, id: 'qa-print-book', title: 'Our printed Kyoto story', place: 'Kyoto', start: '2026-10-10', days: 2, sample: false, notes: '', packing: [], stops });
  const setup = async (makeBook) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.addInitScript(() => {
      window.__writes = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { window.__writes++; return put.apply(this, args); };
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__exportBlob = blob; return create.call(this, blob); };
      window.__printCalls = 0;
      window.print = () => {
        window.dispatchEvent(new Event('beforeprint'));
        const root = document.getElementById('print-output');
        window.__printed = { html: root.innerHTML, text: root.textContent, pages: root.querySelectorAll('.folio-print-page').length, images: [...root.querySelectorAll('img')].map(img => ({ src: img.src, complete: img.complete, width: img.naturalWidth })) };
        window.__printCalls++;
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    const p = await context.newPage();
    p.on('dialog', d => d.accept());
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const photo = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#426448'; g.fillRect(0, 0, 80, 60); return c.toDataURL('image/jpeg', 0.7); });
    const book = makeBook(photo);
    await p.route(base, async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/(<script id="book-data" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(book).replace(/</g, '\\u003c') + b);
      await route.fulfill({ response, body: html });
    });
    await p.goto(base);
    await p.locator('#application').waitFor({ state: 'visible' });
    return { context, p, book, photo, errors };
  };
  const ready = p => p.waitForFunction(() => { const b = document.getElementById('print-confirm'); return b && !b.disabled; });
  const openPrint = async p => { await p.locator('[data-action="print"]').first().click(); await p.locator('#print-dialog').waitFor({ state: 'visible' }); await ready(p); };
  const select = async (p, id, value) => { await p.locator(id).selectOption(value); await ready(p); };
  const previewText = p => p.locator('#print-preview').textContent();
  const fits = async p => p.locator('#print-preview').evaluate(root => [...root.querySelectorAll('.folio-print-column')].every(col => col.scrollHeight <= col.clientHeight + 2 && col.scrollWidth <= col.clientWidth + 2));
  {
    const { context, p, book, photo, errors } = await setup(photo => seed([
      stop('arrival', 1, { caption: '京都の朝 — a quiet welcome & a new memory.', photo, stickers: ['fox'] }),
      stop('lunch', 1, { caption: 'A handwritten thought without a photo.' }),
      stop('train', 2, { title: 'Day two special train', stickers: ['train'] }),
      stop('garden', 2, { title: 'Day two garden without a memory' })
    ]));
    try {
      const liveBefore = await p.locator('#book-content').innerHTML();
      const writesBefore = await p.evaluate(() => window.__writes);
      await openPrint(p);
      await select(p, '#print-mode', 'both');
      await select(p, '#print-day', 'all');
      let text = await previewText(p);
      check(book.stops.every(s => text.includes(s.title) && text.includes(s.planNote)), 'Combined preview contains every itinerary title and full stop note');
      check(book.stops.filter(s => s.caption).every(s => text.includes(s.caption)), 'Combined preview preserves Unicode, punctuation and caption-only memories');
      check(await p.locator('#print-preview img').evaluateAll((imgs, uri) => imgs.some(img => img.src === uri), photo), 'Combined preview includes the saved photo');
      check(await p.locator('#print-preview .folio-print-page').count() === 1, 'A compact two-day itinerary and memories fit one A4 sheet');
      check(await fits(p), 'Compact combined preview fits its measured columns');
      await select(p, '#print-mode', 'plan');
      text = await previewText(p);
      check(text.includes(book.stops[0].planNote) && !text.includes(book.stops[0].caption), 'Schedule-only option excludes memory captions');
      await select(p, '#print-mode', 'memory');
      text = await previewText(p);
      check(text.includes(book.stops[0].caption) && text.includes(book.stops[1].caption) && text.includes(book.stops[2].title) && !text.includes(book.stops[3].title), 'Memories option includes photo, caption-only and sticker-only stops');
      await select(p, '#print-day', '2');
      text = await previewText(p);
      check(text.includes(book.stops[2].title) && !text.includes(book.stops[0].title), 'Selected-day memories exclude the other day');
      await select(p, '#print-mode', 'both');
      await select(p, '#print-day', 'all');
      await p.locator('[data-action="print-confirm"]').click();
      await p.waitForFunction(() => window.__printCalls === 1);
      const printed = await p.evaluate(() => window.__printed);
      check(printed.pages === 1 && printed.text.includes(book.stops[0].caption) && printed.text.includes(book.stops[3].title), 'Print confirmation produces the selected combined sheet');
      check(printed.images.every(img => img.complete && img.width > 0), 'Print images have decoded before opening the native dialog');
      check(await p.locator('#book-content').innerHTML() === liveBefore, 'Printing and cancellation leave the live itinerary DOM unchanged');
      check(await p.evaluate(() => window.__writes) === writesBefore, 'Preview and printing never write journal storage');
      await p.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); });
      check(await p.locator('#print-output .folio-print-page').count() > 0, 'Native browser print also builds the booklet');
      await p.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
      check(await p.locator('#book-content').innerHTML() === liveBefore, 'Native print cancellation also leaves the live view untouched');
      if (await p.locator('#print-dialog').isVisible()) await p.locator('#print-dialog [data-action="close"]').first().click();
      await p.locator('[data-action="transfer"]').first().click();
      // Export buttons may live in the advanced section of the transfer sheet.
      const exportButton = p.locator('[data-action="export-html"]');
      await exportButton.evaluate(button => { for (let parent = button.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; });
      await exportButton.click();
      const exported = await p.evaluate(async () => window.__exportBlob.text());
      check(exported.includes('folio-print-page') && exported.includes('id="print-dialog"') && exported.includes('beforeprint'), 'Portable HTML preserves booklet styles, controls and native-print support');
      const standalone = await context.newPage();
      const exportURL = new URL('/qa-print-export.html', base).href;
      await standalone.route(exportURL, route => route.fulfill({ contentType: 'text/html', body: exported }));
      await standalone.goto(exportURL);
      await standalone.locator('#application').waitFor({ state: 'visible' });
      await openPrint(standalone);
      await select(standalone, '#print-mode', 'both');
      check((await previewText(standalone)).includes(book.stops[0].caption), 'Exported standalone journal rebuilds a combined print preview');
      check(errors.length === 0, 'No uncaught errors during print modes, cancellation or export');
    } finally { await context.close(); }
  }
  {
    const { context, p, book, errors } = await setup(photo => seed(Array.from({ length: 22 }, (_, i) => stop('long-' + i, 1 + i % 2, {
      title: 'Long stop ' + i + ' — keep every detail',
      planNote: 'Plan detail ' + i + ': ' + ('long unbroken address with spaces '.repeat(9)).slice(0, 270),
      caption: 'Full memory ' + i + ': ' + ('今日の大切な思い出をそのまま残す。'.repeat(40)).slice(0, 540),
      photo: i % 3 === 0 ? photo : null,
      stickers: ['fox', 'train']
    }))));
    try {
      await openPrint(p);
      await select(p, '#print-mode', 'both');
      const pages = await p.locator('#print-preview .folio-print-page').count();
      const text = await previewText(p);
      check(pages > 1, 'A large journal adds sheets instead of shrinking or clipping away content');
      check((await p.locator('#print-count').innerText()).includes(String(pages)), 'Preview reports the actual number of sheets');
      // Text may be divided between continuation fragments; remove layout whitespace only.
      const compact = text.replace(/\s/g, '');
      check(book.stops.every(s => compact.includes(s.planNote.replace(/\s/g, '')) && compact.includes(s.caption.replace(/\s/g, ''))), 'Multi-sheet output retains every full note and long Unicode caption');
      check(await fits(p), 'All long-content columns fit their A4 printable bounds');
      check(errors.length === 0, 'Long-journal pagination has no uncaught browser errors');
    } finally { await context.close(); }
  }
  {
    const { context, p, book, errors } = await setup(photo => seed([
      stop('many-lines', 1, { planNote: Array.from({ length: 60 }, (_, i) => 'N' + i).join('\n'), caption: Array.from({ length: 100 }, (_, i) => 'M' + i).join('\n'), photo })
    ]));
    try {
      await openPrint(p);
      await select(p, '#print-mode', 'both');
      const notes = (await p.locator('#print-preview [data-stop-id="many-lines"] .folio-stop-note').allTextContents()).join('');
      const captions = (await p.locator('#print-preview [data-stop-id="many-lines"] .folio-memory-caption').allTextContents()).join('');
      check(notes === book.stops[0].planNote && captions === book.stops[0].caption, 'Multiline continuation fragments preserve the exact complete note and caption');
      check(await p.locator('#print-preview img.folio-memory-photo').count() === 1, 'A continued memory prints its photo once');
      check(await fits(p), 'Multiline continuation pages remain within their printable columns');
      check(errors.length === 0, 'Multiline pagination has no uncaught errors');
    } finally { await context.close(); }
  }
  return { passed: checks.length, checks };
}
