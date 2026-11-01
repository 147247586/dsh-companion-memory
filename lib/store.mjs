import crypto from 'node:crypto';

const DOC = 'memories';
const QUEUE = 'pending';
const KINDS = new Set(['event', 'fact', 'preference', 'promise', 'lesson', 'feeling']);
const KIND_BASE = { fact: 3, promise: 3, lesson: 2.8, preference: 2.5, event: 2, feeling: 1.8 };

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function tokens(value) {
  const text = String(value ?? '').toLowerCase();
  const set = new Set();
  for (const word of text.replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/)) {
    if (word.length >= 2) set.add(word);
  }
  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) set.add(run);
    for (let index = 0; index < run.length - 1; index++) set.add(run.slice(index, index + 2));
  }
  return set;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / Math.sqrt(a.size * b.size);
}

export function load(ctx) {
  return ctx.documents.get(DOC).then(value => Array.isArray(value) ? value : []);
}

function cap(list, max) {
  const active = list.filter(item => item.status !== 'deleted');
  if (active.length <= max) return list;
  const overflow = active
    .slice()
    .sort((a, b) => Number(a.lastAccess || 0) - Number(b.lastAccess || 0))
    .slice(0, active.length - max);
  const ids = new Set(overflow.map(item => item.id));
  return list.map(item => ids.has(item.id) ? { ...item, status: 'archived' } : item);
}

export async function save(ctx, list) {
  const max = Math.max(50, Math.min(1000, Number(ctx.config()?.maxMemories) || 400));
  const next = cap(list, max);
  let json = JSON.stringify(next);
  if (Buffer.byteLength(json) > 1050000) {
    const keep = next
      .filter(item => item.status !== 'deleted')
      .sort((a, b) => Number(b.lastAccess || 0) - Number(a.lastAccess || 0))
      .slice(0, Math.floor(next.length * 0.75));
    json = JSON.stringify(keep);
  }
  await ctx.documents.put(DOC, JSON.parse(json));
}

export async function remember(ctx, { text, kind = 'event', tags = [], emotion = 0.5 } = {}) {
  const value = cleanText(text, 500);
  if (!value) throw Error('MEMORY_TEXT_REQUIRED');
  const type = KINDS.has(kind) ? kind : 'event';
  const mood = Math.max(0, Math.min(1, Number(emotion) || 0.5));
  const now = Date.now() / 1000;
  const list = await load(ctx);
  const incoming = tokens(value);
  const existing = list.find(item => item.status !== 'deleted' && overlap(incoming, tokens(item.text)) >= 0.65);
  if (existing) {
    const mergedText = value.length > String(existing.text).length ? value : existing.text;
    Object.assign(existing, {
      text: mergedText,
      tags: [...new Set([...(existing.tags ?? []), ...(Array.isArray(tags) ? tags : [])])].slice(0, 4),
      base: Math.max(Number(existing.base) || 0, (KIND_BASE[type] ?? 2) + mood * 0.5),
      emotion: Math.max(Number(existing.emotion) || 0, mood),
      lastAccess: now,
      status: 'active',
    });
    await save(ctx, list);
    return existing;
  }
  const memory = {
    id: crypto.randomUUID(),
    text: value,
    kind: type,
    tags: [...new Set((Array.isArray(tags) ? tags : []).map(tag => cleanText(tag, 12)).filter(Boolean))].slice(0, 4),
    base: (KIND_BASE[type] ?? 2) + mood * 0.5,
    emotion: mood,
    createdAt: now,
    lastAccess: now,
    status: 'active',
  };
  list.push(memory);
  await save(ctx, list);
  return memory;
}

export function rank(list, query, limit = 5, now = Date.now() / 1000) {
  const queryTokens = tokens(query);
  if (!queryTokens.size) return [];
  return list
    .filter(item => item.status !== 'deleted' && item.status !== 'archived')
    .map(item => {
      const related = overlap(queryTokens, tokens(item.text));
      const ageDays = Math.max(0, (now - Number(item.lastAccess || item.createdAt || now)) / 86400);
      const recency = Math.exp(-ageDays / 30);
      const importance = Math.max(0, Math.min(1, ((Number(item.base) || 2) + (Number(item.emotion) || 0) * 0.5) / 5.5));
      return { item, related, score: related * 0.7 + importance * 0.18 + recency * 0.12 };
    })
    .filter(entry => entry.related > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

export async function search(ctx, query, limit = 5) {
  return rank(await load(ctx), query, limit);
}

export async function forget(ctx, { id, query } = {}) {
  const list = await load(ctx);
  let target = id ? list.find(item => item.id === id) : null;
  if (!target && query) target = rank(list, query, 1)[0];
  if (!target) return null;
  target.status = 'deleted';
  target.deletedAt = Date.now() / 1000;
  await save(ctx, list);
  return target;
}

export async function restore(ctx, id) {
  const list = await load(ctx);
  const target = list.find(item => item.id === id);
  if (!target) return null;
  target.status = 'active';
  target.deletedAt = null;
  target.lastAccess = Date.now() / 1000;
  await save(ctx, list);
  return target;
}

export async function listAll(ctx, { includeArchived = false } = {}) {
  const list = await load(ctx);
  return list
    .filter(item => item.status !== 'deleted' && (includeArchived || item.status !== 'archived'))
    .sort((a, b) => Number(b.lastAccess || 0) - Number(a.lastAccess || 0));
}

export async function queueTurn(ctx, text) {
  const previous = await ctx.storage.get(QUEUE);
  const queue = Array.isArray(previous) ? previous : [];
  const now = Date.now() / 1000;
  queue.push({ at: now, text: cleanText(text, 1200) });
  while (queue.length > 20) queue.shift();
  await ctx.storage.set(QUEUE, queue);
}

export async function pending(ctx) {
  const queue = await ctx.storage.get(QUEUE);
  return Array.isArray(queue) ? queue : [];
}

export async function clearPending(ctx) {
  await ctx.storage.delete(QUEUE);
}

export async function historyText(ctx) {
  try {
    const rows = await ctx.history.today({ limit: 6, maxChars: 1600 });
    if (!Array.isArray(rows)) return '';
    const incoming = rows.filter(row => !row.outgoing && row.text);
    return incoming.slice(-2).map(row => String(row.text).slice(0, 300)).join('\n');
  } catch {
    return '';
  }
}
