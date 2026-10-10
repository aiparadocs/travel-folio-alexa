import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8');

// Test the actual browser controller with deterministic event orderings. These
// doubles do not claim to test microphone hardware or a browser speech service.
function harness(settings = {}) {
  let now = 0, nextTimer = 1;
  const timers = new Map();
  const windowEvents = new Map(), documentEvents = new Map();
  const records = [], speeches = [], requests = [], statuses = [], activeChanges = [], transcripts = [];
  const state = { proposal: null };
  const calls = { cancel: 0 };
  const document = {
    hidden: false,
    addEventListener: (type, handler) => documentEvents.set(type, handler),
  };
  class Recognition {
    constructor() {
      if (settings.recognitionConstructorThrows) throw new Error('Recognition unavailable');
      this.started = 0;
      this.aborted = 0;
      records.push(this);
    }
    start() {
      this.started++;
      if (settings.startThrows) throw new Error('Start rejected');
      if (!settings.neverStarts) this.onstart?.();
    }
    abort() { this.aborted++; }
  }
  class Speech {
    constructor(text) {
      if (settings.speechConstructorThrows) throw new Error('Speech unavailable');
      this.text = text;
    }
  }
  const window = {
    SpeechRecognition: settings.unsupported ? undefined : Recognition,
    SpeechSynthesisUtterance: Speech,
    isSecureContext: settings.secure !== false,
    speechSynthesis: {
      cancel() { calls.cancel++; if (settings.cancelThrows) throw new Error('Cancel rejected'); },
      speak(speech) { speeches.push(speech); if (settings.speakThrows) throw new Error('Speak rejected'); },
    },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { due: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: (type, handler) => windowEvents.set(type, handler),
  };
  vm.runInNewContext(source, { window, document }, { filename: 'public/voice.js' });
  let respond = settings.onMessage || (() => ({ voiceReply: 'Tell me more about your trip.', voiceLanguage: 'en-US' }));
  const voice = window.createVoiceConversation({
    getState: () => state,
    getLanguage: () => settings.language || 'en-US',
    onStatus: (status) => statuses.push({ ...status }),
    onActiveChange: (value) => activeChanges.push(value),
    onTranscript: (message, final) => transcripts.push({ message, final }),
    onMessage: (payload) => {
      requests.push(JSON.parse(JSON.stringify(payload)));
      return respond(payload);
    },
  });
  const advance = (ms) => {
    const target = now + ms;
    let count = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, timer]) => timer.due <= target);
      if (!next) break;
      assert.ok(++count < 100, 'controller must not create an unbounded retry loop');
      timers.delete(next[0]);
      now = next[1].due;
      next[1].callback();
    }
    now = target;
  };
  voice.setAvailable(true);
  return {
    voice, state, records, speeches, requests, statuses, activeChanges, transcripts, timers, calls, advance,
    respond: (fn) => { respond = fn; },
    hide() { document.hidden = true; documentEvents.get('visibilitychange')?.(); },
    show() { document.hidden = false; documentEvents.get('visibilitychange')?.(); },
    navigate() { windowEvents.get('pagehide')?.(); },
    get phase() { return statuses.at(-1)?.phase; },
  };
}

const recognitionEvent = (text, isFinal = true) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
const say = (h, text) => h.records.at(-1).onresult(recognitionEvent(text));
const proposalResponse = (id = 'p-1') => ({ voiceReply: 'Move the plan thirty minutes later. Shall I apply that change?', voiceLanguage: 'en-US', voiceProposalId: id });

test('voice waits for explicit start and submits one final utterance, never interim or duplicate events', async () => {
  const h = harness();
  assert.equal(h.records.length, 0);
  h.voice.start();
  assert.equal(h.phase, 'listening');
  const rec = h.records[0], lateResult = rec.onresult, lateEnd = rec.onend;
  await lateResult(recognitionEvent('Plan Kyoto', false));
  assert.equal(h.requests.length, 0);
  await lateResult(recognitionEvent('Plan Kyoto'));
  await lateResult(recognitionEvent('Plan Kyoto'));
  lateEnd();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].inputMode, 'voice');
  assert.equal(h.requests[0].proposalId, null);
  assert.equal(h.speeches.length, 1);
  assert.equal(h.phase, 'speaking');
  assert.equal(rec.aborted, 1);
  assert.equal(h.records.length, 1, 'microphone remains off while speaking');
});

test('voice forwards up to two other recognition guesses, so a misheard place name can be recovered', async () => {
  const h = harness();
  h.voice.start();
  const rec = h.records[0];
  assert.equal(rec.maxAlternatives, 3);
  const guesses = ['from two easy days in killed with coffee', 'plan two easy days in Kyoto with coffee', 'from two easy days in killed with coffee'];
  await rec.onresult({ resultIndex: 0, results: [Object.assign(guesses.map((transcript) => ({ transcript })), { isFinal: true })] });
  assert.equal(h.requests[0].message, guesses[0]);
  assert.deepEqual(h.requests[0].alternatives, [guesses[1]], 'duplicates of the heard text are dropped');
  const single = harness();
  single.voice.start();
  await say(single, 'Plan Kyoto');
  assert.equal('alternatives' in single.requests[0], false);
});

