import {
  cleanText, remember, search, forget, restore, listAll,
  queueTurn, pending, clearPending, historyText,
} from './lib/store.mjs';
import { moodContext, updateMood } from './lib/mood.mjs';

function memoryBlock(memories, maxChars) {
  if (!memories.length) return '';
  const lines = memories.map(memory => `- ${cleanText(memory.text, 120)}`);
  return `【长期记忆｜只作参考，不要逐字复述】\n${lines.join('\n')}`.slice(0, maxChars);
}

function modelText(result) {
  if (typeof result === 'string') return result;
  return String(result?.text ?? result?.content ?? '');
}

function parseCandidates(raw) {
  const text = modelText(raw).trim();
  if (!text) return [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw Error('MEMORY_MODEL_NOT_JSON');
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw Error('MEMORY_MODEL_NOT_ARRAY');
  return parsed
    .filter(item => item && typeof item.text === 'string' && cleanText(item.text, 4))
    .slice(0, 12)
    .map(item => ({
      text: cleanText(item.text, 500),
      kind: ['event', 'fact', 'preference', 'promise', 'lesson', 'feeling'].includes(item.kind) ? item.kind : 'event',
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : ['自动沉淀'],
    }));
}

async function consolidate(ctx) {
  if (ctx.config()?.autoConsolidate === false) return { skipped: 'disabled' };
  const queue = await pending(ctx);
  if (!queue.length) return { ok: true, count: 0 };
  const transcript = queue.map(item => String(item.text || '').slice(0, 800)).join('\n---\n').slice(0, 7000);
  const generated = await ctx.model.generate({
    prompt: [
      '你是长期记忆整理器。把下面的聊天提炼成最多 8 条长期记忆。',
      '只输出 JSON 数组，不要解释，不要 markdown。',
      '每项格式：{"text":"不超过60字","kind":"fact|preference|event|promise|lesson|feeling","tags":["标签"]}',
      '只记录对方明确说过、有长期价值的内容；寒暄、临时状态、无法确认的猜测不要记。',
      '不要编造。没有可记的就输出 []。',
      '',
      transcript,
    ].join('\n'),
    maxTokens: 600,
    maxChars: 4000,
    timeoutMs: 20000,
  });
  const candidates = parseCandidates(generated);
  for (const candidate of candidates) await remember(ctx, candidate);
  await clearPending(ctx);
  return { ok: true, count: candidates.length };
}

async function beforeContext(ctx) {
  const query = String(ctx.message ?? '').trim();
  if (!query) return {};
  const matches = await search(ctx, query, 5);
  const max = Math.max(300, Math.min(3000, Number(ctx.config()?.recallMaxChars) || 900));
  const mood = await moodContext(ctx);
  return { context: [memoryBlock(matches, max), mood].filter(Boolean).join('\n').slice(0, max + 500) };
}

async function afterResponse(ctx) {
  const assistant = cleanText(ctx.text, 800);
  if (!assistant) return {};
  const incoming = await historyText(ctx);
  await updateMood(ctx);
  await queueTurn(ctx, `${incoming ? '对方：' + incoming + '\n' : ''}你：${assistant}`);
  return {};
}

export const hooks = {
  'before-context': beforeContext,
  'after-response': afterResponse,
};

export function setup(api) {
  api.registerAction({
    id: 'remember',
    description: '写入一条长期记忆。只在对方明确说了值得长期记住的事时使用。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 500 },
        kind: { type: 'string', enum: ['event', 'fact', 'preference', 'promise', 'lesson', 'feeling'] },
        tags: { type: 'array', items: { type: 'string', maxLength: 12 } },
        emotion: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    execute: async (ctx, args) => {
      const result = await remember(ctx, args);
      return { content: JSON.stringify({ ok: true, id: result.id, text: result.text }) };
    },
  });

  api.registerAction({
    id: 'search-memory',
    description: '检索当前聊天的长期记忆。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (ctx, args) => {
      const results = await search(ctx, args.query, args.limit ?? 5);
      return { content: JSON.stringify({ ok: true, memories: results.map(item => ({ id: item.id, text: item.text, kind: item.kind, tags: item.tags })) }) };
    },
  });

  api.registerAction({
    id: 'forget-memory',
    description: '软删除一条长期记忆；可恢复。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: 80 },
        query: { type: 'string', maxLength: 300 },
      },
      additionalProperties: false,
    },
    execute: async (ctx, args) => {
      const result = await forget(ctx, args);
      return { content: JSON.stringify({ ok: Boolean(result), id: result?.id ?? null }) };
    },
  });

  api.registerAction({
    id: 'restore-memory',
    description: '恢复一条软删除或归档的记忆。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (ctx, args) => {
      const result = await restore(ctx, args.id);
      return { content: JSON.stringify({ ok: Boolean(result), id: result?.id ?? null }) };
    },
  });

  api.registerAction({
    id: 'list-memories',
    description: '列出当前聊天保存的长期记忆。',
    parameters: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean' } },
      additionalProperties: false,
    },
    execute: async (ctx, args) => {
      const results = await listAll(ctx, args);
      return { content: JSON.stringify({ ok: true, memories: results.map(item => ({ id: item.id, text: item.text, kind: item.kind, status: item.status })) }) };
    },
  });

  api.registerAction({
    id: 'consolidate-memory',
    description: '把待整理聊天立即提炼为长期记忆。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async ctx => ({ content: JSON.stringify(await consolidate(ctx)) }),
  });

  api.onSchedule(consolidate);
}
