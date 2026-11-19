'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizePoint, pickTarget, createRoamController } = require('../src/main/roam');

function fakeWindow(bounds) {
  return {
    destroyed: false,
    visible: true,
    position: { x: bounds.x, y: bounds.y },
    bounds,
    isDestroyed() {
      return this.destroyed;
    },
    isVisible() {
      return this.visible;
    },
    getBounds() {
      return { ...this.bounds };
    },
    setPosition(x, y) {
      this.bounds.x = x;
      this.bounds.y = y;
    },
    isFocused() {
      return false;
    }
  };
}

test('normalizePoint 把鼠标换算成 -1 ~ 1', () => {
  const bounds = { x: 100, y: 100, width: 200, height: 200 };
  const center = normalizePoint(bounds, { x: 200, y: 210 });
  assert.ok(Math.abs(center.x) <= 0.05);
  assert.ok(Math.abs(center.y) <= 0.2);

  const right = normalizePoint(bounds, { x: 9999, y: 210 });
  assert.equal(right.x, 1);
  const left = normalizePoint(bounds, { x: -9999, y: 210 });
  assert.equal(left.x, -1);
});

test('pickTarget 永远落在工作区里', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const size = { width: 210, height: 290 };
  for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
    const target = pickTarget(area, size, 24, () => value);
    assert.ok(target.x >= 24 && target.x <= 1920 - 210 - 24, `x=${target.x}`);
    assert.ok(target.y >= 24 && target.y <= 1080 - 290 - 24, `y=${target.y}`);
  }
});

test('空闲够久会睡觉，有输入后醒来', () => {
  const pet = fakeWindow({ x: 100, y: 100, width: 200, height: 290 });
  let idle = 0;
  const sent = [];
  const controller = createRoamController({
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    powerMonitor: { getSystemIdleTime: () => idle },
    getPetWindow: () => pet,
    send: (channel, payload) => sent.push({ channel, payload }),
    getSettings: () => ({ roaming: false, followCursor: false }),
    random: () => 0,
    logger: { warn() {} }
  });

  idle = 200;
  controller.tick();
  assert.equal(controller.isSleeping(), true);
  assert.ok(sent.some((item) => item.channel === 'pet:sleep' && item.payload.asleep === true));

  idle = 0;
  controller.tick();
  assert.equal(controller.isSleeping(), false);
  assert.ok(sent.some((item) => item.channel === 'pet:sleep' && item.payload.asleep === false));
});

test('跟随鼠标会发送归一化坐标', () => {
  const pet = fakeWindow({ x: 0, y: 0, width: 200, height: 290 });
  const sent = [];
  const controller = createRoamController({
    screen: {
      getCursorScreenPoint: () => ({ x: 500, y: 500 }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    powerMonitor: { getSystemIdleTime: () => 0 },
    getPetWindow: () => pet,
    send: (channel, payload) => sent.push({ channel, payload }),
    getSettings: () => ({ roaming: false, followCursor: true }),
    random: () => 0
  });

  controller.tick();
  const cursor = sent.find((item) => item.channel === 'pet:cursor');
  assert.ok(cursor);
  assert.equal(cursor.payload.x, 1);
  assert.equal(cursor.payload.enabled, true);
});

test('关闭漫游时不会移动窗口', () => {
  const pet = fakeWindow({ x: 100, y: 100, width: 200, height: 290 });
  const controller = createRoamController({
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    powerMonitor: { getSystemIdleTime: () => 0 },
    getPetWindow: () => pet,
    send: () => {},
    getSettings: () => ({ roaming: false }),
    random: () => 0
  });

  controller.tick();
  assert.equal(pet.bounds.x, 100);
  assert.equal(pet.bounds.y, 100);
});
