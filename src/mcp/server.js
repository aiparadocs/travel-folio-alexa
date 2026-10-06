import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CITY_IDS, INTERESTS, PACES, getCity } from '../domain/catalog.js';
import { MAX_DAYS, createTrip, dayStops, summarizeTrip, toMin, todayIn, addDays } from '../domain/planner.js';
import { ADDABLE_KINDS, CHANGE_TYPES, computeChange } from '../domain/changes.js';
import { publicProposal } from '../domain/store.js';
import { assessRain, getDayForecast } from '../weather.js';
import { handoff } from '../handoff.js';
import { MCP_APP_MIME, TRIP_CARD_HTML, TRIP_CARD_META, TRIP_CARD_URI, withTripCard } from './apps.js';

export const SERVER_INFO = { name: 'travel-folio', title: 'Travel Folio', version: '0.1.0' };

const INSTRUCTIONS = `Travel Folio plans small trips and keeps them up to date by voice.
Workflow: create_trip -> get_itinerary / get_next_stop / check_weather -> propose_change -> apply_change.
Rules: never claim a change is made until apply_change returns status "applied". apply_change asks the
human to confirm (MCP elicitation) when the client supports it; otherwise only pass userConfirmed=true
after the user explicitly said yes to the exact summary. Opening hours, prices and bookings are NOT known:
tell people to check them. Keep spoken replies short.`;

