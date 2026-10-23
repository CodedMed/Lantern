import test from "node:test";
import assert from "node:assert/strict";
import { getGuidance, GuidanceFilter } from "../../utils/guidance.mjs";
import { LiveLoop, isFreshFrame } from "../src/liveLoop.mjs";
import { Narrator } from "../src/narrator.mjs";

const object = (name, bbox, score = 0.9) => ({ class: name, bbox, score });
test("stale and malformed frame times are rejected", () => {
  assert.equal(isFreshFrame(100, 1499), true);
  assert.equal(isFreshFrame(100, 1501), false);
  assert.equal(isFreshFrame(NaN, 100), false);
  assert.equal(isFreshFrame(200, 100), false);
});
test("native timer cancellation is not invoked with the loop as its browser receiver", () => {
  const original = globalThis.clearTimeout;
  let calls = 0;
  try {
    globalThis.clearTimeout = function () {
      assert.equal(this, undefined);
      calls++;
    };
    const loop = new LiveLoop({
      scan: async () => null,
      onResult: () => {},
      onError: () => {},
      schedule: () => 17,
    });
    loop.start();
    loop.stop();
    assert.equal(calls, 2);
  } finally {
    globalThis.clearTimeout = original;
  }
});
test("a prominent central object produces a short pause cue, never a safe-side instruction", () => {
  const cue = getGuidance([object("chair", [0.2, 0.25, 0.95, 0.8])]);
  assert.equal(cue.speech, "Chair ahead. Pause; check left.");
  assert.equal(cue.alert.level, "pause");
  assert.doesNotMatch(
    JSON.stringify(cue),
    /turn left|turn right|path clear|meters|metres/i,
  );
});
test("side alerts describe image position without telling the user to step elsewhere", () => {
  assert.equal(
    getGuidance([object("person", [0.4, 0.05, 0.9, 0.2])]).speech,
    "Person on left.",
  );
  assert.equal(
    getGuidance([object("person", [0.4, 0.8, 0.9, 0.95])]).speech,
    "Person on right.",
  );
});
test("an object overlapping the center is ahead even when its midpoint is off-center", () => {
  assert.equal(
    getGuidance([object("couch", [0.4, 0.02, 0.9, 0.6])]).alert.position,
    "ahead",
  );
});
test("foreground central objects take priority over high-confidence background and side objects", () => {
  const cue = getGuidance([
    object("kite", [0, 0, 0.9, 0.9], 0.99),
    object("person", [0.3, 0.02, 0.9, 0.2], 0.99),
    object("chair", [0.2, 0.3, 0.95, 0.8], 0.6),
  ]);
  assert.equal(cue.alert.class, "chair");
});
test("no detection and high background objects stay silent, never imply a clear route", () => {
  for (const detections of [
    [],
    [object("bird", [0.1, 0.4, 0.2, 0.6])],
    [object("person", [0.02, 0.4, 0.18, 0.6])],
  ]) {
    const cue = getGuidance(detections);
    assert.equal(cue.speech, "");
    assert.equal(cue.alert, null);
    assert.match(cue.detail, /hazards may still be present/);
  }
});
test("ordinary alerts need two matching frames; prominent central alerts do not wait", () => {
  const filter = new GuidanceFilter();
  const ordinary = getGuidance([object("person", [0.4, 0.05, 0.9, 0.2])]);
  assert.equal(filter.update(ordinary), null);
  assert.equal(filter.update(ordinary), ordinary);
  filter.reset();
  const urgent = getGuidance([object("chair", [0.2, 0.25, 0.95, 0.8])]);
  assert.equal(filter.update(urgent), urgent);
  filter.update(getGuidance([]));
  assert.equal(filter.update(ordinary), null);
});

