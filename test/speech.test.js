'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { prepareSpeechText, pickVoice } = require('../src/shared/speech');

test('朗读文本会去掉 Markdown 标记', () => {
  const text = prepareSpeechText('这是**重点**，还有 `code` 和 [链接](https://example.com)。');
  assert.equal(text, '这是重点，还有 code 和 链接。');
});

test('代码块会被替换成提示，而不是被念出来', () => {
  const text = prepareSpeechText('看这段：\n```js\nconst a = 1;\n```\n就是这样。');
  assert.match(text, /代码块已省略/);
  assert.equal(text.includes('const a'), false);
});

test('换行会变成停顿，多余空白会合并', () => {
  const text = prepareSpeechText('第一行\n第二行\n\n\n第三行');
  assert.equal(text, '第一行，第二行。第三行');
});

test('过长的文本会截断并加省略号', () => {
  const text = prepareSpeechText('啊'.repeat(1000), 100);
  assert.ok(text.length <= 101);
  assert.match(text, /…$/);
});

test('空输入返回空字符串', () => {
  assert.equal(prepareSpeechText(''), '');
  assert.equal(prepareSpeechText(null), '');
});

test('pickVoice 优先选中文嗓音', () => {
  const voices = [
    { name: 'English', lang: 'en-US' },
    { name: 'Microsoft Xiaoxiao', lang: 'zh-CN' }
  ];
  assert.equal(pickVoice(voices).name, 'Microsoft Xiaoxiao');
  assert.equal(pickVoice([{ name: 'A', lang: 'en-US' }]), null);
  assert.equal(pickVoice(null), null);
});
