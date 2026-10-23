export class Narrator {
  constructor({
    engine,
    makeUtterance,
    now = () => performance.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (handle) => clearTimeout(handle),
  }) {
    Object.assign(this, { engine, makeUtterance, now, schedule, cancel });
    this.lastKey = null;
    this.lastAt = -Infinity;
    this.lastLevel = null;
    this.active = false;
    this.lastEndedAt = -Infinity;
    this.lastPauseAt = -Infinity;
    this.latest = null;
    this.timer = null;
  }
  say(alert, { manual = false, rate = 0.95 } = {}) {
    if (!alert?.speech) {
      this.latest = null;
      this.clearTimer();
      return false;
    }
    if (!this.engine || !this.makeUtterance) return false;
    // One replaceable update, never a FIFO of old object descriptions.
    this.latest = { alert, manual, rate, seenAt: this.now() };
    return this.flush();
  }
  clearTimer() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  later(delay) {
    if (this.timer !== null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }
  flush() {
    if (!this.latest) return false;
    const time = this.now();
    const { alert, manual, rate, seenAt } = this.latest;
    if (
      !Number.isFinite(time) ||
      time < seenAt ||
      time < this.lastAt ||
      time - seenAt > 1000
    ) {
      this.latest = null;
      this.clearTimer();
      return false;
    }
    // Recover if a browser lost a speech completion callback.
    if (
      this.active &&
      time - this.lastAt > 5000 &&
      !this.engine.speaking &&
      !this.engine.pending
    )
      this.active = false;
    const urgent = alert.level === "pause" && this.lastLevel !== "pause";
    if (this.active) {
      // Repeat and ordinary changes finish the current sentence. A close-ahead
      // escalation can interrupt once, not on every left/right or class change.
      if (
        manual ||
        !urgent ||
        time - this.lastAt < 1500 ||
        time - this.lastPauseAt < 6000
      ) return false;
    }
    if (!manual) {
      if (alert.key === this.lastKey && time - this.lastAt < 12000) return false;
      if (!urgent && time - this.lastEndedAt < 800) {
        this.later(800 - (time - this.lastEndedAt));
        return false;
      }
      if (!urgent && time - this.lastAt < 2500) {
        this.later(2500 - (time - this.lastAt));
        return false;
      }
    }
    this.clearTimer();
    // Invalidate the old callback before cancel(), which may call onerror
    // synchronously on some browsers.
    this.activeToken = null;
    if (this.active) this.engine.cancel();
    const utterance = this.makeUtterance(alert.speech);
    utterance.lang = "en-US";
    utterance.rate = Number.isFinite(rate)
      ? Math.min(1.5, Math.max(0.6, rate))
      : 0.95;
    const voices = this.engine.getVoices?.() || [];
    const localVoice = voices.find(
      (voice) => voice.default && /^en([-_]|$)/i.test(voice.lang),
    );
    if (localVoice) utterance.voice = localVoice;
    this.active = true;
    const token = {};
    this.activeToken = token;
    utterance.onend = utterance.onerror = () => {
      if (this.activeToken === token) {
        this.active = false;
        this.activeToken = null;
        this.lastEndedAt = this.now();
        // Speak only a still-current update after a real pause. Live frames
        // replace latest; missing objects clear it. No old queue is drained.
        if (this.latest && !this.latest.manual) this.later(800);
      }
    };
    try {
      this.engine.speak(utterance);
    } catch {
      this.active = false;
      this.activeToken = null;
      this.latest = null;
      return false;
    }
    this.lastKey = alert.key;
    this.lastAt = time;
    this.lastLevel = alert.level;
    if (alert.level === "pause") this.lastPauseAt = time;
    return true;
  }
  stop() {
    this.clearTimer();
    this.latest = null;
    this.activeToken = null;
    this.engine?.cancel();
    this.active = false;
    this.lastEndedAt = this.now();
  }
  reset() {
    this.stop();
    this.lastKey = null;
    this.lastAt = -Infinity;
    this.lastLevel = null;
    this.lastEndedAt = -Infinity;
    this.lastPauseAt = -Infinity;
  }
}
