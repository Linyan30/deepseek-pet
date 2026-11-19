'use strict';

const DEFAULTS = Object.freeze({
  intervalMs: 500,
  sleepAfterSeconds: 150,
  roamMinMs: 70000,
  roamMaxMs: 160000,
  walkMinMs: 1600,
  walkMaxMs: 3000,
  sleepWakeIdleSeconds: 3
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 把全局鼠标坐标换算成相对于宠物中心的 -1 ~ 1 方向。 */
function normalizePoint(petBounds, point) {
  const centerX = petBounds.x + petBounds.width / 2;
  const centerY = petBounds.y + petBounds.height * 0.55;
  const dx = (point.x - centerX) / Math.max(1, petBounds.width * 0.9);
  const dy = (point.y - centerY) / Math.max(1, petBounds.height * 0.9);
  return {
    x: Math.round(clamp(dx, -1, 1) * 100) / 100,
    y: Math.round(clamp(dy, -1, 1) * 100) / 100
  };
}

/** 在工作区里随机挑一个落点，保证窗口完整可见。 */
function pickTarget(workArea, size, margin, random) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const minX = workArea.x + safeMargin;
  const maxX = workArea.x + workArea.width - size.width - safeMargin;
  const minY = workArea.y + safeMargin;
  const maxY = workArea.y + workArea.height - size.height - safeMargin;

  const x = minX >= maxX ? workArea.x : minX + random() * (maxX - minX);
  const y = minY >= maxY ? workArea.y : minY + random() * (maxY - minY);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 漫游控制器：轮询鼠标位置判断「看向哪」，用系统空闲时间判断睡觉/醒来，
 * 隔一段时间把宠物窗口走到新位置。
 *
 * 所有依赖都注入，方便测试；不依赖任何原生模块。
 */
function createRoamController(options) {
  const opts = options || {};
  const screen = opts.screen;
  const powerMonitor = opts.powerMonitor;
  const getPetWindow = opts.getPetWindow || (() => null);
  const getChatWindow = opts.getChatWindow || (() => null);
  const send = opts.send || (() => {});
  const getSettings = opts.getSettings || (() => ({}));
  const random = opts.random || Math.random;
  const logger = opts.logger || console;
  const config = Object.assign({}, DEFAULTS, opts.config || {});

  let timer = null;
  let sleeping = false;
  let dragging = false;
  let walking = false;
  let nextRoamAt = 0;
  let lastWakeAt = 0;

  function getWindow() {
    const win = getPetWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function isChatFocused() {
    const chat = getChatWindow();
    return Boolean(chat && !chat.isDestroyed() && chat.isFocused());
  }

  function stopWalk(timerId) {
    if (timerId) clearInterval(timerId);
    walking = false;
    send('pet:walk-end', {});
  }

  function walkTo(targetX, targetY, duration) {
    const win = getWindow();
    if (!win || walking) return null;

    const start = win.getBounds();
    const total = Math.max(300, Number(duration) || 2000);
    const steps = Math.max(8, Math.round(total / 60));
    let step = 0;
    walking = true;
    send('pet:walk-start', {});

    const timerId = setInterval(() => {
      const current = getWindow();
      if (!current) {
        stopWalk(timerId);
        return;
      }
      step += 1;
      const t = Math.min(1, step / steps);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = Math.round(start.x + (targetX - start.x) * eased);
      const y = Math.round(start.y + (targetY - start.y) * eased + Math.sin(t * Math.PI * 6) * 2);
      try {
        current.setPosition(x, y);
      } catch (error) {
        logger.warn('[roam] 移动失败：', error.message);
        stopWalk(timerId);
        return;
      }
      if (step >= steps) stopWalk(timerId);
    }, 60);

    if (typeof timerId.unref === 'function') timerId.unref();
    return timerId;
  }

  function roamOnce() {
    const win = getWindow();
    if (!win) return null;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const target = pickTarget(display.workArea, { width: bounds.width, height: bounds.height }, 24, random);
    const duration = config.walkMinMs + random() * (config.walkMaxMs - config.walkMinMs);
    return walkTo(target.x, target.y, duration);
  }

  function tick() {
    const win = getWindow();
    if (!win || !win.isVisible()) return;
    const settings = getSettings();

    if (settings.followCursor !== false) {
      try {
        const point = screen.getCursorScreenPoint();
        send('pet:cursor', Object.assign(normalizePoint(win.getBounds(), point), { enabled: true }));
      } catch {
        /* 忽略单次取点失败 */
      }
    }

    let idleSeconds = 0;
    try {
      idleSeconds = powerMonitor.getSystemIdleTime();
    } catch {
      idleSeconds = 0;
    }

    if (!sleeping && idleSeconds >= config.sleepAfterSeconds) {
      sleeping = true;
      send('pet:sleep', { asleep: true });
    } else if (sleeping && idleSeconds <= config.sleepWakeIdleSeconds) {
      sleeping = false;
      send('pet:sleep', { asleep: false });
      const now = Date.now();
      if (now - lastWakeAt > 60000) {
        lastWakeAt = now;
        send('pet:wake', {});
      }
    }

    if (settings.roaming === false || sleeping || dragging || walking) return;
    if (isChatFocused()) return;
    if (Date.now() < nextRoamAt) return;

    nextRoamAt = Date.now() + config.roamMinMs + random() * (config.roamMaxMs - config.roamMinMs);
    // 不是每次到点都走，显得更随意
    if (random() < 0.35) return;
    roamOnce();
  }

  function start() {
    if (timer) return;
    // 刚启动先待着，过 1~2 分钟再开始溜达
    if (!nextRoamAt) {
      nextRoamAt = Date.now() + config.roamMinMs + random() * (config.roamMaxMs - config.roamMinMs);
    }
    timer = setInterval(tick, config.intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function noteDrag(value) {
    dragging = Boolean(value);
  }

  return {
    start,
    stop,
    tick,
    roamOnce,
    noteDrag,
    isSleeping: () => sleeping,
    isWalking: () => walking
  };
}

module.exports = {
  DEFAULTS,
  normalizePoint,
  pickTarget,
  createRoamController
};
