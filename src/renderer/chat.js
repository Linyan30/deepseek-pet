'use strict';

(function () {
  const api = window.api || window.createPreviewApi();
  const md = window.DSMarkdown || {
    renderMarkdownLite: (text) => String(text == null ? '' : text),
    escapeHtml: (text) => String(text == null ? '' : text)
  };
  const commandsApi = window.DSCommands || {
    COMMANDS: [],
    findCommand: () => null,
    buildPrompt: (_command, text) => String(text == null ? '' : text)
  };

  const els = {
    avatar: document.getElementById('avatar'),
    petName: document.getElementById('pet-name'),
    status: document.getElementById('status'),
    levelBadge: document.getElementById('level-badge'),
    messages: document.getElementById('messages'),
    welcome: document.getElementById('welcome'),
    chips: document.getElementById('chips'),
    banner: document.getElementById('banner'),
    bannerText: document.getElementById('banner-text'),
    bannerAction: document.getElementById('banner-action'),
    palette: document.getElementById('palette'),
    paletteList: document.getElementById('palette-list'),
    player: document.getElementById('player'),
    playerCover: document.getElementById('player-cover'),
    playerTitle: document.getElementById('player-title'),
    playerSub: document.getElementById('player-sub'),
    playerBar: document.getElementById('player-bar'),
    playerToggle: document.getElementById('player-toggle'),
    playerStop: document.getElementById('player-stop'),
    btnWeb: document.getElementById('btn-web'),
    btnImage: document.getElementById('btn-image'),
    imageInput: document.getElementById('image-input'),
    attach: document.getElementById('attach'),
    attachPreview: document.getElementById('attach-preview'),
    attachName: document.getElementById('attach-name'),
    attachRemove: document.getElementById('attach-remove'),
    card: document.querySelector('.card'),
    input: document.getElementById('input'),
    send: document.getElementById('send'),
    composer: document.getElementById('composer'),
    btnCommand: document.getElementById('btn-command'),
    btnNew: document.getElementById('btn-new'),
    btnSettings: document.getElementById('btn-settings'),
    btnClose: document.getElementById('btn-close')
  };

  let settings = { petName: '小深', hasApiKey: false, model: 'deepseek-chat' };
  let history = [];
  let streaming = false;
  let current = null;
  let rafId = 0;
  let bannerHandler = null;
  let affinityState = null;
  let paletteOpen = false;
  let paletteCommands = [];
  let paletteIndex = 0;
  let statusTimer = 0;
  let webEnabled = false;
  let currentTrack = null;
  let pendingImage = null;

  // ------------------------------------------------------------ 界面状态

  function setStatus(text, busy) {
    els.status.textContent = text;
    els.status.classList.toggle('busy', Boolean(busy));
  }

  function showBanner(text, actionLabel, handler) {
    els.bannerText.textContent = text;
    if (actionLabel && handler) {
      els.bannerAction.style.display = '';
      els.bannerAction.textContent = actionLabel;
      bannerHandler = handler;
    } else {
      els.bannerAction.style.display = 'none';
      bannerHandler = null;
    }
    els.banner.classList.remove('hidden');
  }

  function hideBanner() {
    els.banner.classList.add('hidden');
    bannerHandler = null;
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setStreamingUI(on) {
    els.send.textContent = on ? '■' : '➤';
    els.send.classList.toggle('stopping', on);
    els.send.title = on ? '停止生成' : '发送';
    els.send.setAttribute('aria-label', on ? '停止生成' : '发送');
  }

  function flashStatus(text) {
    setStatus(text);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (!streaming) setStatus(settings.hasApiKey ? '在线' : '未配置 API Key');
    }, 3200);
  }

  function updateLevelBadge(state, animate) {
    if (!state || !els.levelBadge) return;
    affinityState = state;
    els.levelBadge.textContent = `❤️ Lv.${state.level}`;
    const next = state.nextThreshold ? ` / ${state.nextThreshold}` : '';
    els.levelBadge.title = `亲密度 ${state.affinity}${next} · ${state.levelName || ''}`;
    if (animate) {
      els.levelBadge.classList.remove('level-up');
      void els.levelBadge.offsetWidth;
      els.levelBadge.classList.add('level-up');
    }
  }

  function appendSticker(payload) {
    if (!payload || !payload.id) return;
    const node = createMessageNode('assistant');
    node.wrap.classList.add('sticker-msg');
    node.text.remove();
    const image = document.createElement('img');
    image.className = 'sticker';
    image.src = `assets/stickers/${payload.id}.png`;
    image.alt = payload.caption || '表情包';
    image.title = payload.caption || '';
    image.addEventListener('load', scrollToBottom, { once: true });
    node.items.appendChild(image);
    els.welcome.classList.add('hidden');
    scrollToBottom();
    window.requestAnimationFrame(scrollToBottom);
  }

  function moveCaretToEnd() {
    const length = els.input.value.length;
    try {
      els.input.setSelectionRange(length, length);
    } catch {
      /* 忽略 */
    }
  }

  // ------------------------------------------------------------ 联网搜索

  function setWebEnabled(on) {
    webEnabled = Boolean(on);
    els.btnWeb.classList.toggle('active', webEnabled);
    els.btnWeb.title = webEnabled ? '联网搜索：开（下条消息会自动搜索）' : '联网搜索（开 / 关）';
    flashStatus(webEnabled ? '联网搜索已开启，下条消息会先搜索' : '联网搜索已关闭');
  }

  function appendSearchBlock(payload) {
    if (!payload) return;
    const node = createMessageNode('assistant');
    node.wrap.classList.add('search-msg');
    node.text.remove();

    const block = document.createElement('div');
    block.className = 'search-block';

    const head = document.createElement('div');
    head.className = 'search-head';
    const title = document.createElement('strong');
    const count = Array.isArray(payload.results) ? payload.results.length : 0;
    title.textContent = `🌐 ${count > 0 ? `联网搜索 · ${count} 条` : '联网搜索'}`;
    const meta = document.createElement('span');
    meta.textContent = [payload.provider, payload.query].filter(Boolean).join(' · ');
    head.append(title, meta);
    block.appendChild(head);

    if (payload.error) {
      const error = document.createElement('p');
      error.className = 'search-error';
      error.textContent = payload.error;
      block.appendChild(error);
    }

    if (count > 0) {
      const list = document.createElement('ol');
      list.className = 'search-list';
      payload.results.forEach((item) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.title;
        link.title = item.url;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          api.openExternal(item.url);
        });
        li.appendChild(link);
        if (item.snippet) {
          const snippet = document.createElement('p');
          snippet.className = 'search-snippet';
          snippet.textContent = item.snippet;
          li.appendChild(snippet);
        }
        list.appendChild(li);
      });
      block.appendChild(list);
    }

    if (payload.answer) {
      const answer = document.createElement('p');
      answer.className = 'search-answer';
      answer.textContent = payload.answer;
      block.appendChild(answer);
    }

    node.items.appendChild(block);

    // 搜索块要排在正在打字的回复前面
    if (streaming && current && current.node) {
      els.messages.insertBefore(node.wrap, current.node.wrap);
    }

    els.welcome.classList.add('hidden');
    scrollToBottom();
  }

  async function runWebSearch(query) {
    const text = String(query || '').trim();
    if (!text) {
      flashStatus('在 /搜索 后面加上关键词，例如 /搜索 今天的新闻');
      els.input.focus();
      return;
    }
    appendUserMessage(`/搜索 ${text}`);
    flashStatus('正在联网搜索…');
    try {
      const result = await api.searchWeb(text);
      appendSearchBlock(result);
      if (result && result.ok === false) flashStatus('搜索没成功，检查一下设置里的搜索服务');
    } catch {
      appendSearchBlock({ query: text, results: [], error: '搜索请求失败了，稍后再试。' });
    }
    els.input.focus();
  }

  // ------------------------------------------------------------ 音乐

  function appendMusicResults(payload) {
    const node = createMessageNode('assistant');
    node.text.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'music-list';

    const results = payload && Array.isArray(payload.results) ? payload.results : [];
    if (!payload || payload.ok === false || results.length === 0) {
      const error = document.createElement('p');
      error.className = 'search-error';
      error.textContent = (payload && payload.error) || '没有搜到歌曲，换个歌名试试？';
      wrapper.appendChild(error);
    } else {
      results.forEach((track) => {
        const card = document.createElement('div');
        card.className = 'music-card';

        const cover = document.createElement('img');
        cover.className = 'music-cover';
        cover.alt = '';
        if (track.cover) cover.src = track.cover;

        const info = document.createElement('div');
        info.className = 'music-info';
        const title = document.createElement('strong');
        title.textContent = track.title;
        const sub = document.createElement('span');
        sub.textContent = [track.artist, track.album].filter(Boolean).join(' · ') || '未知歌手';
        info.append(title, sub);

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'music-play';
        play.textContent = '▶';
        play.title = `试听 ${track.duration || 30} 秒`;
        play.addEventListener('click', () => playMusic(track, card));

        card.append(cover, info, play);
        wrapper.appendChild(card);
      });

      const source = document.createElement('div');
      source.className = 'music-source';
      source.textContent = `来源：${payload.source === 'itunes' ? 'iTunes' : 'Deezer'} · 在线试听为 30 秒预览`;
      wrapper.appendChild(source);
    }

    node.items.appendChild(wrapper);
    els.welcome.classList.add('hidden');
    scrollToBottom();
  }

  function playMusic(track, card) {
    if (!track || !track.preview) return;
    api.playMusic(track);
    document.querySelectorAll('.music-card.active').forEach((item) => item.classList.remove('active'));
    if (card) card.classList.add('active');
    flashStatus(`正在播放：${track.title}`);
  }

  async function runMusicSearch(query) {
    const text = String(query || '').trim();
    if (!text) {
      flashStatus('在 /点歌 后面加上歌名，例如 /点歌 晴天');
      els.input.focus();
      return;
    }
    appendUserMessage(`/点歌 ${text}`);
    flashStatus('正在搜歌…');
    try {
      const result = await api.searchMusic(text);
      appendMusicResults(result);
    } catch {
      appendMusicResults({ ok: false, error: '搜歌失败了，稍后再试。', results: [] });
    }
    els.input.focus();
  }

  function updatePlayer(state) {
    if (!state || state.stopped) {
      els.player.classList.add('hidden');
      currentTrack = null;
      return;
    }
    if (!state.track) return;

    currentTrack = state.track;
    els.player.classList.remove('hidden');
    els.playerTitle.textContent = state.track.title || '未命名';
    els.playerSub.textContent =
      [state.track.artist, state.track.album].filter(Boolean).join(' · ') || '未知歌手';

    if (state.track.cover) els.playerCover.src = state.track.cover;
    else els.playerCover.removeAttribute('src');

    const duration = Number(state.duration) || Number(state.track.duration) || 30;
    const current = Math.min(duration, Math.max(0, Number(state.currentTime) || 0));
    els.playerBar.style.width = `${Math.max(0, Math.min(100, (current / duration) * 100))}%`;
    els.playerToggle.textContent = state.playing ? '⏸' : '▶';
  }

  function setPaletteActive(index) {
    const items = els.paletteList.querySelectorAll('.palette-item');
    items.forEach((item, itemIndex) => {
      item.classList.toggle('active', itemIndex === index);
      if (itemIndex === index) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderPalette(filter) {
    const query = String(filter || '').trim().toLowerCase();
    paletteCommands = commandsApi.COMMANDS.filter((command) => {
      if (!query) return true;
      return `${command.label}${command.desc}${command.id}`.toLowerCase().includes(query);
    });

    els.paletteList.innerHTML = '';
    if (paletteCommands.length === 0) {
      closePalette();
      return;
    }

    paletteIndex = 0;
    paletteCommands.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `palette-item${index === 0 ? ' active' : ''}`;
      button.dataset.command = command.id;

      const icon = document.createElement('span');
      icon.className = 'palette-icon';
      icon.textContent = command.icon;

      const text = document.createElement('span');
      text.className = 'palette-text';
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = command.label;
      const desc = document.createElement('span');
      desc.className = 'palette-desc';
      desc.textContent = command.desc;
      text.appendChild(label);
      text.appendChild(desc);

      button.appendChild(icon);
      button.appendChild(text);
      button.addEventListener('click', () => chooseCommand(command));
      els.paletteList.appendChild(button);
    });

    els.palette.classList.remove('hidden');
    paletteOpen = true;
  }

  function openPalette(filter) {
    renderPalette(filter);
    if (paletteOpen) els.palette.classList.remove('hidden');
  }

  function closePalette() {
    paletteOpen = false;
    els.palette.classList.add('hidden');
  }

  function movePalette(step) {
    if (paletteCommands.length === 0) return;
    paletteIndex = (paletteIndex + step + paletteCommands.length) % paletteCommands.length;
    setPaletteActive(paletteIndex);
  }

  async function chooseCommand(command) {
    closePalette();
    els.input.value = '';
    autoResize();

    if (command.sticker) {
      api.requestSticker();
      els.input.focus();
      return;
    }

    if (command.search) {
      els.input.value = '/搜索 ';
      autoResize();
      els.input.focus();
      moveCaretToEnd();
      flashStatus('输入关键词后回车，我会去网上搜');
      return;
    }

    if (command.music) {
      els.input.value = '/点歌 ';
      autoResize();
      els.input.focus();
      moveCaretToEnd();
      flashStatus('输入歌名后回车，我找 30 秒试听给你');
      return;
    }

    let clipboardText = '';
    try {
      clipboardText = String((await api.readClipboard()) || '').trim();
    } catch {
      clipboardText = '';
    }

    const prompt = commandsApi.buildPrompt(command, clipboardText);
    els.input.value = prompt;
    autoResize();
    els.input.focus();
    moveCaretToEnd();

    if (clipboardText) {
      flashStatus(`已读取剪贴板（${clipboardText.length} 字），Enter 发送`);
    } else {
      flashStatus(`已插入「${command.label}」，把内容粘进来吧`);
    }
  }

  function findCommandByToken(token) {
    const value = String(token || '').toLowerCase();
    return commandsApi.COMMANDS.find(
      (command) =>
        command.id === value ||
        command.label === token ||
        command.label.toLowerCase().startsWith(value)
    );
  }

  // ------------------------------------------------------------ 消息渲染

  function avatarSource() {
    return settings.petStyle === 'whale' ? 'assets/avatar.svg' : 'assets/avatar-girl.png';
  }

  function createMessageNode(role) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;

    let items;
    if (role === 'assistant') {
      const avatar = document.createElement('img');
      avatar.className = 'who';
      avatar.src = avatarSource();
      avatar.alt = '';
      wrap.appendChild(avatar);

      items = document.createElement('div');
      items.className = 'msg-items';
      wrap.appendChild(items);
    } else {
      items = document.createElement('div');
      items.className = 'msg-items';
      wrap.appendChild(items);
    }

    const text = document.createElement('div');
    text.className = 'text';
    items.appendChild(text);

    els.messages.appendChild(wrap);
    scrollToBottom();

    return { wrap, items, text };
  }

  function appendMessage(role, content) {
    const node = createMessageNode(role);
    node.text.innerHTML = md.renderMarkdownLite(content);
    scrollToBottom();
    return node;
  }

  /** 用户输入按纯文本渲染，避免把用户打的星号、尖括号当成格式。 */
  function appendUserMessage(text, image) {
    const node = createMessageNode('user');
    if (image) {
      const picture = document.createElement('img');
      picture.className = 'msg-image';
      picture.src = image;
      picture.alt = '图片';
      node.items.insertBefore(picture, node.text);
    }
    node.text.textContent = text;
    scrollToBottom();
    return node;
  }

  // ------------------------------------------------------------ 图片附件

  function setPendingImage(data) {
    pendingImage = data;
    if (!data) {
      els.attach.classList.add('hidden');
      els.attachPreview.removeAttribute('src');
      els.attachName.textContent = '图片';
      return;
    }
    els.attachPreview.src = data.url;
    els.attachName.textContent = data.name || '图片';
    els.attach.classList.remove('hidden');
  }

  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('图片格式不支持'));
        image.onload = () => {
          const max = 1280;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const type = file.type === 'image/png' && scale === 1 ? 'image/png' : 'image/jpeg';
          resolve(canvas.toDataURL(type, 0.86));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    if (file.size > 12 * 1024 * 1024) {
      flashStatus('图片太大啦，换一张小于 12MB 的');
      return;
    }
    try {
      const url = await downscaleImage(file);
      setPendingImage({ url, name: file.name || '粘贴的图片' });
      flashStatus('图片已添加，发送后会交给视觉模型');
    } catch {
      flashStatus('这张图片读不出来，换一张试试');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* file:// 下可能没有 clipboard API，退回 execCommand */
    }
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      helper.style.pointerEvents = 'none';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      helper.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function addCopyButton(node) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = '复制';
    button.addEventListener('click', async () => {
      const ok = await copyText(node.text.innerText);
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => {
        button.textContent = '复制';
      }, 1400);
    });
    node.items.appendChild(button);
  }

  function addReasoning(node) {
    if (node.reason) return node.reason;
    const details = document.createElement('details');
    details.className = 'reason';
    const summary = document.createElement('summary');
    summary.textContent = '深度思考';
    const body = document.createElement('div');
    body.className = 'reason-body';
    details.appendChild(summary);
    details.appendChild(body);
    node.items.insertBefore(details, node.text);
    node.reason = details;
    node.reasonBody = body;
    return details;
  }

  function scheduleRender() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      if (!current) return;
      current.node.text.innerHTML = md.renderMarkdownLite(current.text);
      scrollToBottom();
    });
  }

  // ------------------------------------------------------------ 发送与流式接收

  function finish(payload) {
    if (!streaming) return;
    streaming = false;
    setStreamingUI(false);
    const offline = Boolean(payload && payload.offline);
    setStatus(offline ? '未配置 API Key' : '在线');

    if (!current) {
      els.input.focus();
      return;
    }

    const node = current.node;
    node.text.classList.remove('typing');
    const content = current.text.trim();

    if (content) {
      node.text.innerHTML = md.renderMarkdownLite(content);
      history.push({ role: 'assistant', content });
      if (history.length > 24) history = history.slice(-24);
      addCopyButton(node);
    } else {
      node.text.classList.add('error');
      node.text.textContent = '（这次没有收到内容，再试一次？）';
    }

    current = null;
    scrollToBottom();
    els.input.focus();
  }

  function send() {
    if (streaming) return;
    let text = els.input.value.trim();
    const image = pendingImage ? pendingImage.url : null;
    if (!text && !image) return;

    // 支持 /翻译 你好 这种斜杠指令；带图片时按普通消息发送
    if (!image) {
      const slash = text.match(/^\/([^\s]+)\s*([\s\S]*)$/);
      if (slash) {
        const command = findCommandByToken(slash[1]);
        if (command) {
          closePalette();
          if (command.sticker) {
            els.input.value = '';
            autoResize();
            api.requestSticker();
            return;
          }
          if (command.search) {
            els.input.value = '';
            autoResize();
            runWebSearch(slash[2].trim());
            return;
          }
          if (command.music) {
            els.input.value = '';
            autoResize();
            runMusicSearch(slash[2].trim());
            return;
          }
          const prompt = commandsApi.buildPrompt(command, slash[2].trim());
          els.input.value = prompt;
          autoResize();
          text = prompt;
        }
      }
    }

    const wantsSearch =
      !image && (webEnabled || /^(搜索|搜一下|查一下|帮我查|联网搜|搜下)/.test(text));

    closePalette();
    els.input.value = '';
    autoResize();
    hideBanner();
    els.welcome.classList.add('hidden');

    const displayText = text || '看看这张图片，帮我分析一下';
    appendUserMessage(displayText, image);
    const entry = { role: 'user', content: displayText };
    if (image) entry.image = image;
    history.push(entry);
    if (history.length > 20) history = history.slice(-20);
    setPendingImage(null);

    const node = createMessageNode('assistant');
    node.text.classList.add('typing');
    current = { node, text: '', reasoning: '' };

    streaming = true;
    setStreamingUI(true);
    setStatus(image ? '正在看图…' : wantsSearch ? '正在联网搜索…' : '正在思考…', true);

    api.sendChat({ messages: history.slice(), search: wantsSearch });
  }

  function abort() {
    if (!streaming) return;
    api.abortChat();
  }

  function resetConversation() {
    if (streaming) abort();
    closePalette();
    setPendingImage(null);
    history = [];
    current = null;
    streaming = false;
    setStreamingUI(false);
    setStatus(settings.hasApiKey ? '在线' : '未配置 API Key');

    els.messages.querySelectorAll('.msg').forEach((node) => node.remove());
    els.welcome.classList.remove('hidden');
    hideBanner();
    els.input.value = '';
    autoResize();
    els.input.focus();

    if (!settings.hasApiKey) {
      showBanner('还没配置 API Key，先去设置里填一下吧～', '去设置', () => api.openSettings());
    }
  }

  function autoResize() {
    els.input.style.height = 'auto';
    const next = Math.min(96, Math.max(34, els.input.scrollHeight));
    els.input.style.height = `${next}px`;
  }

  // ------------------------------------------------------------ 事件绑定

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (streaming) abort();
    else send();
  });

  els.send.addEventListener('click', (event) => {
    if (streaming) {
      event.preventDefault();
      abort();
    }
  });

  els.input.addEventListener('input', () => {
    autoResize();
    const value = els.input.value;
    if (value.startsWith('/') && !value.includes('\n')) {
      openPalette(value.slice(1).trim());
    } else if (paletteOpen) {
      closePalette();
    }
  });

  els.input.addEventListener('keydown', (event) => {
    if (paletteOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePalette(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePalette(-1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        const command = paletteCommands[paletteIndex];
        if (command) chooseCommand(command);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      window.api && window.api.windowAction('close');
    }
  });

  els.chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    els.input.value = button.dataset.prompt;
    autoResize();
    send();
  });

  els.bannerAction.addEventListener('click', () => {
    if (bannerHandler) bannerHandler();
  });

  els.btnNew.addEventListener('click', resetConversation);
  els.btnSettings.addEventListener('click', () => api.openSettings());
  els.btnClose.addEventListener('click', () => api.windowAction('close'));
  els.btnCommand.addEventListener('click', () => {
    if (paletteOpen) {
      closePalette();
    } else {
      openPalette('');
    }
    els.input.focus();
  });

  els.btnWeb.addEventListener('click', () => setWebEnabled(!webEnabled));

  els.btnImage.addEventListener('click', () => els.imageInput.click());

  els.imageInput.addEventListener('change', () => {
    const file = els.imageInput.files && els.imageInput.files[0];
    if (file) handleImageFile(file);
    els.imageInput.value = '';
  });

  els.attachRemove.addEventListener('click', () => setPendingImage(null));

  document.addEventListener('paste', (event) => {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        event.preventDefault();
        handleImageFile(item.getAsFile());
        break;
      }
    }
  });

  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    const hasFile = Array.from(event.dataTransfer.types || []).includes('Files');
    if (!hasFile) return;
    event.preventDefault();
    els.card.classList.add('dragover');
  });

  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) els.card.classList.remove('dragover');
  });

  document.addEventListener('drop', (event) => {
    els.card.classList.remove('dragover');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    handleImageFile(files[0]);
  });

  els.playerToggle.addEventListener('click', () => {
    api.musicCommand('toggle');
  });

  els.playerStop.addEventListener('click', () => {
    api.musicCommand('stop');
    els.player.classList.add('hidden');
  });

  // ------------------------------------------------------------ 主进程事件

  api.onChatDelta((payload) => {
    if (!streaming || !current || !payload) return;
    current.text += payload.delta || '';
    scheduleRender();
  });

  api.onChatReasoning((payload) => {
    if (!streaming || !current || !payload) return;
    addReasoning(current.node);
    current.reasoning += payload.delta || '';
    if (current.node.reasonBody) {
      current.node.reasonBody.textContent = current.reasoning;
    }
    scrollToBottom();
  });

  api.onChatDone((payload) => finish(payload));

  api.onChatError((payload) => {
    if (!streaming) return;
    streaming = false;
    setStreamingUI(false);
    setStatus('连接出错了');

    const message = (payload && payload.message) || '出了点小问题，再试一次？';
    if (current) {
      current.node.text.classList.remove('typing');
      if (!current.text.trim()) {
        current.node.text.classList.add('error');
        current.node.text.textContent = message;
      } else {
        const note = document.createElement('div');
        note.className = 'text error';
        note.textContent = message;
        current.node.items.appendChild(note);
      }
      current = null;
    }
    showBanner(message, '去设置', () => api.openSettings());
    els.input.focus();
  });

  api.onChatFocus(() => {
    els.input.focus();
  });

  api.onChatSticker((payload) => appendSticker(payload));

  api.onChatSearch((payload) => {
    if (payload) appendSearchBlock(payload);
  });

  api.onMusicState((state) => updatePlayer(state));

  api.onChatPrefill((payload) => {
    if (!payload || typeof payload.text !== 'string') return;
    els.welcome.classList.add('hidden');
    els.input.value = payload.text;
    autoResize();
    els.input.focus();
    moveCaretToEnd();
    flashStatus(
      payload.fromClipboard ? '已读取剪贴板内容，Enter 发送' : '快捷指令已填入，接着输入内容吧'
    );
  });

  api.onStateChanged((state) => {
    if (!state || !state.level) return;
    const previousLevel = affinityState ? affinityState.level : null;
    updateLevelBadge(state, previousLevel !== null && state.level > previousLevel);
  });

  api.onSettingsChanged((next) => {
    if (!next) return;
    settings = Object.assign({}, settings, next);
    applySettingsToUi();
  });

  function applySettingsToUi() {
    els.petName.textContent = settings.petName || '小深';
    if (els.avatar) {
      els.avatar.src = avatarSource();
    }
    document.title = `${settings.petName || '小鲸鱼'} · 聊天`;
    if (!streaming) {
      setStatus(settings.hasApiKey ? '在线' : '未配置 API Key');
    }
    if (settings.hasApiKey) {
      if (els.bannerText.textContent && els.bannerText.textContent.includes('API Key')) hideBanner();
    }
  }

  // ------------------------------------------------------------ 启动

  async function boot() {
    try {
      const loaded = await api.getSettings();
      if (loaded) settings = Object.assign(settings, loaded);
    } catch {
      /* 用默认值兜底 */
    }

    applySettingsToUi();

    try {
      updateLevelBadge(await api.getState());
    } catch {
      /* 预览或旧版本没有亲密度接口 */
    }

    if (!settings.hasApiKey) {
      showBanner('还没有配置 API Key，聊天的内容会用内置台词回复。', '去设置', () => api.openSettings());
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      settings.hasApiKey = true;
      applySettingsToUi();
      hideBanner();
      els.welcome.classList.add('hidden');
      appendMessage('user', '你好呀，小鲸鱼！');
      appendMessage(
        'assistant',
        '你好！我是**小深**，一只住在桌面上的 DeepSeek 小鲸鱼 🐳\n有什么可以帮你的吗？'
      );
      appendMessage('user', '帮我起一个读配置文件的小函数名');
      appendMessage(
        'assistant',
        '试试 **`loadConfig`**，简单直接；\n如果想强调“带默认值”，可以叫 **`loadConfigWithDefaults`**；\n函数式一点的话，**`readConfig`** 也很常见。'
      );
      appendSticker({ id: 'love', caption: '抱抱～' });
      els.messages.querySelectorAll('.msg.assistant').forEach((node) => {
        if (node.textContent) {
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'copy-btn';
          copy.textContent = '复制';
          node.querySelector('.msg-items').appendChild(copy);
        }
      });
      scrollToBottom();
    }

    if (params.get('demo') === 'music') {
      settings.hasApiKey = true;
      applySettingsToUi();
      hideBanner();
      els.welcome.classList.add('hidden');
      appendUserMessage('/点歌 晴天');
      const result = await api.searchMusic('晴天');
      appendMusicResults(result);
      if (result.results && result.results[0]) {
        playMusic(result.results[0]);
        updatePlayer({ playing: true, currentTime: 42, duration: 180, track: result.results[0] });
      }
      scrollToBottom();
    }

    if (params.get('demo') === 'image') {
      settings.hasApiKey = true;
      applySettingsToUi();
      hideBanner();
      els.welcome.classList.add('hidden');
      appendUserMessage('这张图里是什么？', 'assets/pet-girl.png');
      appendMessage(
        'assistant',
        '这是一张**鲸鱼娘**立绘：蓝色长发、女仆风头饰，抱着一台贴着小鲸鱼贴纸的笔记本。\n右侧面板里还能看到待发送的图片附件。'
      );
      setPendingImage({ url: 'assets/pet-girl.png', name: 'pet-girl.png' });
      scrollToBottom();
    }

    if (params.get('demo') === 'search') {
      settings.hasApiKey = true;
      applySettingsToUi();
      hideBanner();
      els.welcome.classList.add('hidden');
      appendUserMessage('/搜索 DeepSeek 最新模型');
      appendSearchBlock({
        query: 'DeepSeek 最新模型',
        provider: 'duckduckgo',
        results: [
          {
            title: 'DeepSeek 开放平台文档',
            url: 'https://api-docs.deepseek.com',
            snippet: 'DeepSeek API 支持 deepseek-chat 与 deepseek-reasoner 等模型，OpenAI 兼容。'
          },
          {
            title: 'DeepSeek 官网',
            url: 'https://www.deepseek.com',
            snippet: 'DeepSeek 官方站点，提供模型介绍与产品入口。'
          }
        ]
      });
      appendMessage(
        'assistant',
        '根据搜索结果，DeepSeek 目前常用的是 **deepseek-chat** 和 **deepseek-reasoner** 两个模型 [1]；\n前者适合日常对话，后者会先输出一段思考过程 [2]。'
      );
      scrollToBottom();
    }

    els.input.focus();
  }

  boot();
})();
