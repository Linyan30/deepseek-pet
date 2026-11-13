'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { COMMANDS, findCommand, buildPrompt } = require('../src/shared/commands');
const {
  STICKERS,
  findSticker,
  availableStickers,
  randomSticker,
  matchSticker,
  maybeSticker
} = require('../src/shared/stickers');

test('快捷指令数据完整且 id 唯一', () => {
  assert.ok(COMMANDS.length >= 6);
  const ids = new Set();
  COMMANDS.forEach((command) => {
    assert.ok(!ids.has(command.id), `重复的指令 id: ${command.id}`);
    ids.add(command.id);
    assert.ok(command.label.length > 0);
    assert.ok(command.desc.length > 0);
    assert.ok(command.icon.length > 0);
    assert.ok(command.prompt || command.sticker || command.search || command.music);
  });
  assert.equal(findCommand('translate').id, 'translate');
  assert.equal(findCommand('missing'), null);
});

test('buildPrompt 能把内容拼到指令后面', () => {
  const command = findCommand('summarize');
  assert.equal(buildPrompt(null, 'x'), '');
  assert.equal(buildPrompt(command, ''), command.prompt);
  assert.equal(buildPrompt(command, '  你好  '), `${command.prompt}你好`);
  assert.equal(buildPrompt(findCommand('joke'), '忽略内容'), findCommand('joke').prompt);
});

test('表情包文件都存在，元数据合法', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'stickers');
  assert.ok(STICKERS.length >= 6);
  const ids = new Set();
  STICKERS.forEach((sticker) => {
    assert.ok(!ids.has(sticker.id), `重复的表情 id: ${sticker.id}`);
    ids.add(sticker.id);
    assert.ok(fs.existsSync(path.join(dir, sticker.file)), `${sticker.file} 不存在`);
    assert.ok(sticker.minLevel >= 1 && sticker.minLevel <= 6);
    assert.ok(sticker.caption.length > 0);
    assert.ok(sticker.keywords.length > 0);
  });
});

test('等级决定能解锁哪些表情', () => {
  const level1 = availableStickers(1);
  assert.ok(level1.length >= 2);
  assert.ok(level1.every((sticker) => sticker.minLevel === 1));
  assert.equal(availableStickers(6).length, STICKERS.length);
  assert.equal(findSticker('happy').id, 'happy');
  assert.equal(findSticker('nope'), null);
});

test('关键字匹配与发送概率', () => {
  assert.equal(matchSticker('谢谢你帮我', 1).id, 'thanks');
  assert.equal(matchSticker('晚安啦', 2).id, 'sleepy');
  assert.equal(matchSticker('随便说点什么', 6), null);

  // 随机数固定，结果可预测
  assert.equal(maybeSticker('谢谢你', 1, () => 0.1).id, 'thanks');
  assert.equal(maybeSticker('随便', 1, () => 0.99), null);
  assert.equal(randomSticker(6, () => 0).id, STICKERS[0].id);
  assert.equal(randomSticker(1, () => 0.99).minLevel, 1);
});