test('confirmation is armed only after the exact proposal finishes speaking', async () => {
  const h = harness({ onMessage: () => proposalResponse() });
  h.state.proposal = { proposalId: 'p-1' };
  h.voice.start();
  const lateResult = h.records[0].onresult;
  await say(h, 'Read the proposal');
  assert.equal(h.requests[0].proposalId, null, 'an existing on-screen proposal alone is insufficient');
  await lateResult(recognitionEvent('yes'));
  assert.equal(h.requests.length, 1, 'a callback from the old microphone cannot confirm during speech');
  h.speeches[0].onend();
  h.advance(349);
  assert.equal(h.records.length, 1);
  h.advance(1);
  assert.equal(h.records.length, 2);
  await say(h, 'Yes, use this plan');
  assert.equal(h.requests[1].proposalId, 'p-1');
});

test('changing the visible proposal during speech or the restart gap clears the confirmation ID', async () => {
  for (const when of ['during speech', 'after speech']) {
    const h = harness({ onMessage: () => proposalResponse() });
    h.state.proposal = { proposalId: 'p-1' };
    h.voice.start();
    await say(h, 'Read the proposal');
    if (when === 'during speech') h.state.proposal = { proposalId: 'p-2' };
    h.speeches[0].onend();
    if (when === 'after speech') h.state.proposal = { proposalId: 'p-2' };
    h.advance(350);
    await say(h, 'yes');
    assert.equal(h.requests[1].proposalId, null, when);
  }
});

test('stop invalidates queued recognition result/end/error/start callbacks', async () => {
  const h = harness();
  h.voice.start();
  const rec = h.records[0];
  const callbacks = { result: rec.onresult, end: rec.onend, error: rec.onerror, start: rec.onstart };
  h.voice.stop();
  await callbacks.result(recognitionEvent('yes'));
  callbacks.end();
  callbacks.error({ error: 'no-speech' });
  callbacks.start();
  h.advance(300000);
  assert.equal(h.voice.active, false);
  assert.equal(h.phase, 'idle');
  assert.equal(h.records.length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.speeches.length, 0);
  assert.equal(h.timers.size, 0);
});

test('stop while thinking ignores an eventual response even after another conversation starts', async () => {
  let finish;
  const h = harness({ onMessage: () => new Promise((resolve) => { finish = resolve; }) });
  h.voice.start();
  const pending = say(h, 'Plan Kyoto');
  assert.equal(h.phase, 'thinking');
  h.voice.stop();
  h.voice.start();
  finish(proposalResponse());
  await pending;
  assert.equal(h.voice.active, true);
  assert.equal(h.phase, 'listening');
  assert.equal(h.records.length, 2);
  assert.equal(h.speeches.length, 0);
  assert.equal(h.requests.length, 1);
});

test('stop during speech cannot arm confirmation or restart from delayed end/error callbacks', async () => {
  const h = harness({ onMessage: () => proposalResponse() });
  h.state.proposal = { proposalId: 'p-1' };
  h.voice.start();
  await say(h, 'Read the proposal');
  const speech = h.speeches[0], lateEnd = speech.onend, lateError = speech.onerror;
  h.voice.stop();
  lateEnd();
  lateError();
  h.advance(300000);
  assert.equal(h.voice.active, false);
  assert.equal(h.records.length, 1);
  h.voice.start();
  await say(h, 'yes');
  assert.equal(h.requests[1].proposalId, null);
});

