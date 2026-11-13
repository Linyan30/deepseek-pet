'use strict';

(function () {
  const api = window.api || window.createPreviewApi();
  const format = window.DSFormat;

  const els = {
    stage: document.getElementById('stage'),
    pet: document.getElementById('pet'),
    girl: document.getElementById('girl'),
    whale: document.getElementById('whale'),
    pupils: document.getElementById('pupils'),
    bubble: document.getElementById('bubble'),
    bubbleText: document.getElementById('bubble-text'),
    badge: document.getElementById('badge'),
    badgeIcon: document.getElementById('badge-icon'),
    badgeText: document.getElementById('badge-text'),
    sticker: document.getElementById('pet-sticker'),
    musicDot: document.getElementById('music-dot'),
    audio: document.getElementById('audio'),
    hearts: document.getElementById('hearts')
  };

  let settings = { petName: '小深', petStyle: 'girl', scale: 1 };
  let lines = null;
  let bubbleTimer = 0;
  let moodTimer = 0;
  let stickerTimer = 0;
  let dragging = false;
  let movedWhileDragging = false;
  let lastPointer = { x: 0, y: 0 };
  let pressAt = 0;
  let clickTimer = 0;
  let ignoreMouse = true;

  function pick(list) {
    if (!Array.isArray(list) || list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)];
  }

  function setMood(mood, duration) {
    els.stage.dataset.mood = mood;
    els.whale.dataset.mood = mood;
    clearTimeout(moodTimer);
    if (duration) {
      moodTimer = window.setTimeout(() => {
        els.stage.dataset.mood = 'idle';
        els.whale.dataset.mood = 'idle';
      }, duration);
    }
  }

  function applyStyle(style) {
    const value = style === 'whale' ? 'whale' : 'girl';
    els.stage.dataset.style = value;
    return value;
  }

  function hideBubble() {
    els.bubble.classList.remove('show');
    els.bubble.setAttribute('aria-hidden', 'true');
  }

  function showBubble(text, options) {
    if (!text) return;
    const opts = options || {};
    const mood = opts.mood || 'happy';
    const duration = Math.max(1200, opts.duration || 4200);

    els.bubbleText.textContent = text;
    els.bubble.classList.add('show');
    els.bubble.setAttribute('aria-hidden', 'false');
    setMood(mood, Math.min(duration, 6000));

    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(hideBubble, duration);
  }

  function spawnHearts(count) {
    const total = count || 5;
    for (let index = 0; index < total; index += 1) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.textContent = Math.random() > 0.35 ? '💙' : '💗';
      heart.style.left = `${30 + Math.random() * 40}%`;
      heart.style.animationDelay = `${Math.random() * 0.25}s`;
      heart.style.fontSize = `${11 + Math.random() * 7}px`;
      els.hearts.appendChild(heart);
      heart.addEventListener('animationend', () => heart.remove());
    }
  }

  function pat() {
    const line = pick(lines && lines.click) || '咕噜咕噜～';
    showBubble(line, { mood: 'love', duration: 2600 });
    spawnHearts(5);
    api.reportPat();
  }

  function showSticker(payload) {
    if (!payload || !payload.id || !els.sticker) return;
    window.clearTimeout(stickerTimer);
    els.sticker.src = `assets/stickers/${payload.id}.png`;
    els.sticker.alt = payload.caption || '表情包';
    els.sticker.classList.add('show');
    stickerTimer = window.setTimeout(
      () => els.sticker.classList.remove('show'),
      Math.max(1200, payload.duration || 2600)
    );
  }

  // ------------------------------------------------------------ 音乐

  const music = { track: null, lastSentAt: 0 };

  function setMusicDot(on) {
    if (els.musicDot) els.musicDot.classList.toggle('hidden', !on);
  }

  function sendMusicState(extra) {
    if (!els.audio || !api.musicState) return;
    const payload = Object.assign(
      {
        playing: !els.audio.paused && !els.audio.ended && Boolean(els.audio.src),
        currentTime: Number(els.audio.currentTime) || 0,
        duration: Number(els.audio.duration) || (music.track && music.track.duration) || 0,
        track: music.track
      },
      extra || {}
    );
    api.musicState(payload);
  }

  function playTrack(track) {
    if (!track || !track.preview || !els.audio) return;
    music.track = track;
    els.audio.src = track.preview;
    els.audio.volume = 0.85;
    const promise = els.audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => showBubble('这首歌暂时放不出来，换一首试试？', 'sleepy', 3600));
    }
    showBubble(`🎵 ${track.title}${track.artist ? ` - ${track.artist}` : ''}`, 'happy', 4200);
    setMusicDot(true);
    sendMusicState();
  }

  function handleMusicCommand(action) {
    if (!els.audio) return;
    if (action === 'stop') {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();
      music.track = null;
      setMusicDot(false);
      sendMusicState({ playing: false, currentTime: 0, duration: 0, track: null });
      return;
    }
    if (action === 'pause') {
      els.audio.pause();
      return;
    }
    if (action === 'resume') {
      if (els.audio.src) els.audio.play().catch(() => {});
      return;
    }
    if (action === 'toggle') {
      if (els.audio.paused) els.audio.play().catch(() => {});
      else els.audio.pause();
    }
  }

  if (els.audio) {
    els.audio.addEventListener('play', () => {
      setMusicDot(true);
      sendMusicState({ playing: true });
    });
    els.audio.addEventListener('pause', () => {
      setMusicDot(false);
      sendMusicState({ playing: false });
    });
    els.audio.addEventListener('ended', () => {
      setMusicDot(false);
      sendMusicState({ playing: false, ended: true });
      showBubble('放完啦，还想听什么？', 'happy', 3000);
    });
    els.audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - music.lastSentAt < 900) return;
      music.lastSentAt = now;
      sendMusicState();
    });
    els.audio.addEventListener('error', () => {
      showBubble('音频加载失败了…', 'sleepy', 3000);
    });
  }

  function schedulePat() {
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(pat, 210);
  }

  // ------------------------------------------------------------ 鼠标交互

  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragging = true;
    movedWhileDragging = false;
    pressAt = Date.now();
    lastPointer = { x: event.screenX, y: event.screenY };
    els.pet.classList.add('dragging');
    api.setIgnoreMouse(false);
    try {
      els.pet.setPointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.screenX - lastPointer.x;
    const dy = event.screenY - lastPointer.y;
    if (dx === 0 && dy === 0) return;
    lastPointer = { x: event.screenX, y: event.screenY };
    if (Math.abs(dx) + Math.abs(dy) > 1) movedWhileDragging = true;
    api.dragBy(dx, dy);
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    els.pet.classList.remove('dragging');
    try {
      els.pet.releasePointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
    api.dragEnd();
    if (!movedWhileDragging && Date.now() - pressAt < 700) {
      schedulePat();
    }
  }

  function updatePupils(event) {
    if (!els.pupils || els.stage.dataset.style !== 'whale') return;
    const rect = els.whale.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height * 0.55;
    const dx = Math.max(-1, Math.min(1, (event.clientX - centerX) / (rect.width * 0.45)));
    const dy = Math.max(-1, Math.min(1, (event.clientY - centerY) / (rect.height * 0.45)));
    els.pupils.style.transform = `translate(${(dx * 2.2).toFixed(2)}px, ${(dy * 1.8).toFixed(2)}px)`;
  }

  function hitTest(event) {
    const target = event.target;
    const hit = target && target.closest ? target.closest('[data-hit="1"]') : null;
    const nextIgnore = !hit;
    if (nextIgnore !== ignoreMouse) {
      ignoreMouse = nextIgnore;
      api.setIgnoreMouse(nextIgnore);
    }
  }

  window.addEventListener(
    'mousemove',
    (event) => {
      if (!dragging) hitTest(event);
      updatePupils(event);
    },
    { passive: true }
  );

  window.addEventListener('mouseleave', () => {
    if (dragging) return;
    if (!ignoreMouse) {
      ignoreMouse = true;
      api.setIgnoreMouse(true);
    }
  });

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.petMenu();
  });

  els.pet.addEventListener('pointerdown', onPointerDown);
  els.pet.addEventListener('pointermove', onPointerMove);
  els.pet.addEventListener('pointerup', onPointerUp);
  els.pet.addEventListener('pointercancel', onPointerUp);

  els.pet.addEventListener('dblclick', () => {
    window.clearTimeout(clickTimer);
    hideBubble();
    api.openChat();
  });

  els.bubble.addEventListener('click', () => {
    hideBubble();
  });

  els.badge.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  els.badge.addEventListener('click', (event) => {
    event.stopPropagation();
    api.pomodoroCommand('toggle');
  });

  // ------------------------------------------------------------ 番茄钟

  function renderPomodoro(snapshot) {
    if (!snapshot) return;
    const active = snapshot.phase === 'work' || snapshot.phase === 'break';
    els.badge.classList.toggle('hidden', !active);
    els.badge.classList.toggle('paused', active && !snapshot.running);
    if (!active) return;
    els.badgeIcon.textContent = snapshot.phase === 'work' ? '🍅' : '☕';
    els.badgeText.textContent = format ? format.formatClock(snapshot.remaining) : '';
  }

  // ------------------------------------------------------------ 主进程事件

  api.onBubble((payload) => {
    if (!payload || !payload.text) return;
    showBubble(payload.text, { mood: payload.mood, duration: payload.duration });
  });

  api.onPat(() => {
    spawnHearts(4);
    setMood('love', 1200);
  });

  api.onPetSticker((payload) => showSticker(payload));

  api.onMusicPlay((payload) => {
    if (payload && payload.track) playTrack(payload.track);
  });

  api.onMusicCommand((payload) => {
    if (payload && payload.action) handleMusicCommand(payload.action);
  });

  api.onPomodoroTick(renderPomodoro);

  api.onSettingsChanged((next) => {
    if (!next) return;
    settings = Object.assign({}, settings, next);
    applyStyle(settings.petStyle);
    document.title = `${settings.petName || '小鲸鱼'} · 桌面宠物`;
  });

  // ------------------------------------------------------------ 启动

  async function boot() {
    try {
      const loaded = await api.getSettings();
      if (loaded) settings = Object.assign(settings, loaded);
    } catch {
      /* 使用默认值 */
    }
    applyStyle(settings.petStyle);
    document.title = `${settings.petName || '小鲸鱼'} · 桌面宠物`;

    try {
      lines = await api.getQuips();
    } catch {
      lines = null;
    }

    try {
      renderPomodoro(await api.pomodoroState());
    } catch {
      /* 忽略 */
    }

    window.setTimeout(() => {
      const hour = new Date().getHours();
      const hello = format ? format.greeting(hour) : '你好';
      showBubble(`${hello}，我是${settings.petName}～ 点我聊天，拖着我走`, {
        mood: 'idle',
        duration: 4600
      });
    }, 800);
  }

  boot();
})();
