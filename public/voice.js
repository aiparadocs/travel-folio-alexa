'use strict';

// One microphone turn at a time. Confirmation is tied to completed speech,
// never to model prose or a recognition callback arriving after Stop.
window.createVoiceConversation = function createVoiceConversation(options) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const supported = !!(Recognition && synth && window.SpeechSynthesisUtterance && window.isSecureContext);
  let active = false, available = false, generation = 0;
  let phase = 'idle', language = 'en-US', armedProposalId = null;
  let microphone = null, utterance = null, timer = null, silenceCount = 0;
  const text = (en, ja) => language === 'ja-JP' ? ja : en;
  const current = (token) => active && token === generation && !document.hidden;
  const clearTimer = () => { window.clearTimeout(timer); timer = null; };
  function status(next, message) {
    phase = next;
    options.onStatus?.({ phase, message, active, supported, available });
  }
  function releaseMic() {
    const old = microphone;
    microphone = null;
    if (old) {
      old.onstart = old.onresult = old.onend = old.onerror = old.onnomatch = null;
      try { old.abort(); } catch { /* An ended recognition session needs no cleanup. */ }
    }
  }
  function releaseSpeech() {
    if (utterance) utterance.onend = utterance.onerror = null;
    utterance = null;
    try { synth?.cancel(); } catch { /* A disabled speech service may reject cancellation. */ }
  }
  function stop(message) {
    const wasThinking = phase === 'thinking';
    active = false;
    generation++;
    armedProposalId = null;
    clearTimer();
    releaseMic();
    releaseSpeech();
    status('idle', message || (wasThinking
      ? text('Conversation ended. Your sent request may still finish; check the plan.', '会話を終了しました。送信済みの操作は完了することがあります。画面で確認してください。')
      : text('Conversation ended. Start again whenever you like.', '会話を終了しました。また始めるときはボタンを押してください。')));
    options.onActiveChange?.(false);
  }
  function scheduleListening(token, delay = 350) {
    clearTimer();
    timer = window.setTimeout(() => { if (current(token)) listen(token); }, delay);
  }
  function quietTurn(token) {
    if (!current(token)) return;
    clearTimer();
    releaseMic();
    if (++silenceCount >= 2) {
      stop(text('Paused because no speech was heard. Press Start conversation to try again.', '声が聞こえなかったため停止しました。「Start conversation」で再開できます。'));
      return;
    }
    status('waiting', text('I didn’t catch that. Listening once more…', '聞き取れませんでした。もう一度お話しください。'));
    scheduleListening(token, 600);
  }
  function speak(response, token) {
    if (!current(token)) return;
    const words = response?.voiceReply;
    if (typeof words !== 'string' || !words.trim() || words.length > 12000) {
      stop(text('The reply could not be read aloud. Use the on-screen controls, or start again.', '返答を読み上げられませんでした。画面の操作を使うか、会話を再開してください。'));
      return;
    }
    clearTimer();
    releaseMic();
    releaseSpeech();
    armedProposalId = null;
    status('speaking', text('Speaking…', '読み上げ中…'));
    const spokenProposalId = typeof response.voiceProposalId === 'string' ? response.voiceProposalId : null;
    let speech;
    try { speech = new window.SpeechSynthesisUtterance(words); }
    catch {
      stop(text('Read-aloud is unavailable. Use the buttons or start again.', '読み上げを利用できません。画面のボタンを使うか、会話を再開してください。'));
      return;
    }
    utterance = speech;
    speech.lang = response.voiceLanguage === 'ja-JP' ? 'ja-JP' : 'en-US';
    speech.rate = 0.98;
    speech.onend = () => {
      if (!current(token) || utterance !== speech) return;
      clearTimer();
      utterance = null;
      if (response.voiceHandoffReady) {
        stop(text('Your journal link is ready. Conversation ended; you can scan the QR or open the link.', '手帳のリンクを表示しました。会話を終了します。QRを読み取るか、リンクを開いてください。'));
        return;
      }
      armedProposalId = spokenProposalId && options.getState()?.proposal?.proposalId === spokenProposalId ? spokenProposalId : null;
      status('waiting', text('Your turn…', 'どうぞお話しください。'));
      scheduleListening(token);
    };
    speech.onerror = () => {
      if (current(token) && utterance === speech) stop(text('Read-aloud stopped. No voice confirmation is armed. Use the buttons or start again.', '読み上げが止まりました。声での確定は保留です。画面のボタンを使うか、会話を再開してください。'));
    };
    timer = window.setTimeout(() => {
      if (current(token) && utterance === speech) stop(text('Read-aloud did not finish. Use the buttons or start again.', '読み上げが完了しませんでした。画面のボタンを使うか、会話を再開してください。'));
    }, 180000);
    try { synth.speak(speech); } catch { speech.onerror?.(); }
  }
  function listen(token) {
    if (!current(token)) return;
    clearTimer();
    releaseMic();
    const proposalId = armedProposalId && options.getState()?.proposal?.proposalId === armedProposalId ? armedProposalId : null;
    let rec;
    try { rec = new Recognition(); }
    catch {
      stop(text('Speech recognition is unavailable here. Try this address in Chrome, or use text.', 'このブラウザでは音声認識を利用できません。同じURLをChromeで開くか、文字で操作してください。'));
      return;
    }
    microphone = rec;
    let accepted = false;
    rec.lang = language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const valid = () => current(token) && microphone === rec && !accepted;
    status('starting', text('Starting microphone…', 'マイクに接続中…'));
    timer = window.setTimeout(() => {
      if (valid()) stop(text('The microphone did not start. Check its permission, then try again.', 'マイクを開始できませんでした。マイクの許可を確認して再開してください。'));
    }, 12000);
    rec.onstart = () => {
      if (!valid()) return;
      clearTimer();
      status('listening', proposalId
        ? text('Listening… Say yes to confirm.', '「それでお願い」で確定できます。')
        : text('Listening…', 'お話しください。'));
      timer = window.setTimeout(() => { if (valid()) quietTurn(token); }, 25000);
    };
    rec.onresult = async (event) => {
      if (!valid()) return;
      const results = Array.from(event.results || []).slice(event.resultIndex || 0);
      const finals = results.filter(result => result.isFinal);
      if (!finals.length) {
        options.onTranscript?.(results.map(result => result[0]?.transcript || '').join(' ').slice(0, 1000), false);
        return;
      }
      const message = finals.map(result => result[0]?.transcript || '').join(' ').trim().slice(0, 1000);
      if (!message) { quietTurn(token); return; }
      accepted = true;
      clearTimer();
      releaseMic();
      silenceCount = 0;
      options.onTranscript?.(message, true);
      if (/^(?:stop(?: listening| conversation)?|end (?:the )?conversation|会話(?:を)?(?:終わり|終わる|終えて|終了|やめて)|おしまい|終了(?:して)?|止めて|やめて|ストップ)[.!。！\s]*$/i.test(message)) { stop(); return; }
      armedProposalId = null;
      status('thinking', text('Planning…', '旅程を作成中…'));
      let response;
      try { response = await options.onMessage({ message, inputMode: 'voice', language, proposalId }); }
      catch { response = null; }
      if (!current(token)) return;
      if (!response) {
        stop(text('Conversation paused. Check the message on screen, then start again.', '会話を停止しました。画面のメッセージを確認してから再開してください。'));
        return;
      }
      speak(response, token);
    };
    rec.onerror = event => {
      if (!valid()) return;
      if (event.error === 'no-speech') { quietTurn(token); return; }
      const messages = {
        'not-allowed': text('Allow microphone access in your browser, then start again.', 'ブラウザでマイクを許可してから、会話を再開してください。'),
        'service-not-allowed': text('Speech recognition is unavailable here. Open this address in Chrome, or use text.', 'このブラウザでは音声認識を利用できません。同じURLをChromeで開くか、文字で操作してください。'),
        'audio-capture': text('No microphone was found. Connect one, or use text.', 'マイクが見つかりません。接続を確認するか、文字で操作してください。'),
        network: text('The speech service could not connect. Try this address in Chrome, or use text.', '音声認識サービスに接続できません。同じURLをChromeで試すか、文字で操作してください。'),
      };
      stop(messages[event.error] || text('Listening stopped. Press Start conversation to try again.', '聞き取りが止まりました。「Start conversation」で再開できます。'));
    };
    rec.onend = rec.onnomatch = () => { if (valid()) quietTurn(token); };
    try { rec.start(); } catch { if (valid()) stop(text('The microphone could not start. Check browser permissions, or use text.', 'マイクを開始できません。ブラウザの許可を確認するか、文字で操作してください。')); }
  }
  function start() {
    if (active || !supported || !available || document.hidden) return;
    language = options.getLanguage?.() === 'ja-JP' ? 'ja-JP' : 'en-US';
    active = true;
    generation++;
    armedProposalId = null;
    silenceCount = 0;
    releaseSpeech();
    options.onActiveChange?.(true);
    listen(generation);
  }
  function setAvailable(value) {
    available = !!value;
    options.onStatus?.({ phase, active, supported, available });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop(text('Conversation paused when you left the page.', '画面を離れたため会話を停止しました。')); });
  window.addEventListener('pagehide', () => { if (active) stop(); });
  status('idle', supported ? 'Mic off · Ready when you are' : 'Voice unavailable. Try Chrome, or type below.');
  return { start, stop, setAvailable, get active() { return active; }, get supported() { return supported; } };
};
