import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cloneTrip } from './planner.js';
import { diffTrips, speakDiff } from './changes.js';

const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const HISTORY_LIMIT = 20;

/**
 * Holds the household's current trip, proposals waiting for confirmation and
 * an undo history. Every MCP session (the Echo Show simulator, MCP Inspector,
 * any other MCP client) shares the same store, so all surfaces stay in sync.
 * Emits 'changed' with {trip, reason}.
 */
export class TripStore extends EventEmitter {
  constructor({ file = null } = {}) {
    super();
    this.file = file;
    this.trip = null;
    this.history = [];
    this.proposals = new Map();
    this.loadError = null;
    this.#load();
  }

  #load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const validTrip = (trip) => trip === null || (trip && typeof trip.id === 'string' && Number.isInteger(trip.version) && Array.isArray(trip.stops));
      if (!validTrip(data.trip) || !Array.isArray(data.history) || !data.history.every(validTrip)) throw new Error('Invalid saved trip data');
      this.trip = data.trip || null;
      this.history = Array.isArray(data.history) ? data.history.slice(-HISTORY_LIMIT) : [];
    } catch {
      // Keep the server readable, but never overwrite a damaged file with a
      // fresh trip. Recovery must be an explicit filesystem operation.
      this.loadError = 'The saved trip could not be read. Preserve or repair the state file before saving a new trip.';
      this.trip = null;
      this.history = [];
    }
  }

  #save(trip, history) {
    if (!this.file) return;
    if (this.loadError) throw new Error(this.loadError);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ trip, history }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  #commit(trip, history, reason, extra = {}) {
    // Persist the candidate first. An I/O failure must leave both the active
    // trip and its pending confirmation/undo state untouched.
    this.#save(trip, history);
    this.trip = trip;
    this.history = history;
    this.proposals.clear();
    this.emit('changed', { trip: this.trip ? cloneTrip(this.trip) : null, reason, ...extra });
  }

  getTrip() {
    return this.trip ? cloneTrip(this.trip) : null;
  }

  requireTrip() {
    if (!this.trip) throw new Error('There is no trip yet. Create one first with create_trip.');
    return this.getTrip();
  }

  setTrip(trip, reason = 'Trip created') {
    const history = this.trip ? [...this.history, cloneTrip(this.trip)].slice(-HISTORY_LIMIT) : this.history;
    this.#commit(cloneTrip(trip), history, reason);
    return this.getTrip();
  }

  createProposal(change, after, warnings = []) {
    const before = this.requireTrip();
    if (after.id !== before.id || after.version !== before.version) throw new Error('The trip changed while preparing this proposal. Try the request again.');
    const diff = diffTrips(before, after);
    if (!diff.length) throw new Error('That request would not change the trip.');
    const proposal = {
      proposalId: `p-${randomUUID().slice(0, 8)}`,
      tripId: before.id,
      baseVersion: before.version,
      change: structuredClone(change),
      diff,
      summary: speakDiff(diff),
      warnings: [...warnings],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
      after: cloneTrip(after),
    };
    this.#prune();
    this.proposals.set(proposal.proposalId, proposal);
    this.emit('proposed', { proposal: publicProposal(proposal) });
    return structuredClone(proposal);
  }

  getProposal(id) {
    this.#prune();
    const p = this.proposals.get(id);
    if (!p) throw new Error(`Proposal "${id}" was not found or has expired. Make a new proposal.`);
    if (!this.trip || p.tripId !== this.trip.id || p.baseVersion !== this.trip.version) {
      this.proposals.delete(id);
      throw new Error('The trip changed since this proposal was made, so it is stale. Make a new proposal.');
    }
    return structuredClone(p);
  }

  discardProposal(id) {
    this.proposals.delete(id);
  }

  applyProposal(id) {
    const p = this.getProposal(id);
    const history = [...this.history, cloneTrip(this.trip)].slice(-HISTORY_LIMIT);
    const next = cloneTrip(p.after);
    next.version = this.trip.version + 1;
    next.lastChange = { summary: p.summary, diff: p.diff, at: new Date().toISOString() };
    this.#commit(next, history, 'Change applied', { diff: p.diff });
    return { trip: this.getTrip(), proposal: p };
  }

  undo() {
    if (!this.history.length) throw new Error('There is nothing to undo.');
    const current = this.trip;
    const prev = this.history.at(-1);
    const restored = cloneTrip(prev);
    // Keep versions monotonic so old proposals can never be applied after an undo.
    restored.version = (current?.version || 0) + 1;
    restored.lastChange = null;
    const diff = current && current.id === restored.id ? diffTrips(current, restored) : [];
    this.#commit(restored, this.history.slice(0, -1), 'Undone', { diff });
    return { trip: this.getTrip(), diff };
  }

  markVisited(stopId, done = true) {
    const trip = this.requireTrip();
    const s = trip.stops.find((x) => x.id === stopId);
    if (!s) throw new Error(`No stop with id "${stopId}".`);
    if (s.done === done) return trip;
    s.done = done;
    trip.version += 1;
    const history = [...this.history, this.getTrip()].slice(-HISTORY_LIMIT);
    this.#commit(trip, history, done ? 'Marked visited' : 'Marked not visited');
    return this.getTrip();
  }

  #prune() {
    const now = Date.now();
    for (const [id, p] of this.proposals) if (Date.parse(p.expiresAt) <= now) this.proposals.delete(id);
  }
}

export function publicProposal(p) {
  const { after, ...rest } = p;
  return structuredClone(rest);
}
