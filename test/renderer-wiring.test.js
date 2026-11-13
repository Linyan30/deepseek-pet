'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const PAGES = [
  { html: 'pet.html', js: 'pet.js' },
  { html: 'chat.html', js: 'chat.js' },
  { html: 'settings.html', js: 'settings.js' }
];

test('每个页面引用的本地资源都存在', () => {
  PAGES.forEach(({ html }) => {
    const source = read(path.join(RENDERER, html));
    const refs = [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    refs
      .filter((ref) => !ref.startsWith('http') && !ref.startsWith('#') && !ref.startsWith('data:'))
      .forEach((ref) => {
        const target = path.resolve(RENDERER, ref);
        assert.ok(fs.existsSync(target), `${html} 引用的 ${ref} 不存在`);
      });
  });
});

test('脚本用到的 DOM id 都在 HTML 里定义了', () => {
  PAGES.forEach(({ html, js }) => {
    const page = read(path.join(RENDERER, html));
    const source = read(path.join(RENDERER, js));
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const used = new Set([...source.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]));
    used.forEach((id) => {
      assert.ok(ids.has(id), `${js} 里的 #${id} 在 ${html} 中不存在`);
    });
  });
});

test('渲染进程调用的 window.api 方法都在 preload 中暴露', () => {
  const preload = read(path.join(ROOT, 'preload.js'));
  const exposed = new Set(
    [...preload.matchAll(/^\s{2}([A-Za-z_]\w*):/gm)].map((match) => match[1])
  );
  assert.ok(exposed.has('getSettings'));
  assert.ok(exposed.has('sendChat'));

  PAGES.forEach(({ js }) => {
    const source = read(path.join(RENDERER, js));
    // 只看真正的方法调用，避免把 "https://api.deepseek.com" 这类字符串当成调用
    const used = new Set([...source.matchAll(/\bapi\.([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]));
    used.forEach((name) => {
      assert.ok(exposed.has(name), `${js} 调用了 preload 未暴露的 api.${name}`);
    });
  });
});

test('preload 暴露的方法在浏览器预览桩里也有', () => {
  const preload = read(path.join(ROOT, 'preload.js'));
  const preview = read(path.join(ROOT, 'src', 'shared', 'preview-api.js'));

  const exposed = new Set(
    [...preload.matchAll(/^\s{2}([A-Za-z_]\w*):/gm)].map((match) => match[1])
  );
  const stubbed = new Set(
    [...preview.matchAll(/^\s{2,8}([A-Za-z_]\w*):/gm)].map((match) => match[1])
  );

  exposed.forEach((name) => {
    assert.ok(stubbed.has(name), `预览桩缺少 ${name}，浏览器预览会报错`);
  });
});

test('所有 HTML 都设置了 CSP，且没有内联脚本', () => {
  PAGES.forEach(({ html }) => {
    const source = read(path.join(RENDERER, html));
    assert.match(source, /Content-Security-Policy/, `${html} 缺少 CSP`);
    assert.equal(/<script(?![^>]*\bsrc=)/.test(source), false, `${html} 不应该包含内联脚本`);
  });
});
