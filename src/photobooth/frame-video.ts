import { evenFrameSize, paintFrame, type Facing, type FrameStamp } from "./frame-paint";
import { pickRecorderMime, recorderOptions } from "./record-mime";

/** Tope para no dejar el fotomatón en «Preparando el video…». */
const PREP_LIMIT_MS = 7000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const limit = Math.max(0, ms);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), limit);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("timeout"));
      },
    );
  });
}

/**
 * La vista en vivo no pasa por aquí. El marco se quema solo al cerrar el video,
 * para no recomponer cada frame mientras la persona habla.
 * Si no termina en unos segundos, devuelve null y se puede seguir con el video crudo.
 */
export async function frameVideo(raw: Blob, frame: HTMLImageElement, facing: Facing, stamp?: FrameStamp | null) {
  if (!raw.size || !frame.naturalWidth || typeof MediaRecorder === "undefined") return null;
  const deadline = performance.now() + PREP_LIMIT_MS;
  const left = () => Math.max(0, deadline - performance.now());
  const audioContext = new AudioContext();
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.preload = "auto";
  const url = URL.createObjectURL(raw);
  video.src = url;
  let recorder: MediaRecorder | null = null;
  let drawTimer = 0;

  try {
    const bytes = await withTimeout(raw.arrayBuffer(), left());
    const decoded = await withTimeout(audioContext.decodeAudioData(bytes), left());
    const source = audioContext.createBufferSource();
    source.buffer = decoded;
    const dest = audioContext.createMediaStreamDestination();
    source.connect(dest);

    const size = evenFrameSize(frame);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("video"));
      }),
      left(),
    );

    const canvasStream = canvas.captureStream(24);
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mimeType = pickRecorderMime();
    try {
      const options = recorderOptions(mimeType);
      recorder = options ? new MediaRecorder(mixed, options) : new MediaRecorder(mixed);
    } catch {
      return null;
    }
    const chunks: Blob[] = [];
    const active = recorder;
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const done = new Promise<Blob | null>((resolve) => {
      active.onstop = () => {
        const mime = active.mimeType || chunks[0]?.type || "video/webm";
        const blob = new Blob(chunks, { type: mime });
        resolve(blob.size > 0 ? blob : null);
      };
      active.onerror = () => resolve(null);
    });
    let last = 0;
    const draw = (now: number) => {
      if (video.ended || performance.now() >= deadline) return;
      if (now - last >= 1000 / 24) {
        last = now;
        paintFrame(context, video, frame, facing, size, stamp);
      }
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => draw(performance.now()));
      }
    };
    paintFrame(context, video, frame, facing, size, stamp);
    active.start(1000);
    source.start(0);
    await withTimeout(video.play(), Math.min(2000, left()));
    if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => draw(performance.now()));
    else {
      drawTimer = window.setInterval(() => {
        if (video.ended || performance.now() >= deadline) window.clearInterval(drawTimer);
        else paintFrame(context, video, frame, facing, size, stamp);
      }, 1000 / 24);
    }
    const audioSeconds = source.buffer?.duration;
    const videoSeconds = video.duration;
    const seconds = Number.isFinite(audioSeconds) && audioSeconds > 0
      ? audioSeconds
      : Number.isFinite(videoSeconds) && videoSeconds > 0
        ? videoSeconds
        : 4;
    const playLimit = Math.min(left(), Math.ceil((seconds + 0.4) * 1000));
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, Math.max(0, playLimit));
      video.onended = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });
    const played = video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.25);
    if (!played) return null;
    if (!video.ended) video.pause();
    paintFrame(context, video, frame, facing, size, stamp);
    if (active.state !== "inactive") active.stop();
    return await withTimeout(done, Math.min(2000, Math.max(400, left())));
  } catch {
    return null;
  } finally {
    if (drawTimer) window.clearInterval(drawTimer);
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* Ya estaba cerrado. */
      }
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    await audioContext.close().catch(() => undefined);
  }
}
