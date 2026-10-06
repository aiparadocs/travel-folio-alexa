import fs from 'node:fs';
import path from 'node:path';

// Memories a person explicitly shares from the phone journal so the home
// screen can replay them. Only what is listed here is accepted: no private
// trip notes, packing list or planning notes ever reach the home.
export const MEMORY_LIMITS = Object.freeze({ items: 30, photo: 300000, caption: 600, title: 80, sticker: 20000, stickers: 3 });

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const isDataUrl = (value, type, max) => typeof value === 'string' && value.length <= max && new RegExp(`^data:image/${type};base64,[A-Za-z0-9+/]+={0,2}$`).test(value);

/** Validate and normalize a shared memory book; throws a user-facing Error. */
export function normalizeMemories(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items)) throw new Error('No memories were sent.');
  if (input.items.length > MEMORY_LIMITS.items) throw new Error(`Share up to ${MEMORY_LIMITS.items} memories at a time.`);
  const items = input.items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A memory could not be read.');
    if (item.photo != null && !isDataUrl(item.photo, 'jpeg', MEMORY_LIMITS.photo)) throw new Error('A photo is not in a supported format.');
    const stickers = Array.isArray(item.stickers) ? item.stickers.slice(0, MEMORY_LIMITS.stickers) : [];
    for (const sticker of stickers) if (!sticker || !isDataUrl(sticker.data, 'webp', MEMORY_LIMITS.sticker)) throw new Error('A sticker is not in a supported format.');
    const day = Number.isInteger(item.day) && item.day >= 1 && item.day <= 14 ? item.day : null;
    return {
      day,
      date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : null,
      time: /^\d{2}:\d{2}$/.test(item.time || '') ? item.time : null,
      title: text(item.title, MEMORY_LIMITS.title).trim() || 'A moment',
      caption: text(item.caption, MEMORY_LIMITS.caption),
      photo: item.photo || null,
      stickers: stickers.map((sticker) => ({ label: text(sticker.label, 40), data: sticker.data })),
    };
  }).filter((item) => item.photo || item.caption.trim() || item.stickers.length);
  if (!items.length) throw new Error('Add a photo, a few words or a sticker first.');
  return { title: text(input.title, 60).trim() || 'Our trip', place: text(input.place, 60), items, receivedAt: new Date().toISOString(), seen: false };
}

export class MemoryShelf {
  constructor({ file = null } = {}) {
    this.file = file;
    this.book = null;
    if (file && fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.book = { ...normalizeMemories(saved), receivedAt: saved.receivedAt, seen: saved.seen !== false };
      } catch { this.book = null; }
    }
  }
  get() { return this.book ? structuredClone(this.book) : null; }
  #save(book) {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(book));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  replace(input) {
    const book = normalizeMemories(input);
    this.#save(book);
    this.book = book;
    return { count: book.items.length };
  }
  /** The home has greeted the person about these memories. */
  markSeen() {
    if (!this.book || this.book.seen) return;
    this.book.seen = true;
    try { this.#save(this.book); } catch { /* the notice may repeat once; never block the greeting */ }
  }
}
