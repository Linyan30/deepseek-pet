'use strict';

/**
 * 语音朗读用的小工具：把 Markdown 回复整理成适合朗读的纯文本。
 * 既能在渲染进程当普通脚本加载（window.DSSpeech），也能被测试 require。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DSSpeech = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function prepareSpeechText(markdown, maxLength) {
    let text = String(markdown == null ? '' : markdown);

    text = text.replace(/```[\s\S]*?```/g, '，代码块已省略。');
    text = text.replace(/`([^`]*)`/g, '$1');
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/[*_~#>|]/g, '');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{2,}/g, '。');
    text = text.replace(/\n/g, '，');
    text = text.replace(/。{2,}/g, '。');
    text = text.replace(/\s+/g, ' ').trim();

    const max = Math.max(40, Number(maxLength) || 600);
    if (text.length > max) {
      const sliced = text.slice(0, max);
      const lastStop = Math.max(
        sliced.lastIndexOf('。'),
        sliced.lastIndexOf('！'),
        sliced.lastIndexOf('？'),
        sliced.lastIndexOf('，')
      );
      text = `${lastStop > max * 0.5 ? sliced.slice(0, lastStop + 1) : sliced}…`;
    }
    return text;
  }

  /** 优先挑中文嗓音，没有就返回 null 交给系统默认。 */
  function pickVoice(voices) {
    const list = Array.isArray(voices) ? voices : [];
    const chinese = list.find((voice) => /^zh([-_]|$)/i.test(String(voice.lang || '')));
    return chinese || null;
  }

  return { prepareSpeechText, pickVoice };
});
