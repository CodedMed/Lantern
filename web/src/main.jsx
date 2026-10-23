import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detector } from "./detector.mjs";
import { requestCamera, stopStream } from "./camera.mjs";
import { LiveLoop, isFreshFrame } from "./liveLoop.mjs";
import { Narrator } from "./narrator.mjs";
import { getGuidance, GuidanceFilter } from "../../utils/guidance.mjs";
import {
  readSettings,
  sanitizeSettings,
  SETTINGS_KEY,
} from "../../utils/preferences.mjs";
import "./style.css";

const IDLE = { type: "idle" };
const INITIAL_CUE = {
  title: "Camera off.",
  detail: "Start the camera for live object alerts.",
};

function Icon({ name, size = 22 }) {
  const paths = {
    camera: (
      <>
        <path d="m9 5 2-2h2l2 2h6v15H3V5z" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />
      </>
    ),
    muted: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM17 9l5 6m0-6-5 6" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m7 4 13 8-13 8z" />,
    flip: (
      <>
        <path d="M3 8h14l-4-4M21 16H7l4 4M3 8v5m18 3v-5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: (
      <>
        <path d="M3 7h18M3 17h18" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    photo: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1" />
        <path d="m3 18 6-6 4 4 4-7 4 6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.camera}
    </svg>
  );
}

function Boxes({ frame, size }) {
  if (!frame) return null;
  const font = size.width / 22;
  return (
    <svg
      className="boxes"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {frame.detections.slice(0, 8).map((item, index) => {
        const [top, left, bottom, right] = item.bbox;
        const x = left * size.width,
          y = top * size.height;
        const labelWidth = (item.class.length * 0.56 + 0.8) * font;
        const labelX = Math.max(2, Math.min(x, size.width - labelWidth - 2));
        const labelY = Math.max(font * 1.3, y);
        return (
          <g key={`${item.class}-${index}`}>
            <rect
              x={x}
              y={y}
              width={(right - left) * size.width}
              height={(bottom - top) * size.height}
              className="box-outline"
            />
            <rect
              x={x}
              y={y}
              width={(right - left) * size.width}
              height={(bottom - top) * size.height}
              className="box-line"
            />
            <rect
              x={labelX}
              y={labelY - font * 1.25}
              width={labelWidth}
              height={font * 1.35}
              fill="white"
            />
            <text
              x={labelX + font * 0.35}
              y={labelY - font * 0.23}
              fontSize={font}
              fill="black"
            >
              {item.class}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function App() {
  const [settings, setSettings] = useState(() => {
    try {
      return readSettings(window.localStorage);
    } catch {
      return sanitizeSettings();
    }
  });
  const [source, setSource] = useState(IDLE);
  const [pending, setPending] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [modelReady, setModelReady] = useState(Boolean(detector.model));
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(null);
  const [cue, setCue] = useState(INITIAL_CUE);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [size, setSize] = useState({ width: 640, height: 960 });
  const videoRef = useRef(null),
    imageRef = useRef(null),
    fileRef = useRef(null);
  const streamRef = useRef(null),
    canvasRef = useRef(null),
    facing = useRef("environment");
  const generation = useRef(0),
    alive = useRef(true),
    pendingRef = useRef(false);
  const state = useRef({}),
    loopRef = useRef(null),
    narratorRef = useRef(null);
  const filter = useRef(new GuidanceFilter());
  const speechAvailable =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  state.current = { source, settings, paused };
  if (!narratorRef.current)
    narratorRef.current = new Narrator({
      engine: window.speechSynthesis,
      makeUtterance: speechAvailable
        ? (text) => new SpeechSynthesisUtterance(text)
        : null,
    });
  if (!loopRef.current)
    loopRef.current = new LiveLoop({
      scan: () => capture(),
      onResult: (result) => receive(result),
      onError: () => {
        setFrame(null);
        setPaused(true);
        narratorRef.current.stop();
        setError("Detection stopped. Hold still and tap Resume to retry.");
        setCue({
          title: "Detection stopped.",
          detail: "No current object information.",
        });
      },
    });

  useEffect(() => {
    alive.current = true;
    const onHidden = () => {
      if (document.hidden) {
        narratorRef.current.stop();
        if (streamRef.current || pendingRef.current) stopCamera();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      alive.current = false;
      generation.current++;
      loopRef.current.stop();
      stopStream(streamRef.current);
      narratorRef.current.stop();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private browsing */
    }
    if (!settings.speech) narratorRef.current.stop();
  }, [settings]);
  useEffect(() => {
    if (source.type === "photo" && source.url.startsWith("blob:"))
      return () => URL.revokeObjectURL(source.url);
  }, [source]);
  useEffect(() => {
    if (source.type !== "camera" || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video
      .play()
      .catch(() => setError("Tap the camera view to start its preview."));
  }, [source]);
  useEffect(() => {
    if (!mediaReady || !modelReady || paused || modal || source.type === "idle")
      return;
    loopRef.current.start();
    return () => loopRef.current.stop();
  }, [source, mediaReady, modelReady, paused, modal]);
  useEffect(() => {
    if (!modal) return;
    narratorRef.current.stop();
    setFrame(null);
  }, [modal]);
  useEffect(() => {
    if (!frame || source.type !== "camera") return;
    const timer = setTimeout(
      () => {
        setFrame(null);
        setCue({
          title: "Waiting for a fresh view.",
          detail: "Hold the camera steady. Objects may be missed.",
        });
      },
      Math.max(0, 1400 - (performance.now() - frame.capturedAt)),
    );
    return () => clearTimeout(timer);
  }, [frame, source.type]);

  function update(key, value) {
    setSettings((current) => sanitizeSettings({ ...current, [key]: value }));
  }
  function clearView() {
    generation.current++;
    loopRef.current.stop();
    stopStream(streamRef.current);
    streamRef.current = null;
    pendingRef.current = false;
    narratorRef.current.reset();
    filter.current.reset();
    setPending(false);
    setMediaReady(false);
    setPaused(false);
    setFrame(null);
    setError("");
  }
  function stopCamera() {
    clearView();
    setSource(IDLE);
    setCue(INITIAL_CUE);
  }
  async function prepareModel() {
    setModelLoading(true);
    setModelError(false);
    try {
      await detector.load();
      if (alive.current) {
        setModelReady(true);
        setModelError(false);
      }
    } catch {
      if (alive.current) {
        setModelError(true);
        setError("Detector could not load. Check your connection and retry.");
      }
    } finally {
      if (alive.current) setModelLoading(false);
    }
  }
  async function startCamera(nextFacing = facing.current) {
    if (pendingRef.current) return;
    clearView();
    setSource(IDLE);
    setCue({
      title: "Opening camera…",
      detail: "Allow camera access when asked.",
    });
    const token = generation.current;
    pendingRef.current = true;
    setPending(true);
    if (settings.speech)
      narratorRef.current.say(
        { key: "start", speech: "Starting camera.", level: "status" },
        { manual: true, rate: settings.rate },
      );
    prepareModel();
    try {
      const stream = await requestCamera(
        navigator.mediaDevices,
        () => alive.current && generation.current === token,
        nextFacing,
      );
      if (!stream) return;
      streamRef.current = stream;
      facing.current = nextFacing;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (alive.current && generation.current === token) {
            stopCamera();
            setError("Camera disconnected. Tap Start camera to reconnect.");
          }
        };
      });
      setSource({ type: "camera" });
      setCue({
        title: "Getting ready…",
        detail: "Detection starts automatically.",
      });
    } catch (cause) {
      if (generation.current !== token || !alive.current) return;
      narratorRef.current.stop();
      setCue(INITIAL_CUE);
      setError(
        cause.name === "NotAllowedError" || cause.name === "SecurityError"
          ? "Camera access denied. Allow it in browser settings, or try Demo below."
          : "Camera unavailable. Use HTTPS, close other camera apps, or try Demo below.",
      );
    } finally {
      if (alive.current && generation.current === token) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }
  function showPhoto(url, name) {
    clearView();
    setSize({ width: 640, height: 425 });
    setSource({ type: "photo", url, name, id: generation.current });
    setCue({
      title: "Checking photo…",
      detail: "This is a still image, not live guidance.",
    });
    prepareModel();
  }
  async function capture() {
    const current = state.current;
    const element =
      current.source.type === "camera" ? videoRef.current : imageRef.current;
    const width = element?.videoWidth || element?.naturalWidth;
    const height = element?.videoHeight || element?.naturalHeight;
    if (
      !width ||
      !height ||
      (current.source.type === "camera" && element.readyState < 2)
    )
      return null;
    canvasRef.current ||= document.createElement("canvas");
    const canvas = canvasRef.current;
    const scale = Math.min(1, 640 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const token = generation.current;
    const capturedAt = performance.now();
    canvas
      .getContext("2d", { willReadFrequently: true })
      .drawImage(element, 0, 0, w, h);
    const result = await detector.detect(canvas, current.settings.threshold);
    return { ...result, capturedAt, token };
  }
  function receive(result) {
    if (!alive.current || result.token !== generation.current) return;
    const { source: currentSource, settings: currentSettings } = state.current;
    if (
      currentSource.type === "camera" &&
      !isFreshFrame(result.capturedAt, performance.now())
    ) {
      setFrame(null);
      setCue({
        title: "Detection is catching up.",
        detail: "Hold still. Do not rely on delayed results.",
      });
      return;
    }
    setFrame(result);
    setError("");
    const guidance = getGuidance(result.detections);
    const confirmed =
      currentSource.type === "photo"
        ? guidance
        : filter.current.update(guidance);
    if (confirmed || !guidance.alert) {
      setCue(guidance);
      if (currentSettings.speech && confirmed?.alert)
        narratorRef.current.say(confirmed.alert, {
          rate: currentSettings.rate,
        });
    }
    if (currentSource.type === "photo") loopRef.current.stop();
  }
  function togglePause() {
    narratorRef.current.stop();
    filter.current.reset();
    setFrame(null);
    setError("");
    setPaused((current) => !current);
    setCue(
      paused
        ? { title: "Checking view…", detail: "Hold your phone steady." }
        : { title: "Detection paused.", detail: "No current object alerts." },
    );
  }
  function toggleSpeech() {
    if (settings.speech) narratorRef.current.stop();
    else
      narratorRef.current.say(
        { key: "voice-on", speech: "Voice alerts on.", level: "status" },
        { manual: true, rate: settings.rate },
      );
    update("speech", !settings.speech);
  }
  function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
        file.type,
      )
    ) {
      setError("Choose a JPG, PNG, WebP, or AVIF photo.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Choose a photo under 15 MB.");
      return;
    }
    showPhoto(URL.createObjectURL(file), file.name);
  }
  const activeCamera = source.type === "camera";
  const status = pending
    ? "Opening camera"
    : modelLoading
      ? "Loading detector…"
      : modelError
        ? "Detector unavailable"
        : activeCamera
          ? paused || modal
            ? "Detection paused"
            : frame
              ? "Live detection"
              : "Starting detection"
          : source.type === "photo"
            ? "Photo mode"
            : "Camera off";
  const sectors = new Set(
    (frame?.detections || [])
      .map((item) => getGuidance([item]).alert?.position)
      .filter(Boolean),
  );

  return (
    <main className={`app ${settings.largeText ? "large-text" : ""}`}>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(event) => event.preventDefault()}
        >
          <img src="/lantern.svg" alt="" />
          Lantern
        </a>
        <span className="header-label">Live object alerts</span>
        <button
          className="icon-button"
          aria-label="Settings"
          onClick={() => setModal("settings")}
        >
          <Icon name="settings" />
        </button>
      </header>
      <section className="camera-area" aria-label="Camera and object detection">
        <div className="camera-status" role="status">
          <span
            className={
              activeCamera && !paused && frame
                ? "status-dot live"
                : "status-dot"
            }
          />
          {status}
          {activeCamera && (
            <button className="stop-button" onClick={stopCamera}>
              Stop camera
            </button>
          )}
        </div>
        <div className="view">
          {activeCamera ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Live camera preview"
              onClick={() => videoRef.current?.play()}
              onLoadedData={() => {
                setSize({
                  width: videoRef.current.videoWidth,
                  height: videoRef.current.videoHeight,
                });
                setMediaReady(true);
              }}
              onError={() => {
                loopRef.current.stop();
                setFrame(null);
                setError(
                  "Camera preview stopped. Stop and restart the camera.",
                );
              }}
            />
          ) : source.type === "photo" ? (
            <img
              key={source.id}
              ref={imageRef}
              src={source.url}
              alt="Selected still image for object detection"
              onLoad={(event) => {
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setMediaReady(true);
              }}
              onError={() =>
                setError(
                  "This photo could not be opened. Choose another image.",
                )
              }
            />
          ) : (
            <div className="empty-view">
              <Icon name="camera" size={44} />
              <h1>Live camera</h1>
              <p>
                Use your rear camera for short
                <br />
                object alerts as the view changes.
              </p>
              <button
                className="start-button"
                disabled={pending}
                onClick={() => startCamera()}
              >
                {pending ? "Opening camera…" : "Start camera"}
              </button>
              {pending && (
                <button className="cancel-button" onClick={stopCamera}>
                  Cancel
                </button>
              )}
            </div>
          )}
          <Boxes
            frame={frame}
            size={frame ? { width: frame.width, height: frame.height } : size}
          />
          {activeCamera && !mediaReady && (
            <p className="view-message">Starting preview…</p>
          )}
          {source.type === "photo" && (
            <span className="photo-label">STILL PHOTO · NOT LIVE</span>
          )}
          {(paused || modal) && activeCamera && (
            <div className="paused-label">Detection paused</div>
          )}
        </div>
        <div className="positions" aria-label="Object positions in camera view">
          {["left", "ahead", "right"].map((position) => (
            <span
              key={position}
              className={sectors.has(position) ? "occupied" : ""}
            >
              {position}
              <span aria-hidden="true">
                {sectors.has(position) ? "●" : "—"}
              </span>
            </span>
          ))}
        </div>
      </section>
      <section className="feedback" aria-label="Current object alert">
        <div className="cue" aria-live="polite" aria-atomic="true">
          <h2>{cue.title}</h2>
          <p>{cue.detail}</p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {modelError && (
          <button
            className="retry-button"
            onClick={() => {
              setError("");
              prepareModel();
            }}
          >
            Retry detector
          </button>
        )}
        <div className="controls">
          {activeCamera ? (
            <>
              <button
                className="control"
                aria-label={paused ? "Resume detection" : "Pause detection"}
                onClick={togglePause}
                disabled={!mediaReady || !modelReady}
              >
                <Icon name={paused ? "play" : "pause"} />
                <span>{paused ? "Resume" : "Pause"}</span>
              </button>
              <button
                className="control"
                onClick={() =>
                  startCamera(
                    facing.current === "environment" ? "user" : "environment",
                  )
                }
                disabled={pending}
                aria-label="Switch camera"
              >
                <Icon name="flip" />
                <span>Switch</span>
              </button>
            </>
          ) : source.type === "photo" ? (
            <button className="control" onClick={() => startCamera()}>
              <Icon name="camera" />
              <span>Go live</span>
            </button>
          ) : null}
          <button
            className="control"
            disabled={!speechAvailable}
            aria-label={
              settings.speech ? "Mute voice alerts" : "Enable voice alerts"
            }
            aria-pressed={settings.speech}
            onClick={toggleSpeech}
          >
            <Icon
              name={settings.speech && speechAvailable ? "sound" : "muted"}
            />
            <span>
              {speechAvailable
                ? settings.speech
                  ? "Voice on"
                  : "Voice off"
                : "No voice"}
            </span>
          </button>
          <button
            className="control"
            disabled={
              !cue.alert || !settings.speech || !speechAvailable || paused
            }
            onClick={() =>
              narratorRef.current.say(cue.alert, {
                manual: true,
                rate: settings.rate,
              })
            }
            aria-label="Repeat current alert"
          >
            <Icon name="play" />
            <span>Repeat</span>
          </button>
        </div>
      </section>
      <footer>
        <div className="secondary-actions">
          <button onClick={() => showPhoto("/sample-scene.jpg", "Demo photo")}>
            Demo photo
          </button>
          <button onClick={() => fileRef.current?.click()}>Upload photo</button>
          <button onClick={() => setModal("about")}>About</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          className="visually-hidden"
          accept="image/jpeg,image/png,image/webp,image/avif"
          aria-label="Choose photo"
          tabIndex={-1}
          onChange={upload}
        />
        <p>
          Objects can be missed. No distance or safe-route detection.
          <br />
          Keep using your usual mobility aids. Do not use for road crossing.
        </p>
      </footer>
      {modal && (
        <Dialog
          title={modal === "settings" ? "Settings" : "About Lantern"}
          onClose={() => setModal(null)}
        >
          {modal === "settings" ? (
            <>
              <label className="setting">
                Voice alerts
                <input
                  type="checkbox"
                  checked={settings.speech}
                  disabled={!speechAvailable}
                  onChange={toggleSpeech}
                />
              </label>
              <label className="setting range-setting">
                Voice speed <output>{settings.rate.toFixed(2)}×</output>
                <input
                  type="range"
                  min="0.6"
                  max="1.5"
                  step="0.05"
                  value={settings.rate}
                  onChange={(event) =>
                    update("rate", Number(event.target.value))
                  }
                />
              </label>
              <button
                className="test-voice"
                disabled={!settings.speech || !speechAvailable}
                onClick={() =>
                  narratorRef.current.say(
                    { key: "test", speech: "Chair ahead.", level: "status" },
                    { manual: true, rate: settings.rate },
                  )
                }
              >
                Test short alert
              </button>
              <label className="setting">
                Larger text
                <input
                  type="checkbox"
                  checked={settings.largeText}
                  onChange={(event) =>
                    update("largeText", event.target.checked)
                  }
                />
              </label>
              <label className="setting range-setting">
                Detection threshold{" "}
                <output>{Math.round(settings.threshold * 100)}%</output>
                <input
                  type="range"
                  min="0.35"
                  max="0.85"
                  step="0.05"
                  value={settings.threshold}
                  onChange={(event) =>
                    update("threshold", Number(event.target.value))
                  }
                />
              </label>
              <p className="note">
                Higher thresholds hide uncertain detections but can miss more
                objects. Preferences save on this device.
              </p>
            </>
          ) : (
            <div className="about">
              <p>
                Start the camera and hold your phone steady. Object detection
                runs continuously, with one frame in progress at a time. Pause
                stops detection; Stop camera releases the camera.
              </p>
              <p>
                Alerts are brief: “Chair ahead,” “Person on left,” or “Chair
                ahead. Pause.” An object filling the center may trigger a pause
                cue, but image size is not distance. Left/right labels refer to
                the camera image, including the unmirrored front camera.
              </p>
              <p>
                Unchanged alerts are quiet. A persistent prominent central
                object may repeat after 12 seconds. The app never says a side is
                safe or tells you to step into an unverified path.
              </p>
              <p>
                This prototype recognizes 80 COCO object categories using
                COCO-SSD. It misses hazards such as steps, holes, glass, and
                objects outside its training categories. It cannot replace a
                cane, guide dog, or other mobility support.
              </p>
              <p>
                Recognition runs in this browser. Images are not uploaded. The
                first use downloads model files; speed depends on your phone.
                Device speech may require tapping Repeat or enabling Voice.
                Switching apps turns the camera off.
              </p>
              <p>
                <a
                  href="https://github.com/CodedMed/Lantern"
                  target="_blank"
                  rel="noreferrer"
                >
                  Source code
                </a>{" "}
                ·{" "}
                <a
                  href="/THIRD_PARTY_NOTICES.txt"
                  target="_blank"
                  rel="noreferrer"
                >
                  Credits
                </a>
              </p>
              {frame && (
                <p className="note">
                  Last inference: {frame.elapsed} ms · {frame.backend} · this is
                  not total camera-to-alert latency.
                </p>
              )}
            </div>
          )}
        </Dialog>
      )}
    </main>
  );
}

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fallback">
        <h1>Lantern could not start.</h1>
        <p>Reload or try a current version of Safari or Chrome.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