function result(text, structured) {
  return {
    content: [{ type: 'text', text: structured ? `${text}\n\n${JSON.stringify(structured)}` : text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function toolError(err) {
  return { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] };
}

const safe = (fn) => async (args, extra) => {
  try {
    return await fn(args, extra);
  } catch (err) {
    return toolError(err);
  }
};

function supportsFormElicitation(server) {
  const caps = server.server.getClientCapabilities();
  const e = caps?.elicitation;
  if (!e) return false;
  return Boolean(e.form) || Object.keys(e).length === 0; // empty object == form (backwards compatible)
}

function currentDay(trip, now = new Date()) {
  const today = todayIn(trip.timezone, now);
  for (let d = 1; d <= trip.days; d++) if (addDays(trip.startDate, d - 1) === today) return d;
  return null;
}

/**
 * Build one MCP server instance (one per client session) bound to the shared store.
 * @param {{store: import('../domain/store.js').TripStore, publicBaseUrl: () => string, weatherMode?: string, fetchImpl?: Function}} deps
 */
export function createTravelFolioServer(deps) {
  const { store } = deps;
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { logging: {}, resources: { listChanged: true } },
  });

  // ---------------- tools ----------------
  server.registerTool('create_trip', {
    title: 'Create a trip',
    description: `Plan a new ${MAX_DAYS}-day-max trip from a curated list of real places. Replaces the current trip (the old one can be restored with undo_last_change). Cities: ${CITY_IDS.join(', ')}.`,
    inputSchema: {
      city: z.enum(CITY_IDS).describe('Destination city id'),
      days: z.number().int().min(1).max(MAX_DAYS).default(2).describe('Number of days'),
      pace: z.enum(PACES).default('balanced').describe('relaxed = fewer stops, packed = more'),
      interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]).describe('What the traveller enjoys'),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Defaults to tomorrow in the destination time zone.'),
    },
    annotations: { title: 'Create a trip', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: withTripCard,
  }, safe(async (args) => {
    const trip = store.setTrip(createTrip(args), 'Trip created');
    server.sendResourceListChanged();
    const s = summarizeTrip(trip);
    const counts = s.days.map((d) => `day ${d.day}: ${d.stops.length} stops`).join(', ');
    return result(`Created "${trip.title}" starting ${trip.startDate} (${counts}).`, { trip: s });
  }));

  server.registerTool('get_itinerary', {
    title: 'Get the itinerary',
    description: 'Read the current trip, optionally for a single day. Includes stopIds needed by other tools.',
    inputSchema: { day: z.number().int().min(1).max(MAX_DAYS).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: withTripCard,
  }, safe(async ({ day }) => {
    const trip = store.requireTrip();
    if (day != null && day > trip.days) throw new Error(`This trip has ${trip.days} day(s).`);
    return result(`Itinerary for "${trip.title}".`, { trip: summarizeTrip(trip, day ?? null) });
  }));

  server.registerTool('get_next_stop', {
    title: "What's next",
    description: 'The next unvisited stop. Uses the destination clock when the trip is in progress, otherwise the first unvisited stop.',
    inputSchema: { now: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Override the current local time (HH:MM), useful for demos'), day: z.number().int().min(1).max(MAX_DAYS).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ now, day }) => {
    const trip = store.requireTrip();
    const d = day ?? currentDay(trip) ?? 1;
    if (d > trip.days) throw new Error(`This trip has ${trip.days} day(s).`);
    const clock = now ?? (d === currentDay(trip) ? new Intl.DateTimeFormat('en-GB', { timeZone: trip.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) : '00:00');
    const minute = toMin(clock);
    const stops = dayStops(trip, d).filter((s) => !s.done);
    const next = stops.find((s) => toMin(s.time) + s.minutes > minute) || null;
    if (!next) return result(`Nothing left on day ${d}.`, { day: d, next: null });
    return result(`Next on day ${d}: ${next.title} at ${next.time}.`, { day: d, next: { stopId: next.id, time: next.time, title: next.title, kind: next.kind, note: next.note, minutes: next.minutes } });
  }));

  server.registerTool('check_weather', {
    title: 'Check weather risk',
    description: 'Hourly rain forecast for a trip day (Open-Meteo) and which outdoor or view stops are at risk. Use before suggesting a rain_swap.',
    inputSchema: { day: z.number().int().min(1).max(MAX_DAYS).default(1) },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: withTripCard,
  }, safe(async ({ day }) => {
    const trip = store.requireTrip();
    if (day > trip.days) throw new Error(`This trip has ${trip.days} day(s).`);
    const forecast = await getDayForecast(trip, day, { mode: deps.weatherMode, fetchImpl: deps.fetchImpl });
    if (forecast.source === 'unavailable') {
      return result(`No forecast available for ${forecast.date}: ${forecast.reason}`, { day, date: forecast.date, source: forecast.source, atRisk: [], rainyWindow: null, assessmentComplete: false, reason: forecast.reason });
    }
    const { atRisk, rainyWindow, unknownStops, assessmentComplete } = assessRain(trip, day, forecast);
    const text = atRisk.length
      ? `Rain likely ${rainyWindow ? `${rainyWindow.from}-${rainyWindow.to}` : ''} on day ${day}. ${atRisk.length} stop(s) at risk: ${atRisk.map((s) => s.title).join(', ')}.`
      : assessmentComplete ? `No significant rain is forecast for the planned outdoor stops on day ${day}.` : `The rain forecast is incomplete for day ${day}; some outdoor stops cannot be assessed.`;
    return result(`${text}${atRisk.length && !assessmentComplete ? ' Some outdoor stops also have missing forecast data.' : ''}`, {
      day, date: forecast.date, source: forecast.source, rainyWindow, atRisk, unknownStops, assessmentComplete,
      stops: summarizeTrip(trip, day).days[0].stops,
      hourly: forecast.hours.filter((h) => h.hour >= 7 && h.hour <= 21),
      attribution: forecast.source === 'open-meteo' ? 'Weather data by Open-Meteo.com (CC BY 4.0)' : 'Demo weather fixture (not a real forecast)',
    });
  }));

  server.registerTool('list_places', {
    title: 'List places',
    description: 'Browse the curated places for the trip city (or another city) to pick a specific placeId.',
    inputSchema: {
      city: z.enum(CITY_IDS).optional(),
      kind: z.enum(['walk', 'indoor', 'shop', 'food', 'coffee']).optional(),
      indoorOnly: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ city, kind, indoorOnly }) => {
    const cityId = city || store.getTrip()?.city;
    if (!cityId) throw new Error('Say which city.');
    const inTrip = new Set((store.getTrip()?.stops || []).map((s) => s.placeId));
    const places = getCity(cityId).places
      .filter((p) => (!kind || p.kind === kind) && (!indoorOnly || p.exposure === 'indoor'))
      .map((p) => ({ placeId: p.id, name: p.name, kind: p.kind, exposure: p.exposure, minutes: p.minutes, area: p.area, tags: p.tags, inTrip: inTrip.has(p.id) }));
    return result(`${places.length} place(s).`, { city: cityId, places });
  }));

  server.registerTool('propose_change', {
    title: 'Propose a change',
    description: `Preview a change WITHOUT applying it. Returns a proposalId, a spoken summary and a before/after diff.
Types: rain_swap{day[,from,to]} swaps weather-exposed stops for nearby indoor ones (uses the live forecast);
shift_day{day,minutes} moves the day later/earlier; add_stop{day,kind|placeId[,afterStopId]};
remove_stop{stopId}; replace_stop{stopId[,kind|placeId]}. Locked or visited stops are never changed.`,
    inputSchema: {
      type: z.enum(CHANGE_TYPES),
      day: z.number().int().min(1).max(MAX_DAYS).optional(),
      minutes: z.number().int().min(-240).max(240).optional(),
      stopId: z.string().max(40).optional(),
      afterStopId: z.string().max(40).optional(),
      kind: z.enum(ADDABLE_KINDS).optional(),
      placeId: z.string().max(60).optional(),
      from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: withTripCard,
  }, safe(async (change) => {
    const trip = store.requireTrip();
    const ctx = {};
    let weatherNote = null;
    if (change.type === 'rain_swap' && !(change.from && change.to)) {
      if (change.from || change.to) throw new Error('Provide both the start and end of the rain window.');
      const day = change.day ?? 1;
      const forecast = await getDayForecast(trip, day, { mode: deps.weatherMode, fetchImpl: deps.fetchImpl });
      if (forecast.source === 'unavailable') throw new Error(`The forecast is unavailable: ${forecast.reason} No changes were proposed. You can request indoor options for a specific time window.`);
      if (forecast.source !== 'unavailable') {
        const { atRisk, assessmentComplete } = assessRain(trip, day, forecast);
        if (!assessmentComplete) throw new Error('The forecast is incomplete. No automatic rain changes were proposed. Specify a time window for indoor options.');
        ctx.atRiskStopIds = atRisk.map((s) => s.stopId);
        weatherNote = `Based on ${forecast.source === 'demo' ? 'the demo weather fixture' : 'the Open-Meteo forecast'}.`;
      }
    }
    const { after, warnings } = computeChange(trip, change, ctx);
    const proposal = store.createProposal(change, after, warnings);
    const pub = publicProposal(proposal);
    return result(`Proposal ${pub.proposalId}: ${pub.summary}${weatherNote ? ` ${weatherNote}` : ''} Call apply_change to apply it.`, { proposal: pub });
  }));

  server.registerTool('apply_change', {
    title: 'Apply a proposed change',
    description: 'Apply a proposal from propose_change. The server asks the human to confirm via MCP elicitation when the client supports it. Without elicitation support, set userConfirmed=true ONLY after the user explicitly agreed to that exact summary.',
    inputSchema: {
      proposalId: z.string().max(40),
      userConfirmed: z.boolean().optional().describe('Only for clients without elicitation support'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: withTripCard,
  }, safe(async ({ proposalId, userConfirmed }, extra) => {
    const proposal = store.getProposal(proposalId);
    const pub = publicProposal(proposal);
    if (supportsFormElicitation(server)) {
      const answer = await server.server.elicitInput({
        mode: 'form',
        message: `${proposal.summary} Should I update your trip?`,
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: 'Apply this change', description: proposal.summary, default: true } },
          required: ['confirm'],
        },
        _meta: { 'travel-folio/proposal': pub },
      }, { relatedRequestId: extra?.requestId, timeout: 5 * 60 * 1000 });
      if (answer.action !== 'accept' || answer.content?.confirm !== true) {
        store.discardProposal(proposalId);
        return result('The user declined. Nothing was changed.', { status: 'declined', proposalId });
      }
    } else if (userConfirmed !== true) {
      return result('Not applied: this client cannot show a confirmation, so read the summary to the user and call again with userConfirmed=true only if they say yes.', { status: 'needs_confirmation', proposal: pub });
    }
    const { trip } = store.applyProposal(proposalId);
    return result(`Applied: ${proposal.summary}`, { status: 'applied', proposalId, diff: proposal.diff, trip: summarizeTrip(trip) });
  }));

  server.registerTool('undo_last_change', {
    title: 'Undo',
    description: 'Restore the trip as it was before the last applied change (or before the last create_trip).',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: withTripCard,
  }, safe(async () => {
    const { trip, diff } = store.undo();
    return result(`Undone. "${trip.title}" is back to the previous version.`, { status: 'undone', diff, trip: summarizeTrip(trip) });
  }));

  server.registerTool('mark_visited', {
    title: 'Mark a stop visited',
    description: 'Mark a stop as visited (or not). Visited stops are never moved by later changes.',
    inputSchema: { stopId: z.string().max(40), visited: z.boolean().default(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, safe(async ({ stopId, visited }) => {
    const trip = store.markVisited(stopId, visited);
    const s = trip.stops.find((x) => x.id === stopId);
    return result(`${s.title} marked ${visited ? 'visited' : 'not visited'}.`, { stopId, visited });
  }));

  server.registerTool('send_to_phone', {
    title: 'Send the plan to a phone',
    description: 'Create a link + QR code that opens the plan in the Travel Folio phone journal, where photos and memories stay on the phone. Show the QR on screen.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async () => {
    const trip = store.requireTrip();
    const h = await handoff(trip, deps.publicBaseUrl());
    const note = h.reachableFromPhone ? 'Scan the code on screen with your phone.' : 'The server is only listening on this computer, so a phone cannot open it. Restart with HOST=0.0.0.0 (same Wi-Fi) or set PUBLIC_BASE_URL.';
    return result(`Phone link ready. ${note}`, { url: h.url, qrSvg: h.qrSvg, reachableFromPhone: h.reachableFromPhone });
  }));

  // ---------------- resources ----------------
  server.registerResource('current-trip', 'trip://current', {
    title: 'Current trip',
    description: 'The full current itinerary as JSON.',
    mimeType: 'application/json',
  }, async (uri) => {
    const trip = store.getTrip();
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(trip ? summarizeTrip(trip) : null, null, 2) }] };
  });

  server.registerResource('trip-day', new ResourceTemplate('trip://current/day/{day}', {
    list: async () => {
      const trip = store.getTrip();
      if (!trip) return { resources: [] };
      return { resources: Array.from({ length: trip.days }, (_, i) => ({ uri: `trip://current/day/${i + 1}`, name: `Day ${i + 1}`, mimeType: 'application/json' })) };
    },
  }), { title: 'One day of the trip', mimeType: 'application/json' }, async (uri, { day }) => {
    const trip = store.requireTrip();
    if (!Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > trip.days) throw new Error(`This trip has ${trip.days} day(s).`);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summarizeTrip(trip, Number(day)), null, 2) }] };
  });

  server.registerResource('trip-card', TRIP_CARD_URI, {
    title: 'Trip card',
    description: 'MCP Apps view for itineraries, weather risk and proposed changes, sized for Echo Show.',
    mimeType: MCP_APP_MIME,
    _meta: TRIP_CARD_META,
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: TRIP_CARD_HTML, _meta: TRIP_CARD_META }] }));

  // ---------------- prompts ----------------
  server.registerPrompt('morning_briefing', {
    title: 'Morning briefing',
    description: 'A proactive start-of-day briefing: next stop, weather risk and an offer to fix it.',
    argsSchema: { day: z.string().regex(/^\d$/).optional() },
  }, ({ day }) => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: `Give me a short morning briefing for day ${day || 1} of my trip: call get_itinerary and check_weather for that day. If stops are at risk of rain, call propose_change with type rain_swap and then apply_change so I can confirm. Keep it to two sentences.` },
    }],
  }));

  // Forward store changes made by OTHER sessions as list_changed hints.
  const onChange = () => { try { server.sendResourceListChanged(); } catch { /* session closed */ } };
  store.on('changed', onChange);
  server.server.onclose = () => store.off('changed', onChange);

  return server;
}