test('speech errors and incomplete read-aloud time out without arming or resuming the microphone', async () => {
  for (const failure of ['error', 'timeout']) {
    const h = harness({ onMessage: () => proposalResponse() });
    h.state.proposal = { proposalId: 'p-1' };
    h.voice.start();
    await say(h, 'Read the proposal');
    const lateEnd = h.speeches[0].onend;
    if (failure === 'error') h.speeches[0].onerror({ error: 'interrupted' });
    else h.advance(180000);
    lateEnd();
    h.advance(1000);
    assert.equal(h.voice.active, false, failure);
    assert.equal(h.records.length, 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('no-speech retries once; error followed by end is counted only once', () => {
  const h = harness();
  h.voice.start();
  const first = h.records[0], lateEnd = first.onend;
  first.onerror({ error: 'no-speech' });
  lateEnd();
  assert.equal(h.voice.active, true);
  h.advance(600);
  assert.equal(h.records.length, 2);
  h.records[1].onerror({ error: 'no-speech' });
  h.advance(300000);
  assert.equal(h.voice.active, false);
  assert.equal(h.records.length, 2);
  assert.equal(h.requests.length, 0);
});

test('silence and microphone-start watchdogs stop without unbounded retries', () => {
  const silent = harness();
  silent.voice.start();
  silent.advance(50600);
  assert.equal(silent.voice.active, false);
  assert.equal(silent.records.length, 2);
  const unstarted = harness({ neverStarts: true });
  unstarted.voice.start();
  unstarted.advance(12000);
  assert.equal(unstarted.voice.active, false);
  assert.equal(unstarted.records.length, 1);
});

test('permission, network and capture failures stop instead of restarting', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported']) {
    const h = harness();
    h.voice.start();
    const lateEnd = h.records[0].onend;
    h.records[0].onerror({ error });
    lateEnd();
    h.advance(300000);
    assert.equal(h.voice.active, false, error);
    assert.equal(h.records.length, 1, error);
    assert.equal(h.requests.length, 0, error);
  }
});

test('hidden tabs and navigation stop; returning to the page does not restart', async () => {
  for (const transition of ['hide', 'navigate']) {
    const h = harness({ onMessage: () => proposalResponse() });
    h.voice.start();
    await say(h, 'Read the proposal');
    const lateEnd = h.speeches[0].onend;
    h[transition]();
    lateEnd();
    h.show();
    h.advance(300000);
    assert.equal(h.voice.active, false, transition);
    assert.equal(h.records.length, 1);
  }
});

test('recognition constructor failure is contained and leaves a usable stopped state', () => {
  const h = harness({ recognitionConstructorThrows: true });
  assert.doesNotThrow(() => h.voice.start());
  assert.equal(h.voice.active, false);
  assert.equal(h.phase, 'idle');
  assert.equal(h.timers.size, 0);
});

test('speech constructor failure is contained without leaving a stuck speaking session', async () => {
  const h = harness({ speechConstructorThrows: true });
  h.voice.start();
  await assert.doesNotReject(say(h, 'Plan Kyoto'));
  assert.equal(h.voice.active, false);
  assert.equal(h.phase, 'idle');
  assert.equal(h.timers.size, 0);
});

test('browser start/speak/cancel exceptions do not leave an active orphaned session', async () => {
  const start = harness({ startThrows: true });
  assert.doesNotThrow(() => start.voice.start());
  assert.equal(start.voice.active, false);
  const speak = harness({ speakThrows: true });
  speak.voice.start();
  await assert.doesNotReject(say(speak, 'Plan Kyoto'));
  assert.equal(speak.voice.active, false);
  const cancel = harness({ cancelThrows: true });
  assert.doesNotThrow(() => cancel.voice.start());
  assert.doesNotThrow(() => cancel.voice.stop());
  assert.equal(cancel.voice.active, false);
});

test('spoken stop stays local and a rejected API request pauses the conversation', async () => {
  for (const words of ['Stop conversation', '止めて', 'ストップ', 'やめて', '終了']) {
    const stopped = harness();
    stopped.voice.start();
    await say(stopped, words);
    assert.equal(stopped.requests.length, 0);
    assert.equal(stopped.voice.active, false);
  }
  const failed = harness({ onMessage: async () => { throw new Error('offline'); } });
  failed.voice.start();
  await say(failed, 'Plan Kyoto');
  assert.equal(failed.voice.active, false);
  assert.equal(failed.speeches.length, 0);
});

test('handoff finishes its explanation then ends without reopening the microphone', async () => {
  const h = harness({ onMessage: () => ({ voiceReply: 'Your journal link is ready.', voiceHandoffReady: true }) });
  h.voice.start();
  await say(h, 'Take it to my phone');
  assert.equal(h.voice.active, true);
  h.speeches[0].onend();
  h.advance(300000);
  assert.equal(h.voice.active, false);
  assert.equal(h.records.length, 1);
});

test('Japanese recognition, payload and read-aloud use the selected language', async () => {
  const h = harness({ language: 'ja-JP', onMessage: () => ({ voiceReply: '京都の旅程を提案します。', voiceLanguage: 'ja-JP' }) });
  h.voice.start();
  assert.equal(h.records[0].lang, 'ja-JP');
  await say(h, '京都に2日間');
  assert.equal(h.requests[0].language, 'ja-JP');
  assert.equal(h.requests[0].message, '京都に2日間');
  assert.equal(h.speeches[0].lang, 'ja-JP');
});

test('unsupported/insecure/unavailable environments never start a microphone', () => {
  for (const settings of [{ unsupported: true }, { secure: false }]) {
    const h = harness(settings);
    h.voice.start();
    assert.equal(h.voice.supported, false);
    assert.equal(h.records.length, 0);
  }
  const h = harness();
  h.voice.setAvailable(false);
  h.voice.start();
  assert.equal(h.records.length, 0);
  h.voice.setAvailable(true);
  h.hide();
  h.voice.start();
  assert.equal(h.records.length, 0);
});