function loopFixture(scan) {
  let time = 0,
    id = 0;
  const timers = new Map(),
    results = [],
    errors = [];
  const loop = new LiveLoop({
    scan,
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
    now: () => time,
    schedule: (callback, delay) => {
      timers.set(++id, { callback, delay });
      return id;
    },
    cancel: (handle) => timers.delete(handle),
  });
  const next = () => {
    const entry = timers.entries().next().value;
    assert.ok(entry, "one next frame must be scheduled");
    timers.delete(entry[0]);
    return entry[1];
  };
  return {
    loop,
    results,
    errors,
    timers,
    next,
    advance: (elapsed) => {
      time += elapsed;
    },
  };
}
test("live scanning starts immediately then waits only the remaining frame budget", async () => {
  let fixture;
  fixture = loopFixture(async () => {
    fixture.advance(40);
    return { frame: 1 };
  });
  fixture.loop.start();
  const first = fixture.next();
  assert.equal(first.delay, 0);
  await first.callback();
  assert.equal(fixture.results.length, 1);
  assert.equal(fixture.next().delay, 210);
});
test("slow inference drops intermediate frames instead of adding a fixed 1.8-second gap", async () => {
  let fixture;
  fixture = loopFixture(async () => {
    fixture.advance(700);
    return { frame: 1 };
  });
  fixture.loop.start();
  await fixture.next().callback();
  assert.equal(fixture.next().delay, 35);
});
test("stopping during inference discards late results and does not schedule another frame", async () => {
  let resolve;
  const fixture = loopFixture(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fixture.loop.start();
  const pending = fixture.next().callback();
  fixture.loop.stop();
  resolve({ stale: true });
  await pending;
  assert.deepEqual(fixture.results, []);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.loop.inFlight, false);
});
test("rapid pause/resume never starts a second inference while the first is pending", async () => {
  let resolve,
    calls = 0;
  const fixture = loopFixture(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  fixture.loop.start();
  const old = fixture.next().callback();
  fixture.loop.start();
  await fixture.next().callback();
  assert.equal(calls, 1);
  assert.equal(fixture.timers.size, 1);
  resolve({ old: true });
  await old;
  assert.deepEqual(fixture.results, []);
  const resumed = fixture.next().callback();
  assert.equal(calls, 2);
  resolve({ current: true });
  await resumed;
  assert.deepEqual(fixture.results, [{ current: true }]);
});
test("inference errors stop the live loop without continuing to report old objects", async () => {
  const fixture = loopFixture(async () => {
    throw new Error("GPU failed");
  });
  fixture.loop.start();
  await fixture.next().callback();
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.loop.running, false);
  assert.equal(fixture.loop.inFlight, false);
  assert.equal(fixture.timers.size, 0);
});

function voiceFixture() {
  let time = 0,
    cancels = 0;
  const spoken = [];
  const engine = {
    pending: false,
    speaking: false,
    getVoices: () => [],
    speak: (utterance) => spoken.push(utterance),
    cancel: () => {
      cancels++;
    },
  };
  const narrator = new Narrator({
    engine,
    makeUtterance: (text) => ({ text }),
    now: () => time,
  });
  const finish = () => spoken.at(-1)?.onend();
  return {
    narrator,
    spoken,
    engine,
    finish,
    advance: (elapsed) => {
      time += elapsed;
    },
    cancels: () => cancels,
  };
}
const side = {
  key: "person:left:side",
  speech: "Person on left.",
  level: "side",
};
const ahead = {
  key: "chair:ahead:pause",
  speech: "Chair ahead. Pause.",
  level: "pause",
};
test("unchanged ordinary object alerts are not repeated every frame", () => {
  const voice = voiceFixture();
  assert.equal(voice.narrator.say(side), true);
  voice.finish();
  voice.advance(30000);
  assert.equal(voice.narrator.say(side), false);
  assert.equal(voice.spoken.length, 1);
});
test("speech does not build a queue or repeatedly cancel a phrase mid-sentence", () => {
  const voice = voiceFixture();
  voice.narrator.say(side);
  voice.advance(3000);
  assert.equal(
    voice.narrator.say({
      ...side,
      key: "dog:right:side",
      speech: "Dog on right.",
    }),
    false,
  );
  assert.equal(voice.spoken.length, 1);
  assert.equal(voice.cancels(), 0);
});
test("a new prominent central warning can interrupt a lower-priority side alert once", () => {
  const voice = voiceFixture();
  voice.narrator.say(side);
  voice.advance(1800);
  assert.equal(voice.narrator.say(ahead), true);
  assert.equal(voice.cancels(), 1);
  assert.equal(voice.spoken.length, 2);
  assert.equal(voice.narrator.say(ahead), false);
});
test("persistent prominent warnings have a 12-second reminder interval", () => {
  const voice = voiceFixture();
  voice.narrator.say(ahead);
  voice.finish();
  voice.advance(11000);
  assert.equal(voice.narrator.say(ahead), false);
  voice.advance(1000);
  assert.equal(voice.narrator.say(ahead), true);
});
test("manual Repeat bypasses duplicate suppression and mute stops speech immediately", () => {
  const voice = voiceFixture();
  voice.narrator.say(side);
  assert.equal(voice.narrator.say(side, { manual: true }), true);
  voice.narrator.stop();
  assert.equal(voice.narrator.active, false);
  assert.equal(voice.cancels(), 2);
});
test("silent or unsupported speech is harmless", () => {
  const voice = voiceFixture();
  assert.equal(voice.narrator.say(null), false);
  const unavailable = new Narrator({ engine: null, makeUtterance: null });
  assert.equal(unavailable.say(ahead), false);
  unavailable.stop();
});
