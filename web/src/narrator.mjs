export class Narrator {
  constructor({ engine, makeUtterance, now = () => Date.now() }) {
    Object.assign(this, { engine, makeUtterance, now });
    this.lastKey = null;
    this.lastAt = -Infinity;
    this.lastLevel = null;
    this.active = false;
  }
  say(alert, { manual = false, rate = 1.05 } = {}) {
    if (!alert?.speech || !this.engine || !this.makeUtterance) return false;
    const time = this.now();
    // Recover if a browser lost a speech completion callback.
    if (
      this.active &&
      time - this.lastAt > 5000 &&
      !this.engine.speaking &&
      !this.engine.pending
    )
      this.active = false;
    const urgent = alert.level === "pause" && alert.key !== this.lastKey;
    if (!manual) {
      if (urgent && time - this.lastAt < 1500) return false;
      if (
        alert.key === this.lastKey &&
        (alert.level !== "pause" || time - this.lastAt < 12000)
      )
        return false;
      if (!urgent && time - this.lastAt < 2500) return false;
      if (this.active && !(urgent && this.lastLevel !== "pause")) return false;
    }
    if (this.active || this.engine.pending) this.engine.cancel();
    const utterance = this.makeUtterance(alert.speech);
    utterance.lang = "en-US";
    utterance.rate = rate;
    const voices = this.engine.getVoices?.() || [];
    const localVoice = voices.find(
      (voice) => voice.localService && /^en[-_]/i.test(voice.lang),
    );
    if (localVoice) utterance.voice = localVoice;
    this.active = true;
    const token = {};
    this.activeToken = token;
    utterance.onend = utterance.onerror = () => {
      if (this.activeToken === token) this.active = false;
    };
    try {
      this.engine.speak(utterance);
    } catch {
      this.active = false;
      return false;
    }
    this.lastKey = alert.key;
    this.lastAt = time;
    this.lastLevel = alert.level;
    return true;
  }
  stop() {
    this.engine?.cancel();
    this.active = false;
    this.activeToken = null;
  }
  reset() {
    this.stop();
    this.lastKey = null;
    this.lastAt = -Infinity;
    this.lastLevel = null;
  }
}
