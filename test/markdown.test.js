'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { escapeHtml, renderMarkdownLite } = require('../src/shared/markdown');

test('escapeHtml 转义五个危险字符', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('模型输出的 HTML 会被当成纯文本', () => {
  const html = renderMarkdownLite('<img src=x onerror="alert(1)">');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
});

test('加粗、行内代码、换行', () => {
  const html = renderMarkdownLite('这是**重点**，还有 `code`。\n第二行');
  assert.equal(html, '这是<strong>重点</strong>，还有 <code class="inline">code</code>。<br>第二行');
});

test('代码块里的内容不会被二次渲染，也保持转义', () => {
  const html = renderMarkdownLite('```js\nconst a = "<b>";\n```');
  assert.match(html, /<pre class="code" data-lang="js"><code>/);
  assert.match(html, /&quot;&lt;b&gt;&quot;/);
  assert.equal(html.includes('<b>'), false);
});

test('只给 http(s) 链接生成 a 标签', () => {
  const safe = renderMarkdownLite('[DeepSeek](https://www.deepseek.com)');
  assert.match(safe, /<a class="link" href="https:\/\/www\.deepseek\.com"/);

  const unsafe = renderMarkdownLite('[点我](javascript:alert(1))');
  assert.equal(unsafe.includes('<a'), false);
  assert.equal(unsafe.includes('javascript:'), true);
});

test('链接参数里的引号无法逃逸属性', () => {
  const html = renderMarkdownLite('[x](https://a.com/"onmouseover="alert(1))');
  assert.equal(html.includes('onmouseover="'), false);
});

test('无序列表用圆点替换，空输入返回空串', () => {
  assert.equal(renderMarkdownLite('- 一\n- 二'), '• 一<br>• 二');
  assert.equal(renderMarkdownLite(''), '');
  assert.equal(renderMarkdownLite(undefined), '');
});

test('多个代码块按顺序还原', () => {
  const html = renderMarkdownLite('A\n```\n1\n```\nB\n```\n2\n```');
  assert.ok(html.indexOf('>1<') < html.indexOf('>2<'));
  assert.equal((html.match(/<pre/g) || []).length, 2);
});
