const BASELINE = Object.freeze({ pleasure: 0.55, arousal: 0.45, dominance: 0.5 });
const POSITIVE = ['喜欢', '开心', '高兴', '舒服', '温柔', '想你', '爱你', '谢谢', '哈哈', '好耶', '期待', '安心'];
const NEGATIVE = ['讨厌', '烦', '难过', '生气', '委屈', '累', '哭', '滚', '无语', '失望', '焦虑', '害怕'];
const HIGH_AROUSAL = ['！', '!', '哈哈', '激动', '太棒', '气死', '烦死', '啊啊'];

function nowOf(ctx) {
  const value = Number(typeof ctx.now === 'function' ? ctx.now() : ctx.now);
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return value > 1e12 ? value : value * 1000;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function decay(state, now) {
  const hours = Math.max(0, (now - Number(state.updatedAt || now)) / 3600000);
  const factor = Math.pow(0.5, hours / 6);
  return {
    pleasure: BASELINE.pleasure + (Number(state.pleasure ?? BASELINE.pleasure) - BASELINE.pleasure) * factor,
    arousal: BASELINE.arousal + (Number(state.arousal ?? BASELINE.arousal) - BASELINE.arousal) * factor,
    dominance: BASELINE.dominance + (Number(state.dominance ?? BASELINE.dominance) - BASELINE.dominance) * factor,
    updatedAt: Number(state.updatedAt || now),
  };
}

async function load(ctx) {
  const saved = await ctx.storage.get('mood');
  return decay(saved && typeof saved === 'object' ? saved : { ...BASELINE, updatedAt: nowOf(ctx) }, nowOf(ctx));
}

function timeLabel(now) {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 9) return '清晨';
  if (hour >= 9 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '中午';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 22) return '晚上';
  if (hour >= 22 || hour < 2) return '深夜';
  return '凌晨';
}

function moodLabel(state) {
  if (state.pleasure >= 0.68) return state.arousal >= 0.6 ? '心情很好，有点兴奋' : '心情不错，比较放松';
  if (state.pleasure <= 0.35) return state.arousal >= 0.6 ? '有点烦躁' : '情绪偏低';
  return state.arousal >= 0.65 ? '比较有精神' : '比较平静';
}

function energyLabel(time) {
  return ['深夜', '凌晨'].includes(time) ? '精力偏低' : time === '清晨' ? '刚醒，精力一般' : '精力正常';
}

export async function moodContext(ctx) {
  if (ctx.config()?.enableMood === false) return '';
  const now = nowOf(ctx);
  const state = await load(ctx);
  const time = timeLabel(now);
  return `【当前状态｜${time}｜${moodLabel(state)}｜${energyLabel(time)}】这是你自己的状态，不是对方说的；只在自然时体现，不要每轮都报状态。`;
}

function sentiment(text) {
  let score = 0;
  for (const word of POSITIVE) if (text.includes(word)) score += 0.08;
  for (const word of NEGATIVE) if (text.includes(word)) score -= 0.1;
  for (const word of HIGH_AROUSAL) if (text.includes(word)) score += 0.03;
  if (/[？?]\s*$/.test(text)) score -= 0.01;
  if (text.length > 40) score += 0.01;
  return Math.max(-0.2, Math.min(0.2, score));
}

export async function updateMood(ctx) {
  if (ctx.config()?.enableMood === false) return;
  const now = nowOf(ctx);
  const state = await load(ctx);
  let text = '';
  try {
    const rows = await ctx.history.today({ limit: 6, maxChars: 1200 });
    if (Array.isArray(rows)) {
      text = rows.filter(row => !row.outgoing && row.text).slice(-2).map(row => String(row.text)).join('\n').slice(0, 1200);
    }
  } catch { text = ''; }
  if (!text && ctx.text) text = String(ctx.text).slice(0, 400);
  const delta = sentiment(text);
  const arousalDelta = (POSITIVE.some(word => text.includes(word)) || NEGATIVE.some(word => text.includes(word))) ? 0.02 : 0;
  const next = {
    pleasure: clamp(state.pleasure + delta),
    arousal: clamp(state.arousal + arousalDelta + (delta > 0 ? 0.015 : delta < 0 ? -0.01 : 0)),
    dominance: clamp(state.dominance + (delta > 0 ? 0.01 : delta < 0 ? -0.015 : 0)),
    updatedAt: now,
  };
  await ctx.storage.set('mood', next);
}
