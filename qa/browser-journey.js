// Playwright browser-tool runnable; uses isolated contexts and the running app's origin.
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await context.newPage();
  const checks = [], errors = [];
  const check = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  p.on('pageerror', error => errors.push(error.message));
  const action = async (selector) => {
    const [response] = await Promise.all([
      p.waitForResponse(r => r.url().includes('/api/action') && r.request().method() === 'POST'),
      p.locator(selector).click(),
    ]);
    const result = await response.json();
    if (!response.ok()) throw new Error(result.error);
    await p.waitForFunction(() => document.querySelector('.folio').getAttribute('aria-busy') === 'false');
    return result;
  };
  try {
    await p.goto(origin);
    await p.waitForFunction(() => !document.getElementById('create-button').disabled);
    check(await p.locator('#voice-toggle').evaluate(e => e.getBoundingClientRect().bottom < innerHeight), 'Conversation entry is visible at 1280×900');
    for (const width of [1440, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Home page fits ${width}px`);
    }
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.locator('#trip-options > summary').click();
    let state = await action('#create-button');
    check(state.trip === null && state.proposal.kind === 'create', 'Trip creation waits for human confirmation');
    state = await action('#confirm-proposal');
    check(state.trip.days.length === 2 && await p.locator('#stop-list .stop').count() > 0, 'Confirmed Kyoto itinerary appears on screen');
    const originalStops = state.trip.days[0].stops;
    state = await action('[data-action="weather"]');
    check(state.weather.source === 'demo' && state.weather.atRisk.length > 0, 'Sample rain is labelled and affects the default trip');
    state = await action('[data-action="rain_swap"]');
    check(state.proposal.diff.length > 0 && JSON.stringify(state.trip.days[0].stops) === JSON.stringify(originalStops), 'Indoor proposal shows changes without modifying the trip');
    check(await p.locator('#proposal-diff del').count() > 0 && await p.locator('#proposal-diff ins').count() > 0, 'Before and after are both visible');
    state = await action('#confirm-proposal');
    check(state.trip.days[0].stops[0].exposure === 'indoor', 'Confirmation applies the indoor alternative');
    state = await action('[data-action="undo"]');
    check(JSON.stringify(state.trip.days[0].stops) === JSON.stringify(originalStops), 'Undo restores the original day');
    state = await action('[data-action="delay"]');
    state = await action('#decline-proposal');
    check(JSON.stringify(state.trip.days[0].stops) === JSON.stringify(originalStops) && state.proposal === null, 'Declining a delay keeps the plan unchanged');
    state = await action('[data-action="coffee"]');
    state = await action('#confirm-proposal');
    check(state.trip.days[0].stops.length === originalStops.length + 1, 'Adding a coffee stop works through the visible buttons');
    await p.locator('#day-navigation button').nth(1).click();
    state = await action('[data-action="weather"]');
    check(state.weather.day === 2, 'Quick actions use the selected day');
    await p.reload();
    await p.waitForFunction(() => !document.getElementById('create-button').disabled);
    check(await p.locator('#itinerary-title').textContent() === '2 days in Kyoto', 'Reload restores the same home session');
    await p.setViewportSize({ width: 390, height: 844 });
    state = await action('[data-action="handoff"]');
    check(await p.locator('#handoff-dialog').isVisible(), 'Handoff opens in a mobile-sized viewport');
    check((await p.locator('#handoff-intro').innerText()).includes(state.handoff.reachableFromPhone ? 'Scan with your phone' : 'computer only'), 'Handoff explains actual phone reachability');
    check(await p.locator('#handoff-dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Handoff dialog fits narrow width');
    const phoneLink = await p.locator('#open-journal').getAttribute('href');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    phone.on('dialog', dialog => dialog.accept());
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(phoneLink);
    await phone.waitForFunction(() => document.getElementById('cover-title').textContent === '2 days in Kyoto');
    check(await phone.locator('.stop-title-button').count() === state.trip.days[0].stops.length, 'Real handoff imports the same day into the phone journal');
    await phone.locator('.stop-title-button').first().click();
    await phone.locator('[data-edit-tab="memory"]').click();
    await phone.locator('#edit-caption').fill('京都でひと休み。A small moment to keep.');
    await phone.locator('#photo-input').setInputFiles({ name: 'test-memory.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDksAAAAASUVORK5CYII=', 'base64') });
    await phone.waitForFunction(() => !document.getElementById('save-stop').disabled);
    await phone.locator('#sticker-shelf summary').click();
    await phone.locator('[data-sticker="fox"]').click();
    await phone.locator('#save-stop').click();
    await phone.locator('#editor-dialog').waitFor({ state: 'hidden' });
    await phone.getByRole('button', { name: 'Memories', exact: true }).first().click();
    check((await phone.locator('#book-content').innerText()).includes('京都でひと休み。'), 'Personal caption appears on the memories page');
    check(await phone.locator('.memory-media>img').count() > 0, 'Uploaded photo appears on the memory card');
    check(await phone.locator('.memory-card img[alt="Fox sticker"]').count() > 0, 'Selected sticker appears on the memory card');
    await phone.evaluate(() => {
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__lastExport = blob; return create.call(this, blob); };
    });
    await phone.getByRole('button', { name: 'Save & take', exact: true }).click();
    await phone.locator('[data-action="export-html"]').click();
    const html = await phone.evaluate(async () => window.__lastExport.text());
    const book = JSON.parse(html.match(/<script id="book-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    check(book.stops.some(s => s.caption.includes('京都') && s.photo?.startsWith('data:image/jpeg') && s.stickers.includes('fox')), 'Exported HTML contains the photo, caption and sticker together');
    const saved = await context.newPage();
    await saved.route('**/saved-journal.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await saved.goto(`${origin}/saved-journal.html`);
    await saved.locator('#application').waitFor({ state: 'visible' });
    await saved.getByRole('button', { name: 'Memories', exact: true }).first().click();
    check((await saved.locator('#book-content').innerText()).includes('京都でひと休み。'), 'Standalone exported HTML reopens with the saved memory');
    check(errors.length === 0, 'No uncaught browser errors during the full journey');
    return { passed: checks.length, checks };
  } finally { await context.close(); }
}
