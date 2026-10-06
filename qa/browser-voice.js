// Run against the running app with the Playwright browser tool. Only the browser
// speech APIs are mocked; requests, MCP, planning, confirmation and handoff are real.
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const speech = { recognition: null, utterance: null, recognized: 0, spoken: [], overlap: false };
    class Recognition {
      start() { speech.recognition = this; if (speech.utterance) speech.overlap = true; queueMicrotask(() => this.onstart?.()); }
      abort() { if (speech.recognition === this) speech.recognition = null; }
      stop() { this.abort(); this.onend?.(); }
    }
    class Utterance { constructor(text) { this.text = text; } }
    const synthesis = {
      cancel() { speech.utterance = null; },
      speak(utterance) { if (speech.recognition) speech.overlap = true; speech.utterance = utterance; speech.spoken.push(utterance.text); },
    };
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
    window.__speech = speech;
    window.__say = (text, final = true) => {
      const rec = speech.recognition;
      if (!rec) throw new Error('No active recognition turn');
      const result = Object.assign([{ transcript: text, confidence: 0.99 }], { isFinal: final });
      rec.onresult?.({ resultIndex: 0, results: [result] });
    };
    window.__finishReply = () => {
      const utterance = speech.utterance;
      if (!utterance) throw new Error('No reply to finish');
      speech.utterance = null;
      utterance.onend?.();
    };
  });
  const p = await context.newPage(), checks = [], errors = [], posts = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  p.on('pageerror', error => errors.push(error.message));
  p.on('request', request => { if (request.url().endsWith('/api/chat') && request.method() === 'POST') posts.push(request.postDataJSON()); });
  const listening = () => p.waitForFunction(() => document.querySelector('.voice-panel').dataset.phase === 'listening');
  const finish = async () => { await p.evaluate(() => window.__finishReply()); await listening(); };
  const say = async words => {
    await listening();
    const [response] = await Promise.all([
      p.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST'),
      p.evaluate(text => window.__say(text), words),
    ]);
    const state = await response.json();
    if (!response.ok()) throw new Error(state.error);
    await p.waitForFunction(() => document.querySelector('.voice-panel').dataset.phase === 'speaking');
    return state;
  };
  try {
    await p.goto(origin);
    await p.waitForFunction(() => !document.getElementById('voice-toggle').disabled);
    check(await p.evaluate(() => !window.__speech.recognition), 'Microphone stays off before the explicit start');
    for (const width of [1280, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Voice controls fit ${width}px`);
    }
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.locator('#voice-language').selectOption('ja-JP');
    await p.locator('#voice-toggle').click();
    await listening();
    check(await p.evaluate(() => window.__speech.recognition.lang === 'ja-JP'), 'Selected language reaches recognition');
    await p.evaluate(() => window.__say('京都に', false));
    check(posts.length === 0, 'Interim words are displayed without submission');
    let state = await say('京都に2日間。カフェ多めでゆっくり');
    check(!state.trip && state.proposal.kind === 'create', 'A spoken request prepares a real trip proposal');
    check(state.voiceLanguage === 'ja-JP' && state.voiceReply.includes('京都'), 'The proposal is read in the selected language');
    check(await p.evaluate(() => !window.__speech.recognition), 'Microphone stops while the proposal is read');
    const createId = state.proposal.proposalId;
    await finish();
    state = await say('それでお願い');
    check(posts.at(-1).proposalId === createId && !!state.trip && !state.proposal, 'Spoken approval applies exactly the proposal that finished reading');
    check(await p.locator('#stop-list .stop').count() > 0, 'The confirmed itinerary is written on screen');
    await finish();
    state = await say('天気を教えて');
    check(state.weather.source === 'demo' && state.voiceReply.includes('サンプル'), 'Spoken weather explicitly identifies sample data');
    await finish();
    state = await say('雨の予定を屋内に変えて');
    check(state.proposal?.diff.length > 0, 'Spoken indoor request creates an actual change preview');
    const before = state.trip.days;
    await finish();
    state = await say('キャンセル');
    check(!state.proposal && JSON.stringify(state.trip.days) === JSON.stringify(before), 'Spoken cancel preserves the current itinerary');
    await finish();
    state = await say('スマホで開きたい');
    check(state.voiceHandoffReady && await p.locator('#handoff-dialog').isVisible(), 'Spoken handoff opens the real journal link');
    check((await p.locator('#open-journal').getAttribute('href')).includes('#trip='), 'Handoff contains the encoded itinerary');
    if (state.handoff.reachableFromPhone) {
      check(await p.locator('#qr-container img').count() === 1, 'LAN handoff displays the QR image');
      check(await p.locator('#qr-container img').evaluate(img => img.complete && img.naturalWidth > 0), 'The QR image renders successfully');
    }
    await p.evaluate(() => window.__finishReply());
    await p.waitForFunction(() => document.querySelector('.voice-panel').dataset.phase === 'idle');
    check(await p.evaluate(() => !window.__speech.recognition), 'Microphone stays off after phone handoff');
    check(await p.evaluate(() => !window.__speech.overlap), 'Listening and read-aloud never overlap');
    await p.locator('#close-handoff').click();
    await p.locator('#voice-language').selectOption('en-US');
    await p.locator('#voice-toggle').click();
    await listening();
    state = await say('Plan two easy days in Seattle');
    check(state.proposal.details.city === 'seattle' && state.voiceLanguage === 'en-US', 'English conversation also prepares the requested trip');
    // Stopping during read-aloud must not leave confirmation armed.
    await p.locator('#voice-toggle').click();
    check(await p.evaluate(() => !window.__speech.utterance && !window.__speech.recognition), 'End conversation stops both audio directions');
    await p.locator('#voice-toggle').click();
    await listening();
    state = await say('Yes, use this plan');
    check(posts.at(-1).proposalId === null && state.trip.city === 'kyoto' && state.proposal.details.city === 'seattle', 'Approval after an interrupted reading cannot apply the unreviewed proposal');
    await p.locator('#voice-toggle').click();
    check(errors.length === 0, 'No uncaught browser errors in the voice journey');
    return { passed: checks.length, checks, speechHardware: 'Mocked recognition and synthesis; real HTTP/MCP backend' };
  } finally { await context.close(); }
}
