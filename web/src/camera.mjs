export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function requestCamera(
  mediaDevices,
  isCurrent = () => true,
  facing = "environment",
) {
  if (!mediaDevices?.getUserMedia)
    throw new Error("Camera API unavailable; HTTPS is required.");
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 640 },
      height: { ideal: 960 },
      frameRate: { ideal: 24, max: 30 },
    },
  });
  // A camera request can resolve after the user leaves or switches sources.
  if (!isCurrent()) {
    stopStream(stream);
    return null;
  }
  return stream;
}
