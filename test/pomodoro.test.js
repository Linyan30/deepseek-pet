'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Pomodoro, PHASE, formatClock } = require('../src/main/pomodoro');

test('formatClock 一直是 mm:ss', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(5), '00:05');
  assert.equal(formatClock(59), '00:59');
  assert.equal(formatClock(60), '01:00');
  assert.equal(formatClock(1500), '25:00');
  assert.equal(formatClock(-10), '00:00');
  assert.equal(formatClock('abc'), '00:00');
  assert.equal(formatClock(3599.9), '59:59');
});

test('开始后进入 work 阶段并倒计时', () => {
  const ticks = [];
  const pomodoro = new Pomodoro({
    workMinutes: 25,
    breakMinutes: 5,
    onTick: (snapshot) => ticks.push(snapshot)
  });

  assert.equal(pomodoro.phase, PHASE.IDLE);
  const snapshot = pomodoro.start();
  assert.equal(snapshot.phase, PHASE.WORK);
  assert.equal(snapshot.running, true);
  assert.ok(snapshot.remaining <= 1500 && snapshot.remaining > 1490);
  assert.ok(ticks.length >= 1);

  pomodoro.dispose();
});

test('暂停后不会继续倒计时', async () => {
  const pomodoro = new Pomodoro({ workMinutes: 25, breakMinutes: 5 });
  pomodoro.start();
  const paused = pomodoro.pause();
  assert.equal(paused.running, false);
  const before = paused.remaining;
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(pomodoro.snapshot().remaining, before);
  pomodoro.dispose();
});

test('专注结束后自动进入休息，并回调 onPhaseEnd', async () => {
  const phases = [];
  const pomodoro = new Pomodoro({
    workMinutes: 1,
    breakMinutes: 1,
    onPhaseEnd: (phase) => phases.push(phase)
  });

  pomodoro.start();
  // 手动把截止时间提前，模拟 60 秒走完
  pomodoro.deadline = Date.now() + 100;
  pomodoro.remaining = 0.1;

  await new Promise((resolve) => setTimeout(resolve, 800));

  assert.deepEqual(phases, [PHASE.WORK]);
  const snapshot = pomodoro.snapshot();
  assert.equal(snapshot.phase, PHASE.BREAK);
  assert.equal(snapshot.running, true);
  pomodoro.dispose();
});

test('reset 会回到空闲状态', () => {
  const pomodoro = new Pomodoro({ workMinutes: 25, breakMinutes: 5 });
  pomodoro.start();
  const snapshot = pomodoro.reset();
  assert.equal(snapshot.phase, PHASE.IDLE);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.remaining, 1500);
  pomodoro.dispose();
});

test('切换时长会同步更新空闲时的显示', () => {
  const pomodoro = new Pomodoro({ workMinutes: 25, breakMinutes: 5 });
  pomodoro.setDurations(40, 8);
  const snapshot = pomodoro.snapshot();
  assert.equal(snapshot.remaining, 2400);
  assert.equal(snapshot.workMinutes, 40);
  assert.equal(snapshot.breakMinutes, 8);
  pomodoro.dispose();
});
