'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  levelInfo,
  createStateStore,
  sanitizeState,
  localDateKey,
  MAX_DAILY_GAIN,
  ACTIONS
} = require('../src/main/state');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-state-'));
  return path.join(dir, name || 'state.json');
}

test('等级阈值与进度计算正确', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(0).nextThreshold, 80);
  assert.equal(levelInfo(79).level, 1);
  assert.equal(levelInfo(80).level, 2);
  assert.equal(levelInfo(80).progress, 0);
  assert.equal(levelInfo(160).progress, 0.5);
  assert.equal(levelInfo(240).level, 3);
  assert.equal(levelInfo(1400).level, 6);
  assert.equal(levelInfo(1400).nextThreshold, null);
  assert.equal(levelInfo(1400).progress, 1);
  assert.equal(levelInfo(-10).level, 1);
  assert.equal(levelInfo('abc').affinity, 0);
});

test('互动会加分、计数并落盘', () => {
  const file = tmpFile();
  const clock = { now: new Date('2026-11-13T10:00:00') };
  const store = createStateStore(file, { now: () => clock.now });

  let result = store.add('pat');
  assert.equal(result.added, 1);
  assert.equal(result.affinity, 1);
  assert.equal(result.stats.pats, 1);
  assert.equal(result.reason, 'ok');

  // 1.2 秒内重复摸头只算一次
  result = store.add('pat');
  assert.equal(result.added, 0);
  assert.equal(result.reason, 'cooldown');

  clock.now = new Date(clock.now.getTime() + 2000);
  result = store.add('chat');
  assert.equal(result.added, 2);
  assert.equal(result.affinity, 3);
  assert.equal(result.stats.chats, 1);

  const reloaded = createStateStore(file, { now: () => clock.now });
  assert.equal(reloaded.snapshot().affinity, 3);
  assert.equal(reloaded.snapshot().stats.pats, 1);
});

test('单类互动和每日总上限都会生效', () => {
  const file = tmpFile();
  const clock = { now: new Date('2026-11-13T09:00:00') };
  const store = createStateStore(file, { now: () => clock.now });

  let total = 0;
  let hitCap = false;
  for (let index = 0; index < 40; index += 1) {
    clock.now = new Date(clock.now.getTime() + 3000);
    const result = store.add('chat');
    total += result.added;
    if (result.reason === 'cap' || result.reason === 'daily-cap') {
      hitCap = true;
      break;
    }
  }

  assert.equal(hitCap, true);
  assert.equal(total, MAX_DAILY_GAIN);
  assert.equal(store.snapshot().daily.counts.chat, ACTIONS.chat.dailyCap);
});

test('跨天会重置每日计数并累计陪伴天数', () => {
  const file = tmpFile();
  const clock = { now: new Date('2026-11-13T23:00:00') };
  const store = createStateStore(file, { now: () => clock.now });

  store.add('chat');
  const firstDay = store.snapshot();
  assert.equal(firstDay.stats.days, 1);
  assert.equal(firstDay.daily.gained, 2);

  clock.now = new Date('2026-11-14T00:05:00');
  const nextDay = store.add('chat');
  assert.equal(nextDay.daily.gained, 2);
  assert.equal(nextDay.daily.counts.chat, 1);
  assert.equal(nextDay.stats.days, 2);
  assert.equal(nextDay.stats.chats, 2);
});

test('升级时会返回 leveledUp 标记', () => {
  const file = tmpFile();
  const clock = { now: new Date('2026-11-13T09:00:00') };
  const store = createStateStore(file, { now: () => clock.now });
  store.update((state) => {
    state.affinity = 79;
  });

  const result = store.add('pat');
  assert.equal(result.added, 1);
  assert.equal(result.affinity, 80);
  assert.equal(result.leveledUp, true);
  assert.equal(result.level, 2);
});

test('损坏的状态文件不会导致崩溃', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ 坏掉的 JSON', 'utf8');
  const store = createStateStore(file);
  assert.equal(store.snapshot().affinity, 0);
  assert.equal(store.snapshot().level, 1);
});

test('sanitizeState 会丢弃非法值', () => {
  const state = sanitizeState({
    affinity: -100,
    stats: { pats: 'x', chats: 3 },
    daily: { date: 42, counts: { pat: -1 }, gained: 'x' },
    firstSeen: 123
  });
  assert.equal(state.affinity, 0);
  assert.equal(state.stats.pats, 0);
  assert.equal(state.stats.chats, 3);
  assert.equal(state.daily.date, '');
  assert.equal(state.daily.counts.pat, 0);
  assert.equal(state.daily.gained, 0);
  assert.equal(typeof state.firstSeen, 'string');
});

test('localDateKey 使用本地时区', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(localDateKey(new Date(2026, 10, 13)), '2026-11-13');
});
