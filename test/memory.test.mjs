import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, hooks } from '../index.mjs';

function context(overrides = {}) {
  const documents = new Map();
  const storage = new Map();
  const actions = new Map();
  const state = {
    documents: {
      get: async id => documents.get(id) ?? null,
      put: async (id, value) => { documents.set(id, structuredClone(value)); },
    },
    storage: {
      get: async key => storage.get(key) ?? null,
      set: async (key, value) => { storage.set(key, structuredClone(value)); },
      delete: async key => { storage.delete(key); },
    },
    config: () => ({
      recallMaxChars: 900,
      maxMemories: 400,
      autoConsolidate: true,
      consolidateAt: '23:50',
      enableMood: true,
    }),
    history: { today: async () => [] },
    model: { generate: async () => '[]' },
    chat: { key: 'wechat:private:test' },
    ...overrides,
  };
  return { state, documents, storage, actions };
}

function bind() {
  const actions = new Map();
  let schedule = null;
  setup({
    registerAction(def) { actions.set(def.id, def); },
    onSchedule(fn) { schedule = fn; },
  });
  return { actions, schedule: () => schedule };
}

test('remember and recall', async () => {
  const { state, documents } = context();
  const { actions } = bind();
  const result = await actions.get('remember').execute(state, {
    text: '对方喜欢海边，讨厌吵闹的地方。',
    kind: 'preference',
    tags: ['偏好'],
  });
  assert.equal(JSON.parse(result.content).ok, true);
  assert.equal((await documents.get('memories')).length, 1);

  const recalled = await hooks['before-context']({ ...state, message: '周末去海边吗？' });
  assert.match(recalled.context, /海边/);
});

test('soft delete and restore', async () => {
  const { state } = context();
  const { actions } = bind();
  const created = JSON.parse((await actions.get('remember').execute(state, { text: '对方生日是五月一日。' })).content);
  await actions.get('forget-memory').execute(state, { id: created.id });
  assert.equal((await actions.get('list-memories').execute(state, {})).content.includes('生日'), false);
  await actions.get('restore-memory').execute(state, { id: created.id });
  assert.equal((await actions.get('list-memories').execute(state, {})).content.includes('生日'), true);
});

test('after-response queues and schedule consolidates', async () => {
  const { state, storage } = context({
    history: { today: async () => [{ outgoing: false, text: '我喜欢下雨天' }] },
    model: { generate: async () => '[{"text":"对方喜欢下雨天","kind":"preference","tags":["天气"]}]' },
  });
  const { schedule } = bind();
  await hooks['after-response']({ ...state, text: '记住了' });
  assert.equal((await storage.get('pending')).length, 1);
  const result = await schedule()(state);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal((await storage.get('pending')), undefined);
});

test('mood state is injected and updated', async () => {
  const { state, storage } = context({
    history: { today: async () => [{ outgoing: false, text: '今天真的好开心，谢谢你' }] },
  });
  const before = await hooks['before-context']({ ...state, message: '在吗' });
  assert.match(before.context, /当前状态/);
  await hooks['after-response']({ ...state, text: '我也开心' });
  const mood = await storage.get('mood');
  assert.equal(typeof mood.pleasure, 'number');
  assert.ok(mood.pleasure > 0.55);
});
