'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let selectedDay = 1;
  let busy = false;
  let renderedMessages = '';
  let handoffUrl = '';
  let recognition = null;
  let listening = false;
  let lastFocused = null;
  let voice = null;
  const labels = { coffee: 'Coffee', food: 'Food', walk: 'A little exploring', shop: 'Shops', indoor: 'Indoors', stay: 'A place to stay', train: 'Getting around', other: 'A stop along the way' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function dateLabel(iso, options = { month: 'short', day: 'numeric' }) {
    if (!iso) return '';
    const date = new Date(`${iso}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(iso) : new Intl.DateTimeFormat('en', options).format(date);
  }
  function setBusy(value, label = '') {
    busy = value;
    $('trip-fields').disabled = value || !state;
    $('message').disabled = value || !state;
    $('send-message').disabled = value || !state;
    $('microphone').disabled = value || !state || !!voice?.active;
    if (voice) voice.setAvailable(!value && !!state);
    document.querySelectorAll('[data-action]').forEach((button) => { button.disabled = value || !state?.trip; });
    $('confirm-proposal').disabled = value || !state?.proposal;
    $('suggestion-button').disabled = value;
    $('suggestion-dismiss').disabled = value;
    $('decline-proposal').disabled = value || !state?.proposal;
    document.querySelector('.folio').setAttribute('aria-busy', String(value));
    $('action-status').textContent = label;
    $('create-button').firstChild.textContent = value ? 'One little moment… ' : 'Make my plan ';
  }
  async function request(path, payload) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch(path, { method: payload ? 'POST' : 'GET', credentials: 'same-origin', headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(result?.error || `The request could not be completed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (!result || !result.config) throw new Error('The planner returned an incomplete response. Please try again.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('This is taking longer than expected. The action may still finish; refresh to check your plan before trying again.');
      if (error instanceof TypeError) throw new Error('We cannot reach the planner. Keep the launch window open, then try again.');
      throw error;
    } finally { window.clearTimeout(timer); }
  }
  function showError(error) {
    $('action-error').hidden = false;
    $('action-error').textContent = error?.message || 'Something got in the way. Please try again.';
  }
  function clearError() { $('action-error').hidden = true; $('action-error').textContent = ''; }

  function renderMessages(messages) {
    const items = (Array.isArray(messages) ? messages : []).filter((message, index) => !(index === 0 && message.role === 'assistant' && message.text?.startsWith('Let’s plan something worth remembering.')));
    $('conversation').hidden = !items.length;
    $('conversation-heading').hidden = !items.length;
    const key = JSON.stringify(items);
    if (key === renderedMessages) return;
    renderedMessages = key;
    const log = $('conversation');
    log.replaceChildren();
    if (!items.length) {
      return;
    }
    for (const message of items.slice(-20)) {
      const isUser = message.role === 'user';
      const node = el('div', `message ${isUser ? 'user' : 'assistant'}`);
      node.append(el('span', 'message-label', isUser ? 'You' : 'Travel Folio'), el('p', '', message.text || ''));
      log.append(node);
    }
    log.scrollTop = log.scrollHeight;
  }

  function renderProposal(proposal) {
    $('proposal').hidden = !proposal;
    $('proposal-diff').replaceChildren();
    $('proposal-warnings').replaceChildren();
    $('proposal-details').replaceChildren();
    if (!proposal) return;
    const create = proposal.kind === 'create';
    $('proposal-title').textContent = create ? 'Your new trip' : 'A change of plan';
    $('proposal-summary').textContent = proposal.summary || 'Review this proposal before applying it.';
    $('confirm-proposal').textContent = create ? 'Use this plan' : 'Apply these changes';
    $('decline-proposal').textContent = state?.trip ? 'Keep current plan' : 'Not yet';
    const diffs = Array.isArray(proposal.diff) ? proposal.diff : [];
    // When stops are swapped, added or removed, the re-timed ones are summarized in one row
    // so the real changes stand out; a pure time shift still lists every stop.
    const headline = diffs.filter((diff) => typeof diff === 'string' || diff.op !== 'moved');
    const moved = diffs.length - headline.length;
    const rows = headline.length ? headline : diffs;
    for (const diff of rows) {
      const row = el('li');
      if (typeof diff === 'string') { row.textContent = diff; $('proposal-diff').append(row); continue; }
      row.append(el('span', 'diff-day', `DAY ${diff.day || selectedDay} · ${String(diff.op || 'change').toUpperCase()}`));
      if (diff.before) row.append(el('del', '', [diff.before.time, diff.before.title].filter(Boolean).join(' · ')));
      if (diff.after) row.append(el('ins', '', [diff.after.time, diff.after.title].filter(Boolean).join(' · ')));
      $('proposal-diff').append(row);
    }
    if (headline.length && moved) {
      const row = el('li', 'diff-summary');
      row.append(el('span', 'diff-day', 'LATER STOPS'), el('span', '', `${moved} stop${moved === 1 ? '' : 's'} adjusted to fit`));
      $('proposal-diff').append(row);
    }
    for (const warning of proposal.warnings || []) $('proposal-warnings').append(el('li', '', warning));
  }

  function renderWeather(weather) {
    const panel = $('weather-card');
    panel.replaceChildren();
    panel.hidden = !weather || (weather.day != null && Number(weather.day) !== selectedDay);
    if (panel.hidden) return;
    const available = ['demo', 'open-meteo'].includes(weather.source);
    const risk = Array.isArray(weather.atRisk) ? weather.atRisk : [];
    const unknown = Array.isArray(weather.unknownStops) ? weather.unknownStops : [];
    const complete = available && weather.assessmentComplete === true && !unknown.length;
    panel.classList.toggle('unavailable', !complete);
    const heading = el('h3');
    const title = !available ? 'Forecast unavailable' : !complete ? 'Some forecast data is missing' : weather.rainyWindow || risk.length ? 'Rain on the way' : 'No significant rain forecast';
    heading.append(icon('rain'), document.createTextNode(title));
    panel.append(heading);
    if (!available) {
      panel.append(el('p', '', 'No forecast for this date. Your itinerary is unchanged.'));
    } else {
      if (!complete) {
        panel.append(el('p', '', 'Rain risk is unknown for some stops. Check another forecast before heading out.'));
        if (unknown.length) {
          panel.append(el('p', '', 'Forecast incomplete for:'));
          const list = el('ul');
          unknown.forEach((stop) => list.append(el('li', '', [stop.time, stop.title].filter(Boolean).join(' · '))));
          panel.append(list);
        }
      }
      if (weather.rainyWindow) panel.append(el('p', '', `${weather.rainyWindow.from}–${weather.rainyWindow.to}.${!risk.length && complete ? ' Your outdoor stops are outside these hours.' : ''}`));
      else if (complete && !risk.length) panel.append(el('p', '', 'Your outdoor stops look clear. Weather can change.'));
      if (risk.length) {
        panel.append(el('p', '', 'Outdoor stops at risk:'));
        const list = el('ul');
        risk.forEach((stop) => list.append(el('li', '', `${stop.time || ''} · ${stop.title}${stop.locked ? ' · fixed time' : ''}`)));
        panel.append(list);
      }
    }
    panel.append(el('p', 'weather-source', weather.source === 'demo' ? 'Sample weather · Demo only' : weather.source === 'open-meteo' ? `Open-Meteo · ${dateLabel(weather.date)} · Local time · CC BY 4.0` : 'No forecast available.'));
  }

  function renderTrip(trip) {
    $('empty-state').hidden = !!trip || !!state?.proposal;
    $('trip-content').hidden = !trip;
    if (!trip) {
      $('itinerary-title').textContent = 'Your itinerary';
      $('trip-subtitle').hidden = true;
      return;
    }
    const days = Array.isArray(trip.days) ? trip.days : [];
    if (!days.some((day) => Number(day.day) === selectedDay)) selectedDay = Number(days[0]?.day) || 1;
    $('itinerary-title').textContent = trip.title || 'Your little trip';
    $('trip-subtitle').hidden = false;
    $('trip-subtitle').textContent = [trip.city === 'kyoto' ? 'Kyoto, Japan' : trip.city === 'seattle' ? 'Seattle, USA' : trip.city, `${days.length} ${days.length === 1 ? 'day' : 'days'}`, dateLabel(trip.startDate), trip.pace ? `${trip.pace} pace` : ''].filter(Boolean).join(' · ');
    $('trip-options-label').textContent = 'Plan another trip';
    $('day-navigation').replaceChildren();
    for (const day of days) {
      const button = el('button', 'day-button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(Number(day.day) === selectedDay));
      button.append(document.createTextNode(`Day ${day.day}`));
      if (day.date) button.append(el('small', '', dateLabel(day.date, { weekday: 'short' })));
      button.addEventListener('click', () => {
        selectedDay = Number(day.day);
        renderTrip(state.trip);
        renderWeather(state.weather);
        setBusy(busy);
        Array.from($('day-navigation').children).find((node) => node.getAttribute('aria-pressed') === 'true')?.focus({ preventScroll: true });
      });
      $('day-navigation').append(button);
    }
    $('adjust-day').textContent = `Day ${selectedDay}`;
    $('stop-list').replaceChildren();
    const day = days.find((entry) => Number(entry.day) === selectedDay);
    for (const stop of day?.stops || []) {
      const row = el('li', 'stop');
      const marker = el('span', 'stop-marker');
      marker.append(icon(stop.kind === 'coffee' || stop.kind === 'food' ? 'coffee' : stop.exposure === 'indoor' ? 'house' : 'pin'));
      const body = el('div', 'stop-body');
      body.append(el('h3', 'stop-title', stop.title));
      const meta = el('p', 'stop-meta');
      meta.append(el('span', '', labels[stop.kind] || 'A stop along the way'));
      if (stop.minutes) meta.append(el('span', '', `About ${stop.minutes} min`));
      if (stop.exposure === 'indoor' && stop.kind !== 'indoor') meta.append(el('span', '', 'Indoors'));
      if (stop.locked) meta.append(el('span', '', 'Time fixed'));
      if (stop.done) meta.append(el('span', '', 'Visited'));
      body.append(meta);
      row.append(el('span', 'stop-time', stop.time), marker, body);
      $('stop-list').append(row);
    }
    if (!day?.stops?.length) $('stop-list').append(el('li', 'stop', 'A little space in your day. Add a coffee stop to begin.'));
  }

  function render(next) {
    const previous = state;
    state = next;
    const config = state.config || {};
    const bedrock = config.agentMode === 'bedrock';
    $('mode-label').textContent = `${bedrock ? 'AI planning' : 'Guided demo'} · ${config.weatherMode === 'demo' ? 'Demo weather' : 'Live weather'}`;
    $('chat-mode').textContent = bedrock ? 'Amazon Bedrock' : 'Guided conversation';
    $('mode-description').textContent = bedrock ? 'Conversation uses Amazon Bedrock. Trip changes still need your confirmation. The buttons are available for direct requests, too.' : 'Guided conversation understands a few travel requests: create a trip, check rain, find indoor alternatives, delay a day, add coffee, undo or take the plan to your phone. The buttons work without an AI account.';
    $('weather-description').textContent = config.weatherMode === 'demo' ? 'Sample weather is enabled: a fixed rainy first day, from 10:00 to 17:00. It helps you try a change and is not a real forecast.' : 'Forecasts are requested from Open-Meteo for your selected date. If data is unavailable, the app says so. A suggestion is never a guarantee of opening hours or availability.';
    if ((!previous?.trip && state.trip) || previous?.trip?.tripId !== state.trip?.tripId && state.trip) $('trip-options').open = false;
    $('memory-description').textContent = config.remembers ? 'Your home plan is saved on this computer, so it is still here when you come back, even after a restart.' : 'Your home plan lasts while the server is running.';
    renderMessages(state.messages);
    $('suggestion').hidden = !state.suggestion;
    $('suggestion-label').textContent = state.suggestion?.label || '';
    renderProposal(state.proposal);
    renderTrip(state.trip);
    renderWeather(state.weather);
    $('tool-trace').textContent = state.trace?.length ? state.trace.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry, null, 2)).join('\n\n') : 'No travel tools called yet.';
    if (!state.handoff && $('handoff-dialog').open) $('handoff-dialog').close();
    setBusy(busy);
  }

  function speak(reply) {
    if (!$('read-aloud').checked || !window.speechSynthesis || !reply) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  async function perform(path, payload, fromVoice = false) {
    if (busy) return false;
    if (!fromVoice && voice?.active) voice.stop('Conversation paused while you use the on-screen controls.');
    clearError();
    const oldProposal = state?.proposal?.proposalId;
    const oldHandoff = state?.handoff?.url;
    setBusy(true, 'Planning…');
    try {
      const next = await request(path, payload);
      render(next);
      $('connection-error').hidden = true;
      if (!fromVoice) speak(next.reply);
      if (next.proposal?.proposalId && next.proposal.proposalId !== oldProposal) {
        $('proposal').scrollIntoView({ block: 'nearest', behavior: 'auto' });
        $('proposal').focus({ preventScroll: true });
      } else if (payload.action === 'confirm') {
        $('itinerary-title').setAttribute('tabindex', '-1');
        $('itinerary-title').focus({ preventScroll: true });
      }
      if (next.handoff && (payload.action === 'handoff' || next.voiceHandoffReady || next.handoff.url !== oldHandoff)) showHandoff(next.handoff);
      return next;
    } catch (error) {
      // A tool may have prepared a proposal before a later model/network failure.
      // Re-read state, but never repeat the mutation automatically.
      try { render(await request('/api/state')); } catch { /* Keep the last known plan visible while offline. */ }
      showError(error);
      $('action-error').scrollIntoView({ block: 'nearest', behavior: 'auto' });
      return false;
    }
    finally { setBusy(false); }
  }

  function safeQr(svgText) {
    if (typeof svgText !== 'string' || svgText.length > 250000) return null;
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || parsed.querySelector('parsererror')) return null;
    const allowedTags = new Set(['svg', 'path', 'rect', 'g']);
    const allowedAttrs = new Set(['xmlns', 'viewBox', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'shape-rendering', 'x', 'y']);
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!allowedTags.has(node.localName)) return null;
      for (const attr of [...node.attributes]) {
        if (!allowedAttrs.has(attr.name) || /url\s*\(/i.test(attr.value)) node.removeAttribute(attr.name);
      }
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  }

  function showHandoff(handoff) {
    let url;
    try { url = new URL(handoff.url, window.location.href); } catch { showError(new Error('This itinerary link is not valid. Please generate it again.')); return; }
    if (!['http:', 'https:'].includes(url.protocol)) { showError(new Error('This itinerary link is not a web address.')); return; }
    handoffUrl = url.href;
    $('open-journal').href = handoffUrl;
    $('open-journal').firstChild.textContent = handoff.reachableFromPhone ? 'Open journal ' : 'Open on this computer ';
    $('qr-container').replaceChildren();
    const qr = safeQr(handoff.qrSvg);
    if (handoff.reachableFromPhone && qr) {
      const img = el('img');
      img.src = qr;
      img.alt = 'QR code to open this itinerary on your phone';
      $('qr-container').append(img);
    }
    $('handoff-intro').textContent = handoff.reachableFromPhone ? 'Scan with your phone to open the journal.' : 'This link works on this computer only.';
    $('handoff-network').textContent = handoff.reachableFromPhone ? 'Use the same Wi-Fi and keep this PC running. Anyone with the link can view the itinerary.' : 'For a phone QR, restart with “Start Travel Folio - Phone.cmd” and create a new link.';
    if (handoff.reachableFromPhone && !qr) $('handoff-intro').textContent = 'The QR preview is unavailable. Copy the itinerary link and open it on your phone, then review and import.';
    $('copy-fallback-label').hidden = true;
    $('copy-status').textContent = '';
    if (!$('handoff-dialog').open) {
      lastFocused = document.activeElement;
      $('handoff-dialog').showModal();
      $('close-handoff').focus();
    }
  }

  async function load() {
    if (busy) return;
    clearError();
    setBusy(true);
    $('retry-load').disabled = true;
    try {
      render(await request('/api/state'));
      $('connection-error').hidden = true;
    } catch (error) {
      $('connection-message').textContent = error.message;
      $('connection-error').hidden = false;
      $('mode-label').textContent = 'Planner is offline';
      return;
    } finally { $('retry-load').disabled = false; setBusy(false); }
    // Returning with a saved plan: let the assistant speak first.
    if (state?.briefingDue && !state.proposal) perform('/api/action', { action: 'briefing' });
  }

  $('trip-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = { action: 'create', city: data.get('city'), days: Number(data.get('days')), pace: data.get('pace'), interests: data.getAll('interests') };
    if (data.get('startDate')) payload.startDate = data.get('startDate');
    perform('/api/action', payload);
  });
  function summarizeOptions() {
    const pace = { relaxed: 'Easy days', balanced: 'Balanced days', packed: 'Full days' }[$('pace').value];
    $('date-pace-summary').textContent = `${$('start-date').value ? dateLabel($('start-date').value) : 'Tomorrow'} · ${pace}`;
  }
  $('start-date').addEventListener('change', summarizeOptions);
  $('pace').addEventListener('change', summarizeOptions);
  $('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('message').value.trim();
    if (!message || busy) return;
    if (await perform('/api/chat', { message })) {
      $('message').value = '';
      if (!state?.proposal && !$('handoff-dialog').open) $('message').focus({ preventScroll: true });
    }
  });
  $('message').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); }
  });
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const payload = { action: button.dataset.action, day: selectedDay };
    if (payload.action === 'delay') payload.minutes = 30;
    perform('/api/action', payload);
  }));
  $('confirm-proposal').addEventListener('click', () => { if (state?.proposal) perform('/api/action', { action: 'confirm', proposalId: state.proposal.proposalId }); });
  $('decline-proposal').addEventListener('click', () => { if (state?.proposal) perform('/api/action', { action: 'decline', proposalId: state.proposal.proposalId }); });
  $('suggestion-button').addEventListener('click', () => { if (state?.suggestion) perform('/api/action', { action: state.suggestion.action, day: state.suggestion.day }); });
  $('suggestion-dismiss').addEventListener('click', () => { if (state?.suggestion) perform('/api/action', { action: 'decline' }); });
  $('retry-load').addEventListener('click', load);
  $('close-handoff').addEventListener('click', () => $('handoff-dialog').close());
  $('handoff-dialog').addEventListener('close', () => { lastFocused?.focus?.({ preventScroll: true }); });
  $('copy-link').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(handoffUrl);
      $('copy-status').textContent = 'Link copied. Your little trip is ready to share.';
    } catch {
      $('copy-fallback-label').hidden = false;
      $('copy-fallback').value = handoffUrl;
      $('copy-fallback').focus();
      $('copy-fallback').select();
      $('copy-status').textContent = 'Copy the selected link using your device’s copy command.';
    }
  });
  $('read-aloud').addEventListener('change', () => { if (!$('read-aloud').checked) window.speechSynthesis?.cancel(); });
  voice = window.createVoiceConversation({
    getState: () => state,
    getLanguage: () => $('voice-language').value,
    onMessage: (payload) => perform('/api/chat', payload, true),
    onStatus: ({ phase, message, active, supported, available }) => {
      $('voice-toggle-label').textContent = active ? 'End conversation' : 'Start conversation';
      $('voice-toggle').disabled = !supported || (!active && !available);
      $('voice-toggle').setAttribute('aria-pressed', String(active));
      $('voice-toggle').closest('.voice-panel').dataset.phase = phase;
      $('voice-language').disabled = active;
      if (message) $('voice-status').textContent = message;
    },
    onTranscript: (message, final) => {
      $('voice-transcript').hidden = !message || final;
      $('voice-transcript').textContent = `${final ? 'You said' : 'Hearing'}: ${message}`;
    },
    onActiveChange: (active) => {
      if (active) { recognition?.abort(); listening = false; }
      $('microphone').disabled = active || busy || !state;
      $('read-aloud').disabled = active;
    },
  });
  $('voice-toggle').addEventListener('click', () => voice.active ? voice.stop() : voice.start());
  $('voice-language').addEventListener('change', () => {
    $('voice-example').textContent = $('voice-language').value === 'ja-JP' ? '「京都に2日間、カフェ多めでゆっくり」' : '“Two easy days in Kyoto, with coffee.”';
  });
  $('type-toggle').addEventListener('click', () => {
    const open = $('type-panel').hidden;
    if (open && voice.active) voice.stop('Text input is ready.');
    $('type-panel').hidden = !open;
    $('type-toggle').setAttribute('aria-expanded', String(open));
    $('type-toggle').firstChild.textContent = open ? 'Hide text input ' : 'Type instead ';
    if (open) $('message').focus();
  });
  $('trip-options').addEventListener('toggle', () => {
    if ($('trip-options').open && voice.active) voice.stop('Manual planning is ready.');
  });
  if (window.speechSynthesis) $('read-aloud-control').hidden = false;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && window.isSecureContext) {
    $('microphone').hidden = false;
    $('text-input-hint').hidden = true;
    $('voice-note').hidden = false;
    $('microphone').setAttribute('aria-pressed', 'false');
    $('microphone').addEventListener('click', () => {
      if (busy) return;
      if (listening) { recognition?.stop(); return; }
      window.speechSynthesis?.cancel();
      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => {
        listening = true;
        $('microphone').setAttribute('aria-pressed', 'true');
        $('microphone').lastElementChild.textContent = 'Stop listening';
        $('speech-status').textContent = 'Listening… Your words will appear below for you to send.';
      };
      recognition.onresult = (event) => {
        $('message').value = event.results[0]?.[0]?.transcript?.slice(0, 1000) || '';
        $('speech-status').textContent = 'Check your words, then press Send.';
        $('message').focus();
      };
      recognition.onerror = (event) => {
        const errors = { 'not-allowed': 'Microphone access was not allowed. You can type your message instead.', 'service-not-allowed': 'Voice input is unavailable here. You can type your message instead.', 'no-speech': 'No speech was heard. Try again, or type your message.', 'audio-capture': 'No microphone was found. You can type your message.', network: 'The speech service could not connect. You can type your message.' };
        $('speech-status').textContent = errors[event.error] || 'Voice input stopped. You can type your message instead.';
      };
      recognition.onend = () => {
        listening = false;
        $('microphone').setAttribute('aria-pressed', 'false');
        $('microphone').lastElementChild.textContent = 'Use voice';
        if ($('speech-status').textContent.startsWith('Listening')) $('speech-status').textContent = 'Listening stopped. Try again or type your message.';
      };
      try { recognition.start(); } catch { $('speech-status').textContent = 'Voice input is unavailable. You can type your message instead.'; }
    });
  }
  window.addEventListener('pagehide', () => { recognition?.abort(); window.speechSynthesis?.cancel(); });
  load();
})();
