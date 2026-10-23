// Schedule AFTER completion: slow phones drop frames instead of building a queue.
export function isFreshFrame(capturedAt, now, maxAge = 1400) {
  return (
    Number.isFinite(capturedAt) &&
    now >= capturedAt &&
    now - capturedAt <= maxAge
  );
}

export class LiveLoop {
  constructor({
    scan,
    onResult,
    onError,
    interval = 250,
    now = () => performance.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (handle) => clearTimeout(handle),
  }) {
    Object.assign(this, {
      scan,
      onResult,
      onError,
      interval,
      now,
      schedule,
      cancel,
    });
    this.token = 0;
    this.running = false;
    this.inFlight = false;
    this.timer = null;
  }
  start() {
    this.stop();
    this.running = true;
    const token = this.token;
    this.timer = this.schedule(() => this.tick(token), 0);
  }
  stop() {
    this.running = false;
    this.token++;
    this.cancel(this.timer);
    this.timer = null;
  }
  async tick(token) {
    if (!this.running || token !== this.token) return;
    if (this.inFlight) {
      this.timer = this.schedule(() => this.tick(token), 30);
      return;
    }
    this.inFlight = true;
    const start = this.now();
    try {
      const result = await this.scan();
      if (this.running && token === this.token && result) this.onResult(result);
    } catch (error) {
      if (this.running && token === this.token) {
        this.stop();
        this.onError(error);
      }
    } finally {
      this.inFlight = false;
      if (this.running && token === this.token) {
        this.timer = this.schedule(
          () => this.tick(token),
          Math.max(35, this.interval - (this.now() - start)),
        );
      }
    }
  }
}
