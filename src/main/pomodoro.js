'use strict';

const PHASE = Object.freeze({
  IDLE: 'idle',
  WORK: 'work',
  BREAK: 'break'
});

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 番茄钟：放在主进程里跑，关掉聊天窗口也不会停。
 * 用“截止时间戳”计时，避免 setInterval 漂移。
 */
class Pomodoro {
  constructor({ workMinutes = 25, breakMinutes = 5, onTick, onPhaseEnd } = {}) {
    this.workMinutes = workMinutes;
    this.breakMinutes = breakMinutes;
    this.onTick = onTick || (() => {});
    this.onPhaseEnd = onPhaseEnd || (() => {});
    this.phase = PHASE.IDLE;
    this.running = false;
    this.remaining = 0;
    this.total = 0;
    this.deadline = 0;
    this.timer = null;
  }

  setDurations(workMinutes, breakMinutes) {
    this.workMinutes = Math.max(1, Math.min(120, Number(workMinutes) || 25));
    this.breakMinutes = Math.max(1, Math.min(60, Number(breakMinutes) || 5));
    if (this.phase === PHASE.IDLE) {
      this.total = this.workMinutes * 60;
      this.remaining = this.total;
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      running: this.running,
      remaining: Math.max(0, Math.ceil(this.remaining)),
      total: this.total,
      workMinutes: this.workMinutes,
      breakMinutes: this.breakMinutes
    };
  }

  _emit() {
    this.onTick(this.snapshot());
  }

  _ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 250);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _tick() {
    if (!this.running) return;
    const now = Date.now();
    this.remaining = Math.max(0, (this.deadline - now) / 1000);
    if (this.remaining > 0) {
      this._emit();
      return;
    }
    const finishedPhase = this.phase;
    this.remaining = 0;
    this._emit();
    this.onPhaseEnd(finishedPhase, this.snapshot());
    if (finishedPhase === PHASE.WORK) {
      this._begin(PHASE.BREAK, this.breakMinutes * 60);
    } else {
      this._begin(PHASE.IDLE, this.workMinutes * 60);
    }
  }

  _begin(phase, seconds) {
    this.phase = phase;
    this.total = Math.max(1, Math.round(seconds));
    this.remaining = this.total;
    this.deadline = Date.now() + this.total * 1000;
    this.running = phase !== PHASE.IDLE;
    if (this.running) {
      this._ensureTimer();
    } else {
      this._stopTimer();
    }
    this._emit();
  }

  start() {
    if (this.running) return this.snapshot();
    if (this.phase === PHASE.IDLE) {
      this._begin(PHASE.WORK, this.workMinutes * 60);
    } else {
      this.deadline = Date.now() + this.remaining * 1000;
      this.running = true;
      this._ensureTimer();
      this._emit();
    }
    return this.snapshot();
  }

  pause() {
    if (!this.running) return this.snapshot();
    this.remaining = Math.max(0, (this.deadline - Date.now()) / 1000);
    this.running = false;
    this._stopTimer();
    this._emit();
    return this.snapshot();
  }

  toggle() {
    return this.running ? this.pause() : this.start();
  }

  reset() {
    this._stopTimer();
    this.phase = PHASE.IDLE;
    this.running = false;
    this.total = this.workMinutes * 60;
    this.remaining = this.total;
    this.deadline = 0;
    this._emit();
    return this.snapshot();
  }

  dispose() {
    this._stopTimer();
  }
}

module.exports = { Pomodoro, PHASE, formatClock };
