import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TravelTools } from './mcp-client.js';
import { parseGuided, isVoiceConfirmation, GUIDED_HELP } from './guided.js';
import { converseWithTools } from './bedrock.js';

const tripInput = z.object({
  city: z.enum(['kyoto', 'seattle']).default('kyoto'),
  days: z.number().int().min(1).max(4).default(2),
  pace: z.enum(['relaxed', 'balanced', 'packed']).default('relaxed'),
  interests: z.array(z.enum(['coffee', 'food', 'culture', 'nature', 'shopping', 'views', 'family'])).max(7).default(['coffee', 'culture']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const date = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
  }, 'Use a real calendar date.').optional(),
});
const dayInput = z.number().int().min(1).max(4);
const PROPOSAL_TTL = 15 * 60 * 1000;
const INTEREST_JA = { coffee: 'カフェ', food: '食事', culture: '文化', nature: '自然', shopping: '買い物', views: '景色', family: '家族での時間' };
const PACE_JA = { relaxed: 'ゆっくりしたペース', balanced: 'ほどよいペース', packed: '予定の多いペース' };
const cityName = (city, japanese) => city === 'kyoto' ? japanese ? '京都' : 'Kyoto' : japanese ? 'シアトル' : 'Seattle';

function spokenWarnings(warnings = [], japanese) {
  if (!warnings.length) return '';
  if (!japanese) return ` Please note: ${warnings.join(' ')}`;
  return `注意点です。${warnings.map((warning) => {
    let match = warning.match(/^"(.+)" is fixed at (\d{2}:\d{2}), but the plan would reach it around (\d{2}:\d{2})\.$/);
    if (match) return `${match[1]}は${match[2]}に固定されていますが、この予定では到着が${match[3]}ごろになります。`;
    match = warning.match(/^Day (\d+) now runs past 11 PM\.$/);
    if (match) return `${match[1]}日目の予定が夜11時を過ぎます。`;
    match = warning.match(/^Kept "(.+)" because it is (visited|locked)\.$/);
    if (match) return `${match[1]}は${match[2] === 'visited' ? '訪問済み' : '固定された予定'}のため、そのまま残します。`;
    match = warning.match(/^No unused indoor option near "(.+)"\.$/);
    if (match) return `${match[1]}の近くに、まだ使っていない屋内の候補がありません。`;
    return warning;
  }).join('')}`;
}

function spokenProposal(proposal, japanese) {
  if (proposal.kind === 'create') {
    if (!japanese) return `${proposal.summary} This is a starting plan; check opening hours before visiting. Shall I create this plan? Say yes to confirm, or no to cancel.`;
    const { city, days, startDate, pace, interests } = proposal.details;
    const date = new Date(`${startDate}T12:00:00Z`);
    const dateText = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
    const replace = proposal.baseVersion !== null ? '現在の旅程を置き換える案です。' : '';
    return `${replace}${dateText}から${days}日間、${cityName(city, true)}を${PACE_JA[pace]}で巡る旅を作ります。${interests.length ? `${interests.map((item) => INTEREST_JA[item]).join('と')}を取り入れます。` : ''}営業時間などは出発前に確認してください。この内容で作成しますか。よければ「はい」、やめる場合は「いいえ」と答えてください。`;
  }
  const main = proposal.diff.filter((change) => change.op !== 'moved');
  const moved = proposal.diff.filter((change) => change.op === 'moved');
  const parts = main.map((change) => {
    if (change.op === 'replaced') return japanese ? `${change.day}日目の${change.before.title}を、${change.after.time}の${change.after.title}に入れ替えます。` : `On day ${change.day}, replace ${change.before.title} with ${change.after.title} at ${change.after.time}.`;
    if (change.op === 'added') return japanese ? `${change.day}日目の${change.after.time}に${change.after.title}を追加します。` : `On day ${change.day}, add ${change.after.title} at ${change.after.time}.`;
    return japanese ? `${change.day}日目の${change.before.title}を外します。` : `On day ${change.day}, remove ${change.before.title} at ${change.before.time}.`;
  });
  if (moved.length) {
    const minute = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const deltas = moved.map((change) => minute(change.after.time) - minute(change.before.time));
    if (deltas.every((delta) => delta === deltas[0])) {
      const days = [...new Set(moved.map((change) => change.day))].map((day) => japanese ? `${day}日目` : `day ${day}`).join(japanese ? 'と' : ' and ');
      parts.push(japanese ? `${days}の予定${moved.length}件を${Math.abs(deltas[0])}分${deltas[0] > 0 ? '遅らせます' : '早めます'}。` : `Move ${moved.length} stops on ${days} ${Math.abs(deltas[0])} minutes ${deltas[0] > 0 ? 'later' : 'earlier'}.`);
    } else {
      parts.push(...moved.map((change) => japanese ? `${change.day}日目の${change.after.title}を、${change.before.time}から${change.after.time}に変更します。` : `On day ${change.day}, move ${change.after.title} from ${change.before.time} to ${change.after.time}.`));
    }
  }
  const details = `${parts.join(japanese ? '' : ' ')}${spokenWarnings(proposal.warnings, japanese)}`;
  return japanese ? `${details}この変更を反映しますか。よければ「はい」、やめる場合は「いいえ」と答えてください。` : `${details} Shall I apply these changes? Say yes to confirm, or no to cancel.`;
}

