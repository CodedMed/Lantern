export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function requestCamera(mediaDevices, isCurrent = () => true) {
  if (!mediaDevices?.getUserMedia)
    throw new Error("Camera API unavailable; HTTPS is required.");
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 960 },
      height: { ideal: 720 },
    },
  });
  // A camera request can resolve after the user leaves or switches sources.
  if (!isCurrent()) {
    stopStream(stream);
    return null;
  }
  return stream;
}
