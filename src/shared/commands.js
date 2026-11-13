'use strict';

/**
 * 快捷指令：聊天面板里的「指令中心」和右键菜单共用。
 * 既能在渲染进程当普通脚本加载（window.DSCommands），也能被主进程 require。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DSCommands = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COMMANDS = [
    {
      id: 'translate',
      icon: '🌐',
      label: '翻译',
      desc: '把剪贴板或输入的内容翻译成另一种语言',
      prompt: '把下面的内容翻译成自然流畅的中文；如果它本身就是中文，就翻译成英文：\n'
    },
    {
      id: 'summarize',
      icon: '📝',
      label: '总结',
      desc: '提炼要点，最多 5 条',
      prompt: '用不超过 5 条要点总结下面的内容，每条一句话：\n'
    },
    {
      id: 'polish',
      icon: '✨',
      label: '润色',
      desc: '让表达更自然、更通顺',
      prompt: '帮我润色下面的文字，保持原意，让表达更自然、更简洁：\n'
    },
    {
      id: 'weekly',
      icon: '📊',
      label: '周报',
      desc: '把零散记录整理成周报',
      prompt: '根据下面的零散记录，帮我写一份简洁的周报，分「本周完成 / 进行中 / 下周计划」三部分：\n'
    },
    {
      id: 'explain',
      icon: '🧩',
      label: '解释代码',
      desc: '说明代码作用并指出问题',
      prompt: '解释下面这段代码的作用，并指出可能的问题或可以改进的地方：\n'
    },
    {
      id: 'todo',
      icon: '✅',
      label: '拆任务',
      desc: '把目标拆成可执行步骤',
      prompt: '把下面这个目标拆成可执行的小步骤，按顺序列出，每一步尽量具体：\n'
    },
    {
      id: 'joke',
      icon: '😄',
      label: '讲笑话',
      desc: '来一个程序员冷笑话',
      prompt: '讲一个程序员能听懂的冷笑话，两句话以内。',
      instant: true
    },
    {
      id: 'websearch',
      icon: '🌐',
      label: '联网搜索',
      desc: '搜最新消息，结果直接列出来',
      prompt: '',
      search: true
    },
    {
      id: 'sticker',
      icon: '🐳',
      label: '发个表情',
      desc: '让小鲸鱼发一张表情包',
      sticker: true
    }
  ];

  function findCommand(id) {
    return COMMANDS.find((command) => command.id === id) || null;
  }

  function buildPrompt(command, content) {
    if (!command) return '';
    if (command.instant) return command.prompt;
    const text = String(content == null ? '' : content).trim();
    if (!command.prompt) return text;
    if (!text) return command.prompt;
    return `${command.prompt}${text}`;
  }

  return { COMMANDS, findCommand, buildPrompt };
});
