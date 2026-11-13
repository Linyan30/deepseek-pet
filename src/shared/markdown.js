'use strict';

/**
 * 极简 Markdown 渲染（先转义，再替换），只支持聊天里最常用的几种语法：
 * 代码块、行内代码、加粗、http(s) 链接、无序列表、换行。
 * 因为先做了 HTML 转义，任何模型输出的原始标签都会被当成纯文本显示。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DSMarkdown = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
  }

  function renderMarkdownLite(text) {
    const source = String(text == null ? '' : text);
    if (!source) return '';

    const blocks = [];
    let output = escapeHtml(source);

    // 1. 代码块先抽出来，避免后续替换破坏里面的内容
    output = output.replace(/```([\w+#.-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const language = lang ? ` data-lang="${lang}"` : '';
      const index = blocks.push(`<pre class="code"${language}><code>${code.replace(/\n$/, '')}</code></pre>`) - 1;
      return `\u0000BLOCK${index}\u0000`;
    });

    // 2. 行内代码
    output = output.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');

    // 3. 加粗
    output = output.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

    // 4. 链接：只接受 http(s)，且 URL 里不允许出现引号和尖括号
    output = output.replace(
      /\[([^\]\n]+)\]\((https?:[^\s)"'<>]+)\)/g,
      '<a class="link" href="$2" rel="noreferrer noopener">$1</a>'
    );

    // 5. 无序列表
    output = output.replace(/^\s*[-*]\s+/gm, '• ');

    // 6. 换行
    output = output.replace(/\n/g, '<br>');

    // 7. 还原代码块
    output = output.replace(/\u0000BLOCK(\d+)\u0000/g, (_match, index) => blocks[Number(index)] || '');

    return output;
  }

  return { escapeHtml, renderMarkdownLite };
});
