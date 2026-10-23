// Pure preference validation shared by the browser and native apps.
export const DEFAULT_SETTINGS = Object.freeze({
  speech: true,
  rate: 0.95,
  contrast: false,
  largeText: false,
  threshold: 0.5,
  model: "detail",
});
export const SETTINGS_KEY = "lantern.preferences.v1";
export function sanitizeSettings(value = {}) {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  return {
    speech: typeof value.speech === "boolean" ? value.speech : true,
    contrast: value.contrast === true,
    largeText: value.largeText === true,
    model: value.model === "fast" ? "fast" : "detail",
    rate: Number.isFinite(value.rate)
      ? Math.min(1.5, Math.max(0.6, value.rate))
      : DEFAULT_SETTINGS.rate,
    threshold: Number.isFinite(value.threshold)
      ? Math.min(0.85, Math.max(0.35, value.threshold))
      : DEFAULT_SETTINGS.threshold,
  };
}
export function readSettings(storage) {
  try {
    return sanitizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
