import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detector } from "./detector.mjs";
import { requestCamera, stopStream } from "./camera.mjs";
import { describeScene, SAFETY_NOTE } from "../../utils/scene.mjs";
import {
  readSettings,
  sanitizeSettings,
  SETTINGS_KEY,
} from "../../utils/preferences.mjs";
import "./style.css";

const SAMPLE = "/sample-scene.jpg";
const COLORS = ["#b8efc5", "#ffd48b", "#b9d9ff", "#e8c5ff"];

function Icon({ name, size = 20 }) {
  const paths = {
    camera: (
      <>
        <path d="m14 4 2 3h4a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2h4l2-3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5" />
      </>
    ),
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sparkle: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.sparkle}
    </svg>
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
  const [source, setSource] = useState({
    type: "sample",
    url: SAMPLE,
    name: "Sample scene",
  });
  const [dimensions, setDimensions] = useState({ width: 640, height: 425 });
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("Ready when you are");
  const [busy, setBusy] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const [modal, setModal] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const imageRef = useRef(null),
    videoRef = useRef(null),
    fileRef = useRef(null);
  const streamRef = useRef(null),
    generation = useRef(0),
    inFlight = useRef(false);
  const alive = useRef(true),
    lastSpoken = useRef(""),
    lastSpokenAt = useRef(0);
  const dialogRef = useRef(null),
    lastFocus = useRef(null);
  const speechAvailable =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private browsing */
    }
    if (!settings.speech) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }, [settings]);
  useEffect(() => {
    alive.current = true;
    const onHidden = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      alive.current = false;
      generation.current += 1;
      stopStream(streamRef.current);
      window.speechSynthesis?.cancel();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
  useEffect(() => {
    if (source.type === "upload") return () => URL.revokeObjectURL(source.url);
  }, [source]);
  useEffect(() => {
    if (!modal) return;
    lastFocus.current = document.activeElement;
    dialogRef.current?.showModal();
    return () => {
      lastFocus.current?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (!auto || source.type !== "camera" || !cameraReady || busy) return;
    const timer = setTimeout(() => scan(), 1800);
    return () => clearTimeout(timer);
  }, [auto, source.type, cameraReady, busy, result, settings.threshold]);

  function update(key, value) {
    setSettings((current) => sanitizeSettings({ ...current, [key]: value }));
  }
  function stopSpeech() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }
  function speak(text, automatic = false) {
    if (!speechAvailable || !settings.speech) return;
    if (
      automatic &&
      (text === lastSpoken.current || Date.now() - lastSpokenAt.current < 7000)
    )
      return;
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = settings.rate;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = utterance.onerror = () => {
      if (alive.current) setSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
    lastSpoken.current = text;
    lastSpokenAt.current = Date.now();
  }
  function stopCamera() {
    generation.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    setAuto(false);
    setCameraReady(false);
    setCameraPending(false);
    setBusy(false);
    setResult(null);
    setSource({ type: "sample", url: SAMPLE, name: "Sample scene" });
    setStatus("Camera off. Try the sample or upload an image.");
    stopSpeech();
  }
  function selectImage(next) {
    stopCamera();
    setError("");
    setSource(next);
    setDimensions({ width: 640, height: 425 });
    setStatus("Image ready to scan");
  }
  async function startCamera() {
    if (cameraPending || inFlight.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera access needs HTTPS and a supported browser. Try uploading a photo instead.",
      );
      return;
    }
    const token = ++generation.current;
    setCameraPending(true);
    setError("");
    stopSpeech();
    try {
      const stream = await requestCamera(
        navigator.mediaDevices,
        () => generation.current === token && alive.current,
      );
      if (!stream) return;
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (generation.current === token && alive.current) {
            stopCamera();
            setError("Camera disconnected. Reopen it or use a photo.");
          }
        };
      });
      setResult(null);
      setSource({ type: "camera", name: "Live camera" });
      setStatus("Starting camera…");
    } catch (cause) {
      if (generation.current !== token) return;
      const denied =
        cause.name === "NotAllowedError" || cause.name === "SecurityError";
      setError(
        denied
          ? "Camera access was not granted. Allow it in your browser settings, or use a sample or photo."
          : "Could not open a camera. It may be in use by another app. Use a sample or photo instead.",
      );
    } finally {
      if (generation.current === token) setCameraPending(false);
    }
  }
  useEffect(() => {
    if (source.type !== "camera" || !videoRef.current || !streamRef.current)
      return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video
      .play()
      .catch(() => setError("Tap the video to start the camera preview."));
  }, [source]);

  async function scan() {
    if (inFlight.current) return;
    const element =
      source.type === "camera" ? videoRef.current : imageRef.current;
    if (
      !element ||
      (source.type === "camera"
        ? !cameraReady
        : !element.complete || !element.naturalWidth)
    ) {
      setError("Wait for the image or camera preview to load, then try again.");
      return;
    }
    const token = generation.current;
    // Capture a stable, bounded frame before any asynchronous model loading.
    const width = element.videoWidth || element.naturalWidth;
    const height = element.videoHeight || element.naturalHeight;
    const scale = Math.min(1, 960 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext("2d")
      .drawImage(element, 0, 0, canvas.width, canvas.height);
    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setStatus("Recognizing objects…");
    try {
      const detection = await detector.detect(
        canvas,
        settings.threshold,
        (message) => {
          if (alive.current && token === generation.current) setStatus(message);
        },
      );
      if (!alive.current || token !== generation.current) return;
      const scene = describeScene(detection.detections);
      setResult({ ...detection, ...scene });
      setStatus("Scan complete");
      speak(scene.speech, auto);
    } catch (cause) {
      if (alive.current && token === generation.current) {
        setError(
          "Recognition failed. Check your connection and retry. If your browser has limited graphics support, try Chrome or Safari.",
        );
        setStatus("Scan not completed");
        setAuto(false);
      }
      console.error("Lantern scan failed:", cause);
    } finally {
      canvas.width = canvas.height = 1;
      inFlight.current = false;
      if (alive.current && token === generation.current) setBusy(false);
    }
  }
  function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
        file.type,
      )
    ) {
      setError(
        "Choose a JPG, PNG, WebP, or AVIF image. Convert HEIC photos to JPG first.",
      );
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Choose an image under 15 MB.");
      return;
    }
    selectImage({
      type: "upload",
      url: URL.createObjectURL(file),
      name: file.name,
    });
  }
  const readyToScan = source.type !== "camera" || cameraReady;
  return (
    <div
      className={`app ${settings.contrast ? "high-contrast" : ""} ${settings.largeText ? "large-text" : ""}`}
    >
      <a className="skip-link" href="#workspace">
        Skip to scanner
      </a>
      <header className="header shell">
        <a className="brand" href="#" aria-label="Lantern home">
          <img src="/lantern.svg" alt="" />
          lantern<span className="beta">DEMO</span>
        </a>
        <nav aria-label="Main navigation">
          <button className="nav-button" onClick={() => setModal("help")}>
            How it works
          </button>
          <button
            className="nav-button"
            aria-label="Settings"
            onClick={() => setModal("settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <a
            className="source-link"
            href="https://github.com/CodedMed/Lantern"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>
      <main className="shell">
        <section className="intro">
          <div>
            <p className="eyebrow">
              <span className="dot" /> A NEW PERSPECTIVE, IN YOUR POCKET
            </p>
            <h1>
              See a little
              <br />
              <em>differently.</em>
            </h1>
          </div>
          <div className="intro-copy">
            <p>
              Turn the things around you into words.
              <br />
              Point your camera, take a breath, and listen.
            </p>
            <span className="privacy">
              <Icon name="shield" size={16} /> Images stay on your device
            </span>
          </div>
        </section>
        <section
          className="workspace"
          id="workspace"
          aria-label="Object recognition scanner"
        >
          <div className="viewer-card">
            <div className="viewer-top">
              <span>
                <span
                  className={`dot ${source.type === "camera" ? "live" : ""}`}
                />
                {source.type === "camera"
                  ? "LIVE CAMERA"
                  : source.type === "sample"
                    ? "SAMPLE SCENE"
                    : "YOUR PHOTO"}
              </span>
              <span>ON-DEVICE VISION</span>
            </div>
            <div
              className="viewport"
              style={{
                aspectRatio: `${dimensions.width} / ${dimensions.height}`,
              }}
            >
              {source.type === "camera" ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label="Live camera preview"
                  onClick={() => videoRef.current?.play()}
                  onLoadedData={() => {
                    setDimensions({
                      width: videoRef.current.videoWidth,
                      height: videoRef.current.videoHeight,
                    });
                    setCameraReady(true);
                    setStatus("Camera ready. Tap Scan scene.");
                  }}
                />
              ) : (
                <img
                  ref={imageRef}
                  src={source.url}
                  alt={
                    source.type === "sample"
                      ? "People flying kites on a beach, from the TensorFlow.js model demo"
                      : "Your selected image for local object recognition"
                  }
                  onLoad={(event) =>
                    setDimensions({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  onError={() =>
                    setError(
                      "This image could not be opened. Choose another JPG or PNG.",
                    )
                  }
                />
              )}
              {result?.objects.map((object, index) => (
                <div
                  key={index}
                  className="box"
                  style={{
                    left: `${object.bbox[1] * 100}%`,
                    top: `${object.bbox[0] * 100}%`,
                    width: `${(object.bbox[3] - object.bbox[1]) * 100}%`,
                    height: `${(object.bbox[2] - object.bbox[0]) * 100}%`,
                    "--box-color": COLORS[index % COLORS.length],
                  }}
                >
                  <span>
                    {object.class} · {Math.round(object.score * 100)}%
                  </span>
                </div>
              ))}
              {busy && (
                <div className="scanning" aria-hidden="true">
                  <div className="scan-line" />
                  <span>
                    <span className="spinner" /> Looking a little closer
                  </span>
                </div>
              )}
              {!result && !busy && source.type === "sample" && (
                <div className="image-caption">
                  Real image. Real detection. Give it a try.
                </div>
              )}
            </div>
            <div className="viewer-bottom">
              <span>{source.name}</span>
              {source.type === "camera" ? (
                <button className="text-button" onClick={stopCamera}>
                  Stop camera
                </button>
              ) : (
                <span>No camera permission needed</span>
              )}
            </div>
          </div>
          <aside className="insight-card" aria-label="Scene description">
            <p className="eyebrow">THE WORLD, IN WORDS</p>
            <div className="status" role="status" aria-live="polite">
              <span className={busy ? "spinner" : "dot"} />
              {status}
            </div>
            <div className="description">
              <h2>
                {result
                  ? result.objects.length
                    ? `${result.objects.length} object${result.objects.length === 1 ? "" : "s"} recognized.`
                    : "A little uncertain."
                  : "What’s around you?"}
              </h2>
              <p>
                {result
                  ? result.message
                  : "Try the sample scene, upload a photo, or open your camera. Lantern will describe the objects it recognizes."}
              </p>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary"
              disabled={busy || cameraPending || !readyToScan}
              onClick={scan}
            >
              <Icon
                name={
                  source.type === "sample" && !result ? "sparkle" : "camera"
                }
              />
              {busy
                ? "Recognizing…"
                : source.type === "sample" && !result
                  ? "Try the demo"
                  : "Scan scene"}
              {!busy && <Icon name="arrow" />}
            </button>
            <div className="input-actions">
              <button
                className="button secondary"
                disabled={busy || cameraPending}
                onClick={source.type === "camera" ? stopCamera : startCamera}
              >
                <Icon name="camera" />
                {cameraPending
                  ? "Opening…"
                  : source.type === "camera"
                    ? "Stop camera"
                    : "Use camera"}
              </button>
              <button
                className="button secondary"
                disabled={busy || cameraPending}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" />
                Upload photo
              </button>
              <input
                className="visually-hidden"
                type="file"
                ref={fileRef}
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={onUpload}
                tabIndex={-1}
                aria-label="Choose a photo"
              />
            </div>
            {source.type !== "sample" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  selectImage({
                    type: "sample",
                    url: SAMPLE,
                    name: "Sample scene",
                  })
                }
              >
                Use sample scene instead
              </button>
            )}
            <div className="speech-controls">
              <button
                className="text-button"
                aria-pressed={settings.speech}
                disabled={!speechAvailable}
                onClick={() => update("speech", !settings.speech)}
              >
                <Icon name="sound" size={17} />
                {!speechAvailable
                  ? "Speech unavailable"
                  : settings.speech
                    ? "Spoken descriptions on"
                    : "Spoken descriptions off"}
              </button>
              {result && settings.speech && speechAvailable && (
                <button
                  className="text-button"
                  onClick={() =>
                    speaking ? stopSpeech() : speak(result.speech)
                  }
                >
                  {speaking ? "Stop speech" : "Read again"}
                </button>
              )}
            </div>
            {source.type === "camera" && (
              <label className="toggle-row">
                <span>
                  Auto-scan <small>One scan at a time</small>
                </span>
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(event) => {
                    setAuto(event.target.checked);
                    if (!event.target.checked) stopSpeech();
                  }}
                />
              </label>
            )}
          </aside>
        </section>
        {result && (
          <section className="results" aria-labelledby="objects-title">
            <div className="results-heading">
              <h2 id="objects-title">In this frame</h2>
              <span>
                {result.elapsed.toLocaleString()} ms inference ·{" "}
                {result.backend === "webgl" ? "GPU" : "CPU"} · COCO-SSD
              </span>
            </div>
            <div className="object-list">
              {result.objects.length ? (
                result.objects.map((object, index) => (
                  <div className="object-row" key={index}>
                    <span
                      className="object-number"
                      style={{ color: COLORS[index % COLORS.length] }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <strong>{object.class}</strong>
                    <span>{object.position}</span>
                    <span>{Math.round(object.score * 100)}% confidence</span>
                  </div>
                ))
              ) : (
                <p>
                  No supported objects met the confidence threshold. Try better
                  lighting or another angle.
                </p>
              )}
            </div>
            <p className="fine-print">
              Confidence is the model’s score, not a guarantee of correctness.
              Positions refer to the image, not your route.
            </p>
          </section>
        )}
        <section className="features" aria-label="About Lantern">
          <article>
            <span className="feature-number">01 / LOOK</span>
            <h3>Everyday awareness.</h3>
            <p>
              Recognize people, pets, furniture, and other common objects in a
              single frame.
            </p>
          </article>
          <article>
            <span className="feature-number">02 / LISTEN</span>
            <h3>A voice for your view.</h3>
            <p>
              Hear object names and image positions. Adjust speech speed,
              contrast, and text size.
            </p>
          </article>
          <article>
            <span className="feature-number">03 / STAY PRIVATE</span>
            <h3>Your view stays yours.</h3>
            <p>
              Recognition runs in your browser. No account, image uploads, or
              API key required.
            </p>
          </article>
        </section>
        <p className="safety">
          <strong>A little awareness. Not a safety guarantee.</strong>{" "}
          {SAFETY_NOTE}
        </p>
      </main>
      <footer className="shell footer">
        <span>lantern / built with a brighter perspective</span>
        <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
          Model & image credits ↗
        </a>
      </footer>
      {modal && (
        <dialog
          ref={dialogRef}
          className="modal"
          onCancel={() => setModal(null)}
          onClose={() => setModal(null)}
          onClick={(event) => {
            if (event.target === dialogRef.current) setModal(null);
          }}
        >
          <div className="modal-header">
            <h2>
              {modal === "settings"
                ? "Make it yours."
                : "A clearer way to try Lantern."}
            </h2>
            <button
              className="icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          {modal === "settings" ? (
            <div className="settings-content">
              <label className="toggle-row">
                <span>Spoken descriptions</span>
                <input
                  type="checkbox"
                  checked={settings.speech}
                  disabled={!speechAvailable}
                  onChange={(event) => update("speech", event.target.checked)}
                />
              </label>
              <label className="range-row">
                Speech speed <output>{settings.rate.toFixed(2)}×</output>
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
                className="button secondary"
                disabled={!settings.speech || !speechAvailable}
                onClick={() =>
                  speak(
                    "Hello from Lantern. This is your spoken description speed.",
                  )
                }
              >
                Test voice
              </button>
              <label className="toggle-row">
                <span>High contrast</span>
                <input
                  type="checkbox"
                  checked={settings.contrast}
                  onChange={(event) => update("contrast", event.target.checked)}
                />
              </label>
              <label className="toggle-row">
                <span>Larger text</span>
                <input
                  type="checkbox"
                  checked={settings.largeText}
                  onChange={(event) =>
                    update("largeText", event.target.checked)
                  }
                />
              </label>
              <label className="range-row">
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
              <p className="fine-print">
                Higher thresholds hide uncertain detections, but may miss more
                objects. Settings save in this browser. Rescan to apply a new
                threshold.
              </p>
            </div>
          ) : (
            <div className="help-content">
              <ol>
                <li>
                  <strong>Try the demo.</strong> The bundled sample runs through
                  the same real model as your photos. Initial model download can
                  take a moment.
                </li>
                <li>
                  <strong>Bring your own view.</strong> Open the camera over
                  HTTPS or upload a JPG, PNG, WebP, or AVIF. Nothing is sent to
                  a recognition server.
                </li>
                <li>
                  <strong>Listen and explore.</strong> Scan again, replay the
                  spoken description, or enable auto-scan with the camera. Use
                  Settings for larger text and higher contrast.
                </li>
              </ol>
              <h3>What it can—and can’t—do</h3>
              <p>
                Lantern uses the pretrained COCO-SSD / Lite MobileNet V2 model
                with 80 supported object categories. It is not a custom-trained
                YOLO model. It does not read signs, estimate reliable distance,
                or find a safe walking route.
              </p>
              <p>
                Model files download from Google’s public model hosting. Browser
                speech uses your device’s speech service, which may depend on
                the operating system or selected voice. Camera frames and
                uploaded photos are not stored by Lantern.
              </p>
              <p className="safety">
                {SAFETY_NOTE} Do not use this demo to cross roads or replace
                established mobility aids.
              </p>
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="shell">
        <h1>Let’s try that again.</h1>
        <p>
          Lantern could not start in this browser. Reload, or try a current
          version of Chrome or Safari.
        </p>
        <button onClick={() => window.location.reload()}>Reload Lantern</button>
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
