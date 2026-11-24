/** El codec que el teléfono ya tiene. mp4 en Safari; webm vp8 antes que vp9. */
export function pickRecorderMime() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

export function extensionFor(mime: string) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export function recorderOptions(mimeType: string | undefined): MediaRecorderOptions | undefined {
  if (!mimeType) return undefined;
  return { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 96_000 };
}
