// Fault-injection browser checks; never calls AWS or changes real weather.
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const checks = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  let failLoad = true, injected = null, chatCount = 0;
  await p.route('**/api/state', async route => {
    if (failLoad) return route.fulfill({ status: 503, json: { error: 'Planner temporarily unavailable.' } });
    if (injected) return route.fulfill({ json: injected });
    return route.continue();
  });
  try {
    await p.goto(origin);
    await p.locator('#connection-error').waitFor({ state: 'visible' });
    check(await p.locator('#create-button').isDisabled(), 'Offline initial load disables planning');
    failLoad = false;
    await p.locator('#retry-load').click();
    await p.waitForFunction(() => !document.getElementById('trip-fields').disabled);
    check(await p.locator('#connection-error').isHidden(), 'Retry restores planning after a connection failure');
    const act = async selector => {
      const [response] = await Promise.all([p.waitForResponse(r => r.url().endsWith('/api/action')), p.locator(selector).click()]);
      const state = await response.json();
      await p.waitForFunction(() => document.querySelector('.folio').getAttribute('aria-busy') === 'false');
      return state;
    };
    await p.locator('#trip-options > summary').click();
    await act('#create-button');
    const state = await act('#confirm-proposal');
    injected = structuredClone(state);
    injected.weather = { day: 1, date: state.trip.startDate, source: 'open-meteo', assessmentComplete: false, atRisk: [], unknownStops: [{ time: '10:00', title: 'A garden' }] };
    await p.reload();
    await p.locator('#weather-card').waitFor({ state: 'visible' });
    check((await p.locator('#weather-card h3').innerText()).includes('missing'), 'Partial forecast is never labelled an all-clear');
    check((await p.locator('#weather-card').innerText()).includes('A garden'), 'Stops with missing forecast data are identified');
    await p.route('**/api/chat', async route => {
      chatCount++;
      injected.proposal = { proposalId: 'fault-injection-proposal', kind: 'change', summary: 'A prepared indoor alternative', diff: [], warnings: [] };
      await route.fulfill({ status: 502, json: { error: 'Cloud conversation failed. No changes were applied.' } });
    });
    await p.locator('#type-toggle').click();
    await p.locator('#message').fill('Please suggest an indoor alternative.');
    await p.locator('#send-message').click();
    await p.locator('#action-error').waitFor({ state: 'visible' });
    check((await p.locator('#proposal-summary').innerText()).includes('prepared indoor'), 'Read-only state refresh recovers a proposal prepared before a cloud error');
    check(chatCount === 1, 'Failed mutation is not retried automatically');
    check(!(await p.locator('#confirm-proposal').isDisabled()), 'Recovered proposal still has explicit confirmation controls');
    check((await p.locator('#itinerary-title').innerText()) === state.trip.title, 'Cloud error preserves the confirmed itinerary');
    return { passed: checks.length, checks };
  } finally { await context.close(); }
}
