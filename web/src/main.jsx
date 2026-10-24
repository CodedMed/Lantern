import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detector } from "./detector.mjs";
import { requestCamera, stopStream } from "./camera.mjs";
import { LiveLoop, isFreshFrame } from "./liveLoop.mjs";
import { Narrator } from "./narrator.mjs";
import { getGuidance, GuidanceFilter } from "../../utils/guidance.mjs";
import { RangeTracker } from "../../utils/rangeTracking.mjs";
import { roomLabel } from "../../utils/obstacles.mjs";
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
        const label = `${roomLabel(item.class)}${item.range ? ` · ${item.range.label}` : ""}`;
        const labelWidth = Math.min(
          size.width - 4,
          (label.length * 0.5 + 0.8) * font,
        );
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
              {label}
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
  const [rangeTarget, setRangeTarget] = useState("");
  const [measuredDistance, setMeasuredDistance] = useState("");
  const [measurementConfirmed, setMeasurementConfirmed] = useState(false);
  const [rangeError, setRangeError] = useState("");
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
  const rangeTracker = useRef(new RangeTracker());
  const lastStats = useRef(null);
  const speechAvailable =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  state.current = { source, settings, paused, modal, cue };
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
        rangeTracker.current.suspend();
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
    if (
      !mediaReady ||
      !modelReady ||
      paused ||
      (modal && modal !== "distance") ||
      source.type === "idle"
    )
      return;
    loopRef.current.start();
    return () => loopRef.current.stop();
  }, [source, mediaReady, modelReady, paused, modal]);
  useEffect(() => {
    if (!modal) return;
    narratorRef.current.stop();
    if (modal !== "distance") {
      setFrame(null);
      rangeTracker.current.suspend();
      setCue({
        title: "Checking view…",
        detail: "Live readings paused. Saved calibration is kept.",
      });
    }
  }, [modal]);
  useEffect(() => {
    if (!frame || source.type !== "camera") return;
    const timer = setTimeout(
      () => {
        rangeTracker.current.suspend();
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
    rangeTracker.current.reset();
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
      if (!detector.model && !detector.pending)
        detector.base =
          state.current.settings.model === "fast"
            ? "lite_mobilenet_v2"
            : "mobilenet_v2";
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
    lastStats.current = {
      elapsed: result.elapsed,
      backend: result.backend,
      model: result.model,
    };
    const {
      source: currentSource,
      settings: currentSettings,
      modal: currentModal,
      cue: currentCue,
    } = state.current;
    if (
      currentSource.type === "camera" &&
      !isFreshFrame(result.capturedAt, performance.now())
    ) {
      setFrame(null);
      rangeTracker.current.suspend();
      setCue({
        title: "Detection is catching up.",
        detail: "Hold still. Do not rely on delayed results.",
      });
      if (currentSettings.speech && !currentModal)
        narratorRef.current.say(
          { key: "delayed", level: "status", speech: "Pause. Detection is delayed." },
          { rate: currentSettings.rate },
        );
      return;
    }
    result = {
      ...result,
      detections: rangeTracker.current.update(
        result.detections,
        result.capturedAt,
        result,
      ),
    };
    setFrame(result);
    setSize((current) =>
      current.width === result.width && current.height === result.height
        ? current
        : { width: result.width, height: result.height },
    );
    setError("");
    const guidance = getGuidance(result.detections);
    const confirmed =
      currentSource.type === "photo"
        ? guidance
        : filter.current.update(guidance);
    if (
      confirmed ||
      !guidance.alert ||
      (currentCue.alert?.range && !guidance.alert?.range)
    ) {
      setCue(guidance);
    }
    if (currentSettings.speech && !currentModal)
      narratorRef.current.say(confirmed?.alert || null, {
        rate: currentSettings.rate,
      });
    if (currentSource.type === "photo") loopRef.current.stop();
  }
  function togglePause() {
    narratorRef.current.stop();
    filter.current.reset();
    rangeTracker.current.suspend();
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
  function openDistance() {
    setRangeTarget("");
    setMeasuredDistance("");
    setMeasurementConfirmed(false);
    setRangeError("");
    setModal("distance");
  }
  function saveDistance(event) {
    event.preventDefault();
    if (state.current.source.type !== "camera" || state.current.paused) {
      setRangeError("Start the live camera before calibrating a distance.");
      return;
    }
    if (!measurementConfirmed) {
      setRangeError(
        "Confirm that you measured the distance to this stationary object.",
      );
      return;
    }
    try {
      rangeTracker.current.calibrate(
        Number(rangeTarget),
        Number(measuredDistance),
        performance.now(),
      );
      setRangeError("");
      setModal(null);
    } catch (cause) {
      setRangeError(cause.message);
    }
  }
  function resumeSavedDistance(id) {
    if (state.current.source.type !== "camera" || state.current.paused) return;
    try {
      rangeTracker.current.resume(Number(id), performance.now());
      setFrame(null);
      setCue({
        title: "Checking the same object…",
        detail: "Restoring your saved calibration, without remeasuring.",
      });
      setRangeError("");
      setModal(null);
    } catch (cause) {
      setRangeError(cause.message);
      setModal("distance");
    }
  }
  function changeModel(value) {
    const next = sanitizeSettings({ ...settings, model: value });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      stopCamera();
      window.location.reload();
    } catch {
      setError(
        "Browser storage is unavailable, so the model setting could not be saved.",
      );
    }
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
          ? paused || (modal && modal !== "distance")
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
  const rangeTargets = (
    source.type === "camera" ? frame?.detections || [] : []
  ).filter((item) =>
    rangeTracker.current.canCalibrate(item.trackId, performance.now()),
  );
  const rangedObject = frame?.detections.find((item) => item.range);
  const savedReference = rangeTracker.current.reference;
  const resumeTargets =
    activeCamera && !paused
      ? (frame?.detections || []).filter((item) =>
          rangeTracker.current.canResume(item.trackId, performance.now()),
        )
      : [];
  const recoveringRange = activeCamera && savedReference && !rangedObject;

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
        <div
          className="cue"
          aria-live={settings.speech ? "off" : "polite"}
          aria-atomic="true"
        >
          <h2>{cue.title}</h2>
          <p>
            {cue.advice
              ? `${roomLabel(cue.alert.class)} ahead. ${cue.advice.message}`
              : cue.detail}
          </p>
        </div>
        <div className="range-status">
          <span>
            {rangedObject
              ? `${roomLabel(rangedObject.class)}: ${rangedObject.range.label} (rough)`
              : savedReference
                ? `${roomLabel(savedReference.class)} calibration saved`
                : cue.proximity || "Distance unknown"}
          </span>
          <button
            onClick={openDistance}
            disabled={paused}
            aria-label="Calibrate distance"
          >
            {savedReference ? "Distance setup" : "Set distance"}
          </button>
        </div>
        {recoveringRange && (
          <div className="range-recovery">
            <p role="status">
              {paused
                ? "Live distance paused. Your calibration is saved."
                : rangeTracker.current.status}
            </p>
            {savedReference.id === null && !paused && (
              <>
                <p>
                  Point at the same {roomLabel(savedReference.class)} and hold
                  still. Confirm it to resume without measuring again.
                </p>
                {resumeTargets.length === 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      resumeSavedDistance(resumeTargets[0].trackId)
                    }
                  >
                    Yes, same {roomLabel(savedReference.class)} — resume
                  </button>
                ) : resumeTargets.length > 1 ? (
                  <button type="button" onClick={openDistance}>
                    Choose the same {roomLabel(savedReference.class)}
                  </button>
                ) : (
                  <p className="note">
                    Waiting for a stable, centered view of the whole object.
                  </p>
                )}
              </>
            )}
          </div>
        )}
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
          Objects can be missed. Ranges are rough and require calibration.
          <br />
          Keep using your usual mobility aids. Do not use for road crossing.
        </p>
      </footer>
      {modal && (
        <Dialog
          title={
            modal === "settings"
              ? "Settings"
              : modal === "distance"
                ? "Distance setup"
                : "About Lantern"
          }
          onClose={() => setModal(null)}
        >
          {modal === "distance" ? (
            <form className="distance-form" onSubmit={saveDistance}>
              <p className="note">
                Optional rough range for one stationary piece of furniture.
                Measure its distance from the camera first, then keep the whole
                object in view at the same angle. This is not a depth sensor.
              </p>
              {!activeCamera && (
                <p className="note">
                  Start the live camera first. Photos cannot be used to
                  calibrate a real distance.
                </p>
              )}
              {savedReference && (
                <section
                  className="saved-reference"
                  aria-label="Saved calibration"
                >
                  <h3>{roomLabel(savedReference.class)} calibration saved</h3>
                  <p>
                    No need to measure again. If this is the same stationary
                    object, select it below and confirm. The old size reference
                    is reused to estimate the current range; the old meter
                    reading is not simply restored.
                  </p>
                  {savedReference.id === null ? (
                    <>
                      <label className="setting">
                        Same object
                        <select
                          aria-label="Same object for saved calibration"
                          value={rangeTarget}
                          onChange={(event) =>
                            setRangeTarget(event.target.value)
                          }
                        >
                          <option value="">Choose the same object</option>
                          {resumeTargets.map((item) => (
                            <option key={item.trackId} value={item.trackId}>
                              {roomLabel(item.class)} · center-
                              {(item.bbox[1] + item.bbox[3]) / 2 < 0.5
                                ? "left"
                                : "right"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="test-voice"
                        disabled={
                          !resumeTargets.some(
                            (item) => item.trackId === Number(rangeTarget),
                          )
                        }
                        onClick={() => resumeSavedDistance(rangeTarget)}
                      >
                        Confirm same object — resume saved range
                      </button>
                      {!resumeTargets.length && (
                        <p className="note">
                          Center the whole {roomLabel(savedReference.class)} at
                          the original angle and hold still.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="note">
                      {rangeTracker.current.status} Brief tracking interruptions
                      recover automatically when the same track is stable again.
                    </p>
                  )}
                  <p className="note">
                    Use a new measurement below only for a different object or a
                    changed lens/view.
                  </p>
                </section>
              )}
              <label className="setting">
                Tracked object
                <select
                  aria-label="Stationary object to calibrate"
                  value={rangeTarget}
                  onChange={(event) => setRangeTarget(event.target.value)}
                >
                  <option value="">Choose an object</option>
                  {rangeTargets.map((item) => (
                    <option key={item.trackId} value={item.trackId}>
                      {roomLabel(item.class)} · center-
                      {(item.bbox[1] + item.bbox[3]) / 2 < 0.5
                        ? "left"
                        : "right"}
                    </option>
                  ))}
                </select>
              </label>
              {!rangeTargets.length && (
                <p className="note">
                  No stable, fully visible furniture yet. Point at a single
                  chair, table, sofa, or bed, center it, and hold still. People
                  and pets cannot be used as range references. Try Fast model if
                  your device struggles.
                </p>
              )}
              <label className="setting">
                Measured distance (meters)
                <input
                  aria-label="Measured distance in meters"
                  type="number"
                  inputMode="decimal"
                  min="0.5"
                  max="8"
                  step="0.1"
                  placeholder="e.g. 2.0"
                  required
                  value={measuredDistance}
                  onChange={(event) => setMeasuredDistance(event.target.value)}
                />
              </label>
              <label className="setting confirmation">
                I measured this distance; the whole object is stationary and
                visible.
                <input
                  aria-label="Confirm measured distance and stationary object"
                  type="checkbox"
                  checked={measurementConfirmed}
                  onChange={(event) =>
                    setMeasurementConfirmed(event.target.checked)
                  }
                />
              </label>
              {rangeError && (
                <p className="error" role="alert">
                  {rangeError}
                </p>
              )}
              <button
                className="test-voice"
                type="submit"
                disabled={
                  !rangeTarget || !measuredDistance || !measurementConfirmed
                }
              >
                Use measured distance
              </button>
              <button
                className="clear-range"
                type="button"
                onClick={() => {
                  rangeTracker.current.clearCalibration();
                  setFrame(null);
                  setCue({
                    title: "Checking view…",
                    detail: "Calibration cleared. Distance unknown.",
                  });
                  setModal(null);
                }}
              >
                Clear calibration
              </button>
              <p className="note">
                Your measurement stays saved during this camera session even
                when the object leaves the frame. Live meters disappear while
                tracking is uncertain. Brief dropouts recover after stable
                frames; longer losses require confirming the same object, not
                remeasuring. Stopping/switching the camera, changing
                orientation, or reloading clears the reference. This is not
                identity recognition: it cannot detect every zoom, angle change,
                or object swap. Never use the number to decide whether a route
                is safe.
              </p>
            </form>
          ) : modal === "settings" ? (
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
              <p className="note">
                Ordinary updates finish their sentence before the next message.
                Only a higher-priority central warning may interrupt. Repeat does
                not restart speech already playing. When voice alerts are on,
                the changing guidance card does not also announce every update
                through your screen reader.
              </p>
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
              <label className="setting model-setting">
                Detection model
                <select
                  aria-label="Detection model"
                  value={settings.model}
                  onChange={(event) => changeModel(event.target.value)}
                >
                  <option value="detail">Detail · larger download</option>
                  <option value="fast">Fast · lighter model</option>
                </select>
              </label>
              <p className="note">
                Detail uses the more accurate COCO-SSD MobileNet V2 variant;
                Fast uses Lite MobileNet V2. Switching restarts the page and
                camera. Neither is certified for safe navigation.
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
                ahead. Pause.” Directions say where to check, not where it is
                safe to step. An object filling the center may trigger a pause
                cue, but image size alone is not distance. Left/right labels
                refer to the camera image, including the unmirrored front
                camera.
              </p>
              <p>
                Unchanged alerts are quiet. A persistent prominent central
                object may repeat after 12 seconds. The app never says a side is
                safe or tells you to step into an unverified path. Less detected
                coverage only suggests a side to inspect.
              </p>
              <p>
                The pretrained COCO-SSD model is filtered to people, furniture,
                pets, and floor-level bags. Laptops, TVs, keyboards, and other
                small desk items are hidden from boxes and speech. This is
                category filtering, not custom training. It misses hazards such
                as steps, holes, glass, and objects outside its training
                categories. It cannot replace a cane, guide dog, or other
                mobility support.
              </p>
              <p>
                Without calibration, size changes are described as getting
                larger/smaller in view; this is not measured motion or depth.
                Optional distance setup uses a known measured range and the size
                ratio of the same stationary object. It rounds estimates to 0.5
                m and withholds readings for inconsistent views. The measured
                reference survives tracking loss, pause, and settings; confirm
                the same object to resume after a longer loss without
                remeasuring. Accuracy is not validated, and other objects remain
                unmeasured.
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
              {lastStats.current && (
                <p className="note">
                  Last inference: {lastStats.current.elapsed} ms ·{" "}
                  {lastStats.current.backend} ·{" "}
                  {lastStats.current.model === "mobilenet_v2"
                    ? "Detail"
                    : "Fast"}{" "}
                  · this is not total camera-to-alert latency.
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