function spokenWeather(weather, japanese) {
  if (!weather) return japanese ? '天気の結果がまだありません。' : 'There is no weather result yet.';
  if (weather.source === 'unavailable') return japanese ? `${weather.day}日目の予報を取得できませんでした。雨の有無はまだ判断できません。` : `The forecast for day ${weather.day} is unavailable, so I cannot assess rain yet.`;
  const source = weather.source === 'demo' ? japanese ? 'サンプル天気では' : 'In the sample weather' : japanese ? '実際の予報では' : 'In the current forecast';
  const count = weather.atRisk?.length || 0;
  const incomplete = weather.assessmentComplete === false;
  if (japanese) return `${source}、${weather.day}日目は${count ? `${weather.rainyWindow ? `${weather.rainyWindow.from}から${weather.rainyWindow.to}ごろ、` : ''}屋外の予定${count}件に雨の影響がありそうです。「屋内に変えて」と言うと変更案を作れます。` : '確認できた屋外の予定に大きな雨のリスクはありません。'}${incomplete ? '一部の時間は予報が不明です。' : ''}`;
  return `${source}, ${count ? `${count} outdoor stop${count === 1 ? '' : 's'} on day ${weather.day} may be affected by rain. Say “find indoor alternatives” for a proposal.` : `there is no significant rain risk for the assessed outdoor stops on day ${weather.day}.`}${incomplete ? ' Some forecast hours are unknown.' : ''}`;
}
export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const zoneOf = (city) => city === 'seattle' ? 'America/Los_Angeles' : 'Asia/Tokyo';
const localDate = (city, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(city), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
function shiftDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const tomorrow = (city) => shiftDate(localDate(city), 1);
const longDate = (iso) => new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const listTitles = (items) => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export class ConversationSession {
  constructor({ id, url, token, config, bedrockModelId, region, bedrockSend }) {
    this.id = id;
    this.config = config;
    this.bedrockModelId = bedrockModelId;
    this.region = region;
    this.bedrockSend = bedrockSend;
    this.trip = null;
    this.proposal = null;
    this.handoff = null;
    this.weather = null;
    this.trace = [];
    this.messages = [{ role: 'assistant', text: 'Let’s plan something worth remembering. Choose Kyoto or Seattle, then take your plan to the phone journal. This is a simulated Alexa+ experience.' }];
    this.tools = new TravelTools({ url, token, sessionId: id, onCall: (entry) => {
      this.trace.push({ ...entry, at: new Date().toISOString() });
      this.trace = this.trace.slice(-30);
    } });
    this.queue = Promise.resolve();
    this.pending = 0;
    this.lastUsed = Date.now();
    this.rateWindow = Date.now();
    this.rateCount = 0;
    this.lastToolResult = null;
    this.handoffCreatedThisTurn = false;
    this.briefingDue = false;
    this.suggestion = null;
    this.app = null;
  }
  /** Rebuild the conversation view from a plan saved on an earlier visit. */
  async restore() {
    await this.tool('get_itinerary');
    this.messages = [];
    this.briefingDue = true;
  }
  /**
   * A proactive "welcome back" turn: look at the saved plan, the destination's
   * clock and the forecast, then offer (never apply) the most useful next step.
   */
  async briefing(now = new Date()) {
    this.briefingDue = false;
    this.suggestion = null;
    if (!this.trip) return 'Where would you like to go: Kyoto or Seattle?';
    const city = cityName(this.trip.city, false);
    const days = this.trip.days;
    const today = localDate(this.trip.city, now);
    const first = days[0].date;
    const last = days.at(-1).date;
    if (today > last) return `Welcome back. Your ${city} trip has finished. Your photos and words stay in the phone journal, and Print turns them into a one-page keepsake.`;
    const travelling = today >= first;
    const day = travelling ? days.findIndex((entry) => entry.date === today) + 1 : 1;
    const when = travelling ? `Today is day ${day} of your ${city} trip.` : `Your ${days.length}-day ${city} trip starts ${first === shiftDate(today, 1) ? 'tomorrow' : longDate(first)}.`;
    const parts = [`Welcome back. ${when}`];
    if (travelling) {
      const next = await this.tool('get_next_stop', { day });
      if (next.data.next) parts.push(`Next up: ${next.data.next.title} at ${next.data.next.time}.`);
    }
    let weather;
    try { weather = (await this.tool('check_weather', { day })).data; } catch { weather = null; }
    if (!weather || weather.source === 'unavailable') {
      parts.push(`I could not get a forecast for day ${day}, so I have not suggested any weather changes.`);
    } else if (weather.atRisk?.length) {
      const window = weather.rainyWindow ? ` from ${weather.rainyWindow.from} to ${weather.rainyWindow.to}` : '';
      const source = weather.source === 'demo' ? 'The sample weather shows' : 'The forecast shows';
      parts.push(`${source} rain${window} on day ${day}, which affects ${listTitles(weather.atRisk.map((stop) => stop.title))}. Shall I look for indoor alternatives? Nothing changes until you confirm.`);
      this.suggestion = { action: 'rain_swap', day, label: `Find indoor alternatives for day ${day}` };
    } else {
      parts.push(`No significant rain is expected for the outdoor stops on day ${day}.${travelling ? '' : ' When you are ready, take the plan to your phone.'}`);
    }
    return parts.join(' ');
  }
  pruneProposal() {
    const proposal = this.proposal;
    if (!proposal) return;
    const expiresAt = Date.parse(proposal.expiresAt);
    const knownKind = proposal.kind === 'create' || proposal.kind === 'change';
    const versionMatches = proposal.baseVersion === (this.trip?.version ?? null);
    const tripMatches = proposal.kind === 'create' || proposal.tripId === this.trip?.tripId;
    if (!knownKind || typeof proposal.proposalId !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !versionMatches || !tripMatches) this.proposal = null;
  }
  snapshot(reply) {
    this.pruneProposal();
    return {
      trip: this.trip, proposal: this.proposal, handoff: this.handoff, weather: this.weather,
      config: this.config, messages: this.messages, trace: this.trace,
      briefingDue: this.briefingDue && !!this.trip, suggestion: this.proposal ? null : this.suggestion,
      app: this.app,
      ...(reply !== undefined ? { reply } : {}),
    };
  }
  async serialized(fn) {
    if (this.pending >= 8) throw new UserError('A few requests are already waiting. Try again shortly.', 429);
    this.pending++;
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    try { return await result; } finally { this.pending--; this.lastUsed = Date.now(); }
  }
  limit() {
    if (Date.now() - this.rateWindow > 60000) { this.rateWindow = Date.now(); this.rateCount = 0; }
    if (++this.rateCount > 40) throw new UserError('Please pause a moment before the next request.', 429);
  }
  addMessage(role, text) {
    this.messages.push({ role, text });
    this.messages = this.messages.slice(-40);
  }
  async tool(name, args = {}) {
    const result = await this.tools.call(name, args);
    this.lastToolResult = { name, ...result };
    // A day-filtered read is useful model context, but must never truncate the
    // canonical full itinerary used by the UI and subsequent day validation.
    if (result.data.trip && !(name === 'get_itinerary' && args.day != null)) this.trip = result.data.trip;
    if (name === 'check_weather') this.weather = result.data;
    if (name === 'send_to_phone') { this.handoff = result.data; this.handoffCreatedThisTurn = true; }
    if (result.data.proposal) this.proposal = { ...result.data.proposal, kind: 'change' };
    if (result.ui) this.app = { ...result.ui, id: randomUUID() };
    return result;
  }
  prepareCreate(input) {
    const parsed = tripInput.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '));
    const details = parsed.data;
    details.startDate ??= tomorrow(details.city);
    const city = details.city === 'kyoto' ? 'Kyoto' : 'Seattle';
    this.proposal = {
      proposalId: `create-${randomUUID()}`, kind: 'create', details,
      summary: `${this.trip ? 'Replace the current plan with' : 'Create'} a ${details.days}-day ${city} trip from ${details.startDate}, at a ${details.pace} pace${details.interests.length ? `, with ${details.interests.join(' and ')}` : ''}.`,
      diff: [], warnings: ["Places are from a curated catalog. Check opening hours and travel times before visiting.", ...(this.trip ? ['This replaces the home plan. The last home plan can be restored with Undo; phone journal entries stay on your phone.'] : [])],
      baseVersion: this.trip?.version ?? null,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL).toISOString(),
    };
    return `${this.proposal.summary} Review the details, then confirm.`;
  }
  /** Best effort: show the pending new trip as a screen card. Saving still needs confirmation. */
  async previewCreate() {
    if (this.proposal?.kind !== 'create') return;
    try { await this.tool('preview_trip', this.proposal.details); } catch { /* the card is optional */ }
  }
  async action(input) {
    this.pruneProposal();
    const action = input.action;
    if (action === 'briefing') return this.briefing();
    this.suggestion = null;
    if (action === 'open' || action === 'repeat') return this.trip ? `Your ${this.trip.days.length}-day ${cityName(this.trip.city, false)} plan is here. Ask about the weather, make a change, or take it to your phone.` : 'Where would you like to go: Kyoto or Seattle? You can also tell me the number of days and what you enjoy.';
    if (action === 'create') {
      const reply = this.prepareCreate(input);
      await this.previewCreate();
      return reply;
    }
    if (action === 'decline') {
      if (input.proposalId !== undefined && input.proposalId !== this.proposal?.proposalId) throw new UserError('That proposal is out of date. Review the current proposal before cancelling it.', 409);
      this.proposal = null;
      return 'Cancelled. Your current plan is unchanged.';
    }
    if (action === 'confirm') {
      this.snapshot();
      const proposal = this.proposal;
      if (!proposal) throw new UserError('There is no pending proposal. Choose an action first.', 409);
      if (input.proposalId !== proposal.proposalId) throw new UserError('That confirmation is out of date. Review the current proposal and confirm it.', 409);
      let result;
      if (proposal.kind === 'create') {
        if ((this.trip?.version ?? null) !== proposal.baseVersion) throw new UserError('Your plan changed. Please prepare a new trip again.', 409);
        result = await this.tool('create_trip', proposal.details);
      } else {
        result = await this.tool('apply_change', { proposalId: proposal.proposalId, userConfirmed: true });
        if (result.data.status !== 'applied') throw new UserError('The change was not applied. Review it and try again.', 409);
      }
      this.proposal = null;
      this.handoff = null;
      this.weather = null;
      return result.text;
    }
    if (!this.trip) throw new UserError('Create a trip first. Choose Kyoto or Seattle above.');
    const day = input.day === undefined ? 1 : dayInput.parse(input.day);
    if (day > this.trip.days.length) throw new UserError(`Your trip has ${this.trip.days.length} day(s).`);
    let result;
    if (action === 'weather') result = await this.tool('check_weather', { day });
    else if (action === 'rain_swap') result = await this.tool('propose_change', { type: 'rain_swap', day });
    else if (action === 'delay') {
      const minutes = z.number().int().min(-240).max(240).refine((n) => n !== 0, 'Choose a non-zero delay.').parse(input.minutes ?? 30);
      result = await this.tool('propose_change', { type: 'shift_day', day, minutes });
    } else if (action === 'coffee') result = await this.tool('propose_change', { type: 'add_stop', day, kind: 'coffee' });
    else if (action === 'undo') {
      result = await this.tool('undo_last_change');
      this.proposal = null;
      this.weather = null;
      this.handoff = null;
    } else if (action === 'handoff') result = await this.tool('send_to_phone');
    else if (action === 'next') result = await this.tool('get_next_stop', { day });
    else throw new UserError('Unknown action. Choose one of the available buttons.');
    if (this.proposal && ['rain_swap', 'delay', 'coffee'].includes(action)) return `${this.proposal.summary} Review the changes, then confirm.`;
    return result.text;
  }
  async handleAction(input) {
    const reply = await this.action(input);
    this.addMessage('assistant', reply);
    return this.snapshot(reply);
  }
  async modelTool(name, args) {
    this.pruneProposal();
    if (name === 'create_trip') {
      if (this.proposal) return { status: 'needs_confirmation', proposal: this.proposal };
      this.prepareCreate(args);
      await this.previewCreate();
      return { status: 'needs_confirmation', proposal: this.proposal };
    }
    if (['propose_change', 'send_to_phone'].includes(name) && this.proposal) return { status: 'needs_confirmation', proposal: this.proposal };
    const result = await this.tool(name, args);
    if (name === 'send_to_phone') return { url: result.data.url, reachableFromPhone: result.data.reachableFromPhone };
    return result.data;
  }
  voiceResponse(reply, { language = 'en-US', action, confirmationBlocked = false, confirmedKind = null } = {}) {
    this.pruneProposal();
    const japanese = language === 'ja-JP';
    const handoffReady = this.handoffCreatedThisTurn;
    let spoken;
    if (this.proposal) {
      const prefix = confirmationBlocked ? japanese ? 'まだ反映していません。確認する内容を読み直します。' : 'I have not applied anything. Let me read the current proposal again. ' : action === 'weather' ? `${spokenWeather(this.weather, japanese)} ` : '';
      spoken = `${prefix}${spokenProposal(this.proposal, japanese)}`;
      return { voiceReply: spoken, voiceLanguage: language, voiceProposalId: this.proposal.proposalId, voiceHandoffReady: false };
    }
    if (confirmationBlocked) spoken = japanese ? '今は確認待ちの提案がありません。京都かシアトルへの旅を伝えるか、旅程の変更を頼んでください。' : 'There is no proposal waiting for confirmation. Tell me a trip or a change you would like.';
    else if (confirmedKind) spoken = japanese ? `${confirmedKind === 'create' ? `${cityName(this.trip.city, true)}の${this.trip.days.length}日間の旅程を作成しました` : '旅程に変更を反映しました'}。天気を確認するか、「スマホで開きたい」と言ってください。` : `${confirmedKind === 'create' ? `Your ${this.trip.days.length}-day ${cityName(this.trip.city, false)} plan is ready` : 'I applied the changes'}. Ask about the weather, or say “take it to my phone”.`;
    else if (handoffReady) spoken = japanese ? this.handoff.reachableFromPhone ? 'スマホ用のQRコードを表示しました。スマホのカメラで読み取り、手帳に取り込んでください。同じWi-FiでPCを起動したまま使えます。' : '旅程のリンクができました。今はこのPCだけで開けます。スマホで読む場合は、Phone用の起動ファイルで同じWi-Fi向けに起動し直してください。' : this.handoff.reachableFromPhone ? 'Your QR code is ready. Scan it with your phone camera, then import the plan. For a home-network link, use the same Wi-Fi and keep this computer running.' : 'The plan link is ready for this computer only. To scan it on your phone, restart with the Phone launcher on the same Wi-Fi.';
    else if (action === 'weather' || this.lastToolResult?.name === 'check_weather') spoken = spokenWeather(this.weather, japanese);
    else if (action === 'decline') spoken = japanese ? 'キャンセルしました。旅程は変更していません。次はどうしましょうか。' : 'Cancelled. Your plan is unchanged. What would you like to do next?';
    else if (action === 'undo') spoken = japanese ? '直前の旅程に戻しました。' : 'I restored the previous plan.';
    else if (action === 'next' && this.lastToolResult?.data) {
      const { next, day } = this.lastToolResult.data;
      spoken = japanese ? next ? `${day}日目の次の予定は、${next.time}の${next.title}です。` : `${day}日目の未訪問の予定は残っていません。` : reply;
    } else if (action === 'open' || action === 'repeat') spoken = japanese ? this.trip ? `${cityName(this.trip.city, true)}の${this.trip.days.length}日間の旅程があります。天気を確認するか、予定を変えるか、スマホへ渡せます。` : '旅の手帳を開きました。京都とシアトル、どちらへ行きましょうか。日数や好きな過ごし方も教えてください。' : reply;
    else spoken = japanese && this.config.agentMode === 'guided' ? 'このガイドでは京都とシアトルの旅を作れます。例えば「京都に2日間、カフェ多めでゆっくり」と言ってください。旅程があれば、天気の確認、屋内への変更、時間の変更、スマホへの受け渡しもできます。' : reply;
    return { voiceReply: spoken, voiceLanguage: language, voiceProposalId: null, voiceHandoffReady: handoffReady };
  }
  async chat(message, { inputMode = 'text', language = 'en-US', proposalId } = {}) {
    this.pruneProposal();
    this.lastToolResult = null;
    this.handoffCreatedThisTurn = false;
    this.addMessage('user', message);
    const parsed = parseGuided(message);
    const voice = inputMode === 'voice';
    let confirmationBlocked = false;
    let confirmedKind = null;
    let reply;
    // Only the direct human utterance is interpreted here. Model text never reaches this branch.
    const suggestion = this.proposal ? null : this.suggestion;
    if (parsed?.action === 'confirm' && suggestion) {
      // Accepting an offer only prepares a proposal; applying it still needs its own confirmation.
      reply = await this.action({ action: suggestion.action, day: suggestion.day });
      parsed.action = suggestion.action;
    } else if (parsed && (voice || this.config.agentMode === 'guided' || ['confirm', 'decline', 'undo'].includes(parsed.action))) {
      if (parsed.action === 'confirm') {
        if (voice && isVoiceConfirmation(message) && typeof proposalId === 'string' && proposalId === this.proposal?.proposalId) {
          confirmedKind = this.proposal.kind;
          reply = await this.action({ action: 'confirm', proposalId });
        } else {
          confirmationBlocked = voice;
          reply = this.proposal ? voice ? 'I have not applied anything. Listen to the current proposal, then say yes.' : 'Please use the confirmation button on the proposal so I can apply the exact change you reviewed.' : 'There is no pending proposal. Choose an action first.';
        }
      } else if (voice && parsed.action === 'handoff' && this.proposal) reply = 'Please confirm or cancel the pending proposal before taking the plan to your phone.';
      else reply = await this.action({ ...parsed, ...(voice && parsed.action === 'decline' && typeof proposalId === 'string' ? { proposalId } : {}) });
    } else if (this.config.agentMode === 'bedrock') {
      if (!this.config.bedrockConfigured) throw new UserError('Bedrock is not configured. Set BEDROCK_MODEL_ID and AWS_REGION, or restart with AGENT_MODE=guided. Quick-action buttons still work.', 503);
      try {
        reply = await converseWithTools({
          modelId: this.bedrockModelId, region: this.region,
          messages: voice ? this.messages.map((entry, index) => index === this.messages.length - 1 ? { ...entry, text: `${entry.text}\n\nReply in ${language === 'ja-JP' ? 'Japanese' : 'English'} for this voice conversation.` } : entry) : this.messages,
          context: { trip: this.trip, proposal: this.proposal, weatherMode: this.config.weatherMode },
          tools: await this.tools.list(), execute: (name, args) => this.modelTool(name, args), send: this.bedrockSend,
        });
        this.pruneProposal();
        if (this.proposal) reply = `${this.proposal.summary} Review the proposal and use Confirm to apply it.`;
      } catch (error) {
        throw new UserError(`Bedrock could not finish this request. No changes were applied. Use the buttons or try again. ${error.name === 'AbortError' ? 'The request timed out.' : 'Check the model, region and AWS access configuration.'}`, 502);
      }
    } else reply = GUIDED_HELP;
    this.suggestion = null; // An offer is only answerable on the very next turn.
    this.addMessage('assistant', reply);
    return { ...this.snapshot(reply), ...this.voiceResponse(reply, { language, action: parsed?.action, confirmationBlocked, confirmedKind }) };
  }
  async close() { await this.tools.close(); }
}
