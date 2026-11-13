'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatClock, clamp, greeting } = require('../src/shared/format');
const { LINES, pick } = require('../src/shared/quips');

test('formatClock 与主进程实现一致', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock('bad'), '00:00');
});

test('clamp 处理非法输入', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp('x', 2, 10), 2);
});

test('greeting 按小时返回中文问候', () => {
  assert.equal(greeting(3), '夜深了');
  assert.equal(greeting(8), '早上好');
  assert.equal(greeting(12), '中午好');
  assert.equal(greeting(15), '下午好');
  assert.equal(greeting(21), '晚上好');
});

test('pick 在给定随机数下稳定返回', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(pick(list, () => 0), 'a');
  assert.equal(pick(list, () => 0.5), 'b');
  assert.equal(pick(list, () => 0.99), 'c');
  assert.equal(pick([], () => 0.5), '');
  assert.equal(pick(null, () => 0.5), '');
});

test('所有台词分组都有内容', () => {
  const groups = ['idle', 'click', 'happy', 'water', 'workStart', 'workEnd', 'breakEnd', 'offline', 'thinking'];
  groups.forEach((key) => {
    assert.ok(Array.isArray(LINES[key]), `${key} 应该是数组`);
    assert.ok(LINES[key].length > 0, `${key} 不应该为空`);
    LINES[key].forEach((line) => {
      assert.equal(typeof line, 'string');
      assert.ok(line.length <= 40, `${key} 里的台词太长：${line}`);
    });
  });
});
