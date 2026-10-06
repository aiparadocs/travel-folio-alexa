// Run with the Playwright browser tool's browser_run_code_unsafe filename option.
// Uses isolated browser contexts; no pre-existing journals are read or changed.
async (page) => {
  const base = new URL('/phone/', page.url()).href;
  const browser = page.context().browser();
  const results = [];
  const check = (condition, description) => {
    if (!condition) throw new Error(description);
    results.push(description);
  };
  const newPhone = async (init) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    if (init) await context.addInitScript(init);
    const p = await context.newPage();
    p.on('dialog', d => d.accept());
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(base);
    await p.locator('#application').waitFor({ state: 'visible' });
    return { context, p, errors };
  };
  const editTitle = async (p, title) => {
    await p.getByRole('button', { name: 'Edit cover', exact: true }).click();
    await p.locator('#trip-title').fill(title);
    await p.getByRole('button', { name: 'Save cover', exact: true }).click();
    await p.locator('#meta-dialog').waitFor({ state: 'hidden' });
  };
  {
    const { context, p, errors } = await newPhone();
    try {
      await editTitle(p, 'Our Kyoto memories');
      await p.reload();
      await p.locator('#application').waitFor({ state: 'visible' });
      check(await p.locator('#cover-title').innerText() === 'Our Kyoto memories', 'IndexedDB persists a journal across reload');
      for (const width of [1440, 768, 390, 320]) {
        await p.setViewportSize({ width, height: 900 });
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Phone journal fits ${width}px`);
      }
      await p.setViewportSize({ width: 390, height: 844 });
      await p.getByRole('button', { name: 'Memories', exact: true }).first().click();
      check(await p.locator('body').getAttribute('data-mode') === 'memory', 'Memories view opens on a narrow screen');
      check(errors.length === 0, 'No uncaught phone page errors');
    } finally { await context.close(); }
  }
  {
    const { context, p } = await newPhone(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__failWrites) throw new DOMException('Injected full storage', 'QuotaExceededError');
        return put.apply(this, args);
      };
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__lastExport = blob; return create.call(this, blob); };
    });
    try {
      await p.evaluate(() => { window.__failWrites = true; });
      await editTitle(p, 'An unsaved Kyoto story');
      check(await p.locator('#cover-title').innerText() === 'An unsaved Kyoto story', 'Failed save retains current edits on screen');
      check((await p.locator('#storage-warning').innerText()).includes('not saved'), 'Failed save has an actionable warning');
      await p.getByRole('button', { name: 'Download unsaved copy', exact: true }).click();
      const exported = await p.evaluate(async () => {
        const html = await window.__lastExport.text();
        return JSON.parse(html.match(/<script id="book-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      });
      check(exported.title === 'An unsaved Kyoto story', 'Rescue HTML includes latest edits, not stale saved data');
      await p.reload();
      await p.locator('#application').waitFor({ state: 'visible' });
      check((await p.locator('#storage-warning').innerText()).includes('Unsaved changes found'), 'Backup is offered after reloading a failed save');
      await p.getByRole('button', { name: 'Restore them', exact: true }).click();
      await p.waitForFunction(() => document.getElementById('cover-title').textContent === 'An unsaved Kyoto story');
      check(await p.locator('#cover-title').innerText() === 'An unsaved Kyoto story', 'Recovery restores the failed edit');
      await p.reload();
      await p.locator('#application').waitFor({ state: 'visible' });
      check(await p.locator('#cover-title').innerText() === 'An unsaved Kyoto story', 'Recovered edit is saved to real IndexedDB');
    } finally { await context.close(); }
  }
  {
    const { context, p } = await newPhone();
    try {
      await p.evaluate(() => {
        const book = Journey.normalize(JSON.parse(document.getElementById('book-data').textContent));
        book.notes = 'This private note was never saved.';
        localStorage.setItem('journey-light:rescue:' + book.id, JSON.stringify({ at: 1000, book }));
        const later = Journey.copy(book);
        later.notes = 'The newest private note survives.';
        sessionStorage.setItem('journey-light:rescue:' + book.id, JSON.stringify({ at: 2000, book: later }));
      });
      await p.reload();
      await p.locator('#application').waitFor({ state: 'visible' });
      check((await p.locator('#storage-warning').innerText()).includes('Unsaved changes found'), 'Notes-only rescue is not discarded as identical');
      await p.getByRole('button', { name: 'Restore them', exact: true }).click();
      await p.locator('#storage-warning').waitFor({ state: 'hidden' });
      await p.getByRole('button', { name: 'Packing & notes', exact: true }).click();
      check(await p.locator('#trip-notes').inputValue() === 'The newest private note survives.', 'Newest rescue is chosen across localStorage and sessionStorage');
    } finally { await context.close(); }
  }
  {
    const { context, p } = await newPhone(() => {
      IDBObjectStore.prototype.get = function () { throw new Error('Injected read failure'); };
      const put = IDBObjectStore.prototype.put;
      window.__writeCount = 0;
      IDBObjectStore.prototype.put = function (...args) { window.__writeCount++; return put.apply(this, args); };
    });
    try {
      check((await p.locator('#storage-warning').innerText()).includes('Could not read saved data'), 'IndexedDB read failure remains visible');
      await editTitle(p, 'Do not overwrite old journal');
      check(await p.evaluate(() => window.__writeCount) === 0, 'Read failure blocks all writes to the existing journal');
      check((await p.locator('#storage-warning').innerText()).includes('not saved'), 'Edits during read failure can be rescued');
    } finally { await context.close(); }
  }
  {
    const { context, p } = await newPhone();
    try {
      const newer = await context.newPage();
      newer.on('dialog', d => d.accept());
      await newer.goto(base);
      await newer.locator('#application').waitFor({ state: 'visible' });
      await editTitle(newer, 'A newer trip from the home planner');
      await editTitle(p, 'An older tab trying to save');
      check((await p.locator('#storage-warning').innerText()).includes('changed in another tab'), 'A stale tab cannot overwrite a newer journal');
      await newer.reload();
      await newer.locator('#application').waitFor({ state: 'visible' });
      check(await newer.locator('#cover-title').innerText() === 'A newer trip from the home planner', 'Latest persisted journal survives a conflicting tab save');
    } finally { await context.close(); }
  }
  return { passed: results.length, checks: results };
}
