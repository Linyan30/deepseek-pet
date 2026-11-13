'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 亲密度等级表。分数只增不减，每天有获得上限，避免刷。
 */
const LEVELS = [
  { level: 1, name: '初次见面', threshold: 0 },
  { level: 2, name: '有点熟了', threshold: 80 },
  { level: 3, name: '好朋友', threshold: 240 },
  { level: 4, name: '超好的朋友', threshold: 520 },
  { level: 5, name: '形影不离', threshold: 900 },
  { level: 6, name: '命中注定', threshold: 1400 }
];

const ACTIONS = {
  pat: { points: 1, dailyCap: 20, cooldownMs: 1200, stat: 'pats' },
  chat: { points: 2, dailyCap: 30, cooldownMs: 0, stat: 'chats' },
  pomodoro: { points: 5, dailyCap: 20, cooldownMs: 0, stat: 'pomodoros' },
  greet: { points: 2, dailyCap: 2, cooldownMs: 0, stat: null }
};

const MAX_DAILY_GAIN = 60;
const MAX_AFFINITY = 1000000;

function localDateKey(date) {
  const d = date instanceof Date ? date : new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function levelInfo(affinity) {
  const points = Math.max(0, Math.min(MAX_AFFINITY, Math.floor(Number(affinity) || 0)));
  let current = LEVELS[0];
  for (const item of LEVELS) {
    if (points >= item.threshold) current = item;
  }
  const next = LEVELS.find((item) => item.threshold > points) || null;
  const span = next ? next.threshold - current.threshold : 0;
  return {
    affinity: points,
    level: current.level,
    name: current.name,
    floor: current.threshold,
    nextThreshold: next ? next.threshold : null,
    nextName: next ? next.name : null,
    toNext: next ? next.threshold - points : 0,
    progress: next ? Math.min(1, (points - current.threshold) / span) : 1
  };
}

function defaultState(now) {
  const stamp = (now || new Date()).toISOString();
  return {
    affinity: 0,
    stats: { pats: 0, chats: 0, pomodoros: 0, days: 0 },
    daily: { date: localDateKey(now), counts: {}, gained: 0 },
    firstSeen: stamp,
    updatedAt: stamp
  };
}

function sanitizeState(raw, now) {
  const base = defaultState(now);
  if (!raw || typeof raw !== 'object') return base;

  const state = base;
  state.affinity = Math.max(0, Math.min(MAX_AFFINITY, Math.floor(Number(raw.affinity) || 0)));

  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  state.stats = {
    pats: Math.max(0, Math.floor(Number(stats.pats) || 0)),
    chats: Math.max(0, Math.floor(Number(stats.chats) || 0)),
    pomodoros: Math.max(0, Math.floor(Number(stats.pomodoros) || 0)),
    days: Math.max(0, Math.floor(Number(stats.days) || 0))
  };

  const daily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
  const counts = {};
  if (daily.counts && typeof daily.counts === 'object') {
    Object.keys(ACTIONS).forEach((key) => {
      counts[key] = Math.max(0, Math.floor(Number(daily.counts[key]) || 0));
    });
  }
  state.daily = {
    date: typeof daily.date === 'string' ? daily.date : '',
    counts,
    gained: Math.max(0, Math.floor(Number(daily.gained) || 0))
  };

  if (typeof raw.firstSeen === 'string') state.firstSeen = raw.firstSeen;
  if (typeof raw.updatedAt === 'string') state.updatedAt = raw.updatedAt;
  return state;
}

/**
 * 亲密度仓库：负责读写 state.json、计算等级、处理每日上限。
 * filePath 和 now/random 都可注入，方便测试。
 */
function createStateStore(filePath, options) {
  const opts = options || {};
  const nowFn = typeof opts.now === 'function' ? opts.now : () => new Date();
  const randomFn = typeof opts.random === 'function' ? opts.random : Math.random;
  const logger = opts.logger || console;

  function readFromDisk() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return sanitizeState(raw, nowFn());
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        logger.warn('[state] 读取亲密度失败，使用初始值：', error.message);
      }
      return defaultState(nowFn());
    }
  }

  let state = readFromDisk();
  const lastActionAt = { pat: 0, chat: 0, pomodoro: 0, greet: 0 };

  function persist() {
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, payload, 'utf8');
      try {
        fs.renameSync(tmp, filePath);
      } catch (renameError) {
        // 某些环境（受限沙箱、杀软锁文件）不允许覆盖式 rename，退回直接写
        fs.writeFileSync(filePath, payload, 'utf8');
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* 临时文件可能已被清理 */
        }
      }
    } catch (error) {
      logger.warn('[state] 保存亲密度失败：', error.message);
    }
  }

  function ensureToday(now) {
    const key = localDateKey(now);
    if (state.daily.date === key) {
      if (state.stats.days === 0) state.stats.days = 1;
      return false;
    }
    state.daily = { date: key, counts: {}, gained: 0 };
    state.stats.days += 1;
    if (state.stats.days === 0) state.stats.days = 1;
    return true;
  }

  function snapshot() {
    const info = levelInfo(state.affinity);
    return {
      affinity: info.affinity,
      level: info.level,
      levelName: info.name,
      progress: info.progress,
      nextThreshold: info.nextThreshold,
      nextLevelName: info.nextName,
      toNext: info.toNext,
      stats: { ...state.stats },
      daily: {
        date: state.daily.date,
        gained: state.daily.gained,
        counts: { ...state.daily.counts }
      }
    };
  }

  function add(type) {
    const action = ACTIONS[type];
    if (!action) {
      return Object.assign(snapshot(), { added: 0, reason: 'unknown', leveledUp: false });
    }

    const now = nowFn();
    const nowMs = now.getTime();
    ensureToday(now);

    if (action.cooldownMs && nowMs - (lastActionAt[type] || 0) < action.cooldownMs) {
      return Object.assign(snapshot(), { added: 0, reason: 'cooldown', leveledUp: false });
    }

    const used = state.daily.counts[type] || 0;
    const dayLeft = MAX_DAILY_GAIN - state.daily.gained;
    if (used >= action.dailyCap) {
      return Object.assign(snapshot(), { added: 0, reason: 'cap', leveledUp: false });
    }
    if (dayLeft <= 0) {
      return Object.assign(snapshot(), { added: 0, reason: 'daily-cap', leveledUp: false });
    }

    const before = levelInfo(state.affinity);
    const added = Math.max(0, Math.min(action.points, dayLeft));

    state.affinity = Math.min(MAX_AFFINITY, state.affinity + added);
    state.daily.counts[type] = used + 1;
    state.daily.gained += added;
    if (action.stat) state.stats[action.stat] += 1;
    state.updatedAt = now.toISOString();
    lastActionAt[type] = nowMs;
    persist();

    const after = levelInfo(state.affinity);
    return Object.assign(snapshot(), {
      added,
      reason: added > 0 ? 'ok' : 'daily-cap',
      leveledUp: after.level > before.level,
      previousLevel: before.level
    });
  }

  /** 当天第一次互动时给一点“见面”分，返回是否真的加了。 */
  function greet() {
    return add('greet');
  }

  function update(mutator) {
    if (typeof mutator === 'function') mutator(state);
    state.updatedAt = nowFn().toISOString();
    persist();
    return snapshot();
  }

  return {
    add,
    greet,
    snapshot,
    update,
    random: randomFn,
    filePath
  };
}

module.exports = {
  LEVELS,
  ACTIONS,
  MAX_DAILY_GAIN,
  MAX_AFFINITY,
  levelInfo,
  localDateKey,
  defaultState,
  sanitizeState,
  createStateStore
};
