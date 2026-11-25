import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { acquireCamera, cameraAccepted, holdCamera, tuneCamera, type Facing } from "./camera-session";
import { coverRect, paintFrame, type FrameStamp } from "./frame-paint";
import { frameVideo } from "./frame-video";
import { allFrameSources, orderedFrames, type BodaFrame } from "./frames";
import { FALLAS, fallaDeCamara, type Falla } from "./fallas";
import { BODA_PROPS, propBox, propById, propPieces, propSources } from "./props";
import { extensionFor, pickRecorderMime, recorderOptions } from "./record-mime";
import { deliverFromGesture, trySilentDirectorySave } from "./save-to-phone";
import { enqueueFiles, retryUploads, useUploadStatus } from "./storage";
import { config, assetPath } from "../config";

type Mode = "entry" | "photos" | "message";

type Shot = {
  url: string;
  file: File;
  kind: "foto" | "video";
  portrait: boolean;
  framed: boolean;
};

type Clip = { url: string; file: File };

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Activa el permiso de la cámara para usar el fotomatón.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No encontramos una cámara en este dispositivo.";
  if (name === "NotReadableError" || name === "TrackStartError") return "La cámara está ocupada. Ciérrala en la otra app e inténtalo de nuevo.";
  if (!navigator.mediaDevices?.getUserMedia) return "Abre el fotomatón desde el celular.";
  return "No se pudo abrir la cámara.";
}

function stamp() {
  const date = new Date();
  const part = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}${part(date.getMilliseconds(), 3)}`;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob && blob.size > 0 ? resolve(blob) : reject(new Error("vacío"))), type, quality);
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

function jpegFromCanvas(canvas: HTMLCanvasElement) {
  try {
    const data = canvas.toDataURL("image/jpeg", 0.85);
    const encoded = data.split(",")[1] || "";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** El PNG del marco entra entero. El margen evita que el borde quede fuera de la pantalla. */
function fitFrame(boxW: number, boxH: number, aspect: number) {
  const margin = 6;
  const innerW = Math.max(0, boxW - margin * 2);
  const innerH = Math.max(0, boxH - margin * 2);
  if (innerW <= 0 || innerH <= 0) return { width: 0, height: 0 };
  if (innerW / innerH > aspect) {
    const height = innerH;
    return { width: height * aspect, height };
  }
  const width = innerW;
  return { width, height: width / aspect };
}

function Chevron({ direction, compact }: { direction: "left" | "right"; compact?: boolean }) {
  const path = direction === "left" ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5";
  return (
    <svg viewBox="0 0 24 24" className={compact ? "h-3 w-3" : "h-5 w-5"} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Photobooth() {
  const [mode, setMode] = useState<Mode>("entry");
  const [fallaTag, setFallaTag] = useState("");
  const [portrait, setPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);
  const frames = useMemo(() => orderedFrames(portrait), [portrait]);
  const [frameId, setFrameId] = useState(() => orderedFrames(window.matchMedia("(orientation: portrait)").matches)[0].id);
  const [facing, setFacing] = useState<Facing>("user");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [messageCamera, setMessageCamera] = useState(false);
  const [message, setMessage] = useState("");
  const [clip, setClip] = useState<Clip | null>(null);
  const [clipDelivered, setClipDelivered] = useState(false);
  const [sending, setSending] = useState(false);
  const [shotDelivered, setShotDelivered] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [propId, setPropId] = useState("");
  const [captureKind, setCaptureKind] = useState<"foto" | "video">("foto");
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const { line, failed } = useUploadStatus();

  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const framesRef = useRef(frames);
  const frameIdRef = useRef(frameId);
  const facingRef = useRef(facing);
  const dragRef = useRef(0);
  const draggingRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });
  const pendingId = useRef("");
  const recordingRef = useRef(false);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const portraitRef = useRef(portrait);
  const shotRef = useRef<Shot | null>(null);
  const clipRef = useRef<Clip | null>(null);
  const countdownRef = useRef(0);
  const countdownToken = useRef(0);
  const cameraErrorRef = useRef("");
  const modeRef = useRef(mode);
  const propsOpenRef = useRef(false);
  const propIdRef = useRef("");

  framesRef.current = frames;
  frameIdRef.current = frameId;
  facingRef.current = facing;
  dragRef.current = drag;
  portraitRef.current = portrait;
  shotRef.current = shot;
  clipRef.current = clip;
  modeRef.current = mode;
  propsOpenRef.current = propsOpen;
  propIdRef.current = propId;
  cameraErrorRef.current = cameraError;

  const index = Math.max(0, frames.findIndex((frame) => frame.id === frameId));
  const current = frames[index] ?? frames[0];
  const previous = frames[(index - 1 + frames.length) % frames.length];
  const next = frames[(index + 1) % frames.length];
  const showPhotoCamera = mode === "photos";
  const showMessageCamera = mode === "message" && messageCamera;

  useEffect(() => {
    document.title = `Fotomatón · ${config.eventName}`;
  }, []);

  function markFalla(falla: Falla, _refresh = false) {
    setFallaTag(falla.tag);
    return falla.tag;
  }

  useEffect(() => {
    const media = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(media.matches);
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    setDrag(0);
    setAnimate(false);
    pendingId.current = "";
    setFrameId((id) => (frames.some((frame) => frame.id === id) ? id : frames[0].id));
  }, [portrait, frames]);

  useEffect(() => {
    let cancel = false;
    const mark = (src: string, image: HTMLImageElement) => {
      imagesRef.current[src] = image;
      if (!cancel) setLoaded((currentLoaded) => ({ ...currentLoaded, [src]: true }));
    };
    [...allFrameSources(), ...propSources()].forEach((src) => {
      const cached = imagesRef.current[src];
      if (cached?.complete && cached.naturalWidth) {
        mark(src, cached);
        return;
      }
      const image = new Image();
      image.decoding = "async";
      image.onload = () => mark(src, image);
      image.src = src;
      if (image.complete && image.naturalWidth) mark(src, image);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const framePortrait = shot && mode === "photos" ? shot.portrait : portrait;
  const frameAspect = framePortrait ? 2160 / 3840 : 3840 / 2160;

  useLayoutEffect(() => {
    const well = wellRef.current;
    if (!well) return;
    const measure = () => {
      const rect = well.getBoundingClientRect();
      const view = window.visualViewport;
      const width = Math.min(rect.width, view?.width || rect.width);
      const height = Math.min(rect.height, view?.height || rect.height);
      setStage(fitFrame(width, height, frameAspect));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(well);
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [frameAspect, messageCamera, mode]);

  useEffect(() => {
    const wantsCamera = mode === "photos" || (mode === "message" && messageCamera);
    if (!wantsCamera) return;
    let cancel = false;
    const release = holdCamera();
    setCameraError("");
    acquireCamera(facing, portraitRef.current)
      .then(async (stream) => {
        if (cancel) return;
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        if (video.srcObject !== stream) video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (!cancel) {
          if (video.videoWidth) setSourceSize({ width: video.videoWidth, height: video.videoHeight });
          setCameraReady(true);
        }
      })
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCameraReady(false);
        setCameraError(cameraMessage(error));
        markFalla(fallaDeCamara(error));
      });
    return () => {
      cancel = true;
      release();
      setCameraReady(false);
    };
  }, [facing, messageCamera, mode]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    void tuneCamera(stream, facingRef.current, portrait);
  }, [portrait]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().then(() => {
      if (video.videoWidth) setSourceSize({ width: video.videoWidth, height: video.videoHeight });
      setCameraReady(true);
    }).catch(() => undefined);
  }, [facing, messageCamera, mode, stage.width]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setNotice((current) => {
        if (!current.startsWith("Preparando")) return current;
        markFalla(FALLAS.videoPreparar, false);
        return "";
      });
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    function hide() {
      if (document.visibilityState === "hidden") stopRecordingRef.current?.();
    }
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
      countdownToken.current += 1;
      stopRecordingRef.current?.();
    };
  }, []);

  function frameNow() {
    const list = framesRef.current;
    return list.find((frame) => frame.id === frameIdRef.current) || list[0];
  }

  function blocked() {
    return recordingRef.current || countdownRef.current > 0 || Boolean(shotRef.current);
  }

  function neighborId(direction: 1 | -1) {
    const list = framesRef.current;
    const currentIndex = Math.max(0, list.findIndex((frame) => frame.id === frameIdRef.current));
    return list[(currentIndex + direction + list.length) % list.length].id;
  }

  function propsActive() {
    return propsOpenRef.current;
  }

  function commit(direction: 1 | -1) {
    if (blocked() || pendingId.current) return;
    const width = wellRef.current ? stage.width : 0;
    const id = neighborId(direction);
    if (!width) {
      setFrameId(id);
      setDrag(0);
      return;
    }
    pendingId.current = id;
    setAnimate(true);
    setDrag(direction === 1 ? -width : width);
  }

  function onTransitionEnd(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    const id = pendingId.current;
    if (!id) return;
    pendingId.current = "";
    setAnimate(false);
    setFrameId(id);
    setDrag(0);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (blocked() || pendingId.current) return;
    draggingRef.current = true;
    originRef.current = { x: event.clientX, y: event.clientY };
    dragRef.current = 0;
    setAnimate(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function commitProp(direction: 1 | -1) {
    if (recordingRef.current || countdownRef.current || shotRef.current) return;
    const list = [...BODA_PROPS, null];
    const found = list.findIndex((prop) => (prop?.id || "") === propIdRef.current);
    const currentIndex = found < 0 ? 0 : found;
    const next = list[(currentIndex + direction + list.length) % list.length];
    const id = next?.id || "";
    propIdRef.current = id;
    setPropId(id);
  }

  function nudge(direction: 1 | -1) {
    if (propsActive()) commitProp(direction);
    else commit(direction);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const dx = event.clientX - originRef.current.x;
    const dy = event.clientY - originRef.current.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 16) return;
    dragRef.current = dx;
    if (propsActive()) return;
    setDrag(dx);
  }

  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const dx = dragRef.current;
    if (propsActive()) {
      if (dx <= -48) commitProp(1);
      else if (dx >= 48) commitProp(-1);
      return;
    }
    if (dx <= -48) commit(1);
    else if (dx >= 48) commit(-1);
    else {
      setAnimate(true);
      setDrag(0);
    }
  }

  function activeStamp(): FrameStamp | null {
    if (!propsOpenRef.current) return null;
    const prop = propById(propIdRef.current);
    if (!prop) return null;
    const image = imagesRef.current[prop.src];
    if (!image?.naturalWidth) return null;
    if (propPieces(prop).some((piece) => piece.src !== prop.src && !imagesRef.current[piece.src]?.naturalWidth)) return null;
    return { image, prop, images: imagesRef.current };
  }

  function toggleProps() {
    if (blocked()) return;
    const open = !propsOpenRef.current;
    const id = open ? BODA_PROPS[0]?.id || "" : "";
    propsOpenRef.current = open;
    propIdRef.current = id;
    setPropsOpen(open);
    setPropId(id);
  }

  async function present(blob: Blob, filename: string, kind: "foto" | "video", framed: boolean) {
    const file = new File([blob], filename, { type: blob.type || (kind === "foto" ? "image/jpeg" : "video/webm"), lastModified: Date.now() });
    const saving = enqueueFiles([file], { kind: "capture" });
    const url = URL.createObjectURL(file);
    setShotDelivered(false);
    setShot((currentShot) => {
      if (currentShot) URL.revokeObjectURL(currentShot.url);
      return { url, file, kind, portrait: portraitRef.current, framed };
    });
    setNotice(kind === "foto" ? "Así quedó. Pulsa guardar y elige Guardar imagen." : "Así quedó. Pulsa guardar y elige Guardar video.");
    const queued = saving.then(
      () => "ok" as const,
      () => "error" as const,
    );
    let queueState: "ok" | "error" | "pending" = "pending";
    try {
      queueState = await withTimeout(queued, 5000);
    } catch {
      queueState = "pending";
    }
    if (queueState === "error" && shotRef.current?.url === url) {
      setNotice(`Pulsa guardar para tenerla en el teléfono. ${markFalla(FALLAS.cola)}`);
    }
    const silent = await trySilentDirectorySave(file);
    if (shotRef.current?.url !== url) return;
    if (silent === "saved") {
      setShotDelivered(true);
      setNotice(kind === "foto" ? "Guardada en la carpeta del teléfono." : "Guardado en la carpeta del teléfono.");
      return;
    }
    setShotDelivered(false);
    if (queueState !== "error") {
      setNotice(kind === "foto" ? "Así quedó. Pulsa guardar y elige Guardar imagen." : "Así quedó. Pulsa guardar y elige Guardar video.");
    }
  }

  function clearShot() {
    setShot((currentShot) => {
      if (currentShot) URL.revokeObjectURL(currentShot.url);
      return null;
    });
    setShotDelivered(false);
    setNotice("");
    setBusy(false);
  }

  async function saveShot() {
    const currentShot = shotRef.current;
    if (!currentShot) return;
    const result = await deliverFromGesture(currentShot.file);
    if (result === "cancelled") {
      setShotDelivered(false);
      setNotice(currentShot.kind === "foto" ? "Así quedó. Pulsa guardar y elige Guardar imagen." : "Así quedó. Pulsa guardar y elige Guardar video.");
      return;
    }
    if (result === "needs-gesture") {
      setShotDelivered(false);
      setNotice("Pulsa guardar otra vez y elige Guardar imagen.");
      return;
    }
    if (result === "saved") {
      setShotDelivered(true);
      setNotice(currentShot.kind === "foto" ? "Guardada en la carpeta del teléfono." : "Guardado en la carpeta del teléfono.");
      return;
    }
    if (result === "shared") {
      setShotDelivered(true);
      setNotice(currentShot.kind === "foto" ? "Entregada. En Fotos queda si elegiste Guardar imagen." : "Entregado. En Fotos queda si elegiste Guardar video.");
      return;
    }
    if (result === "downloaded") {
      setShotDelivered(true);
      setNotice("Descargada en este navegador.");
      return;
    }
    setShotDelivered(false);
  }

  async function saveClip() {
    const currentClip = clipRef.current;
    if (!currentClip) return;
    const result = await deliverFromGesture(currentClip.file);
    if (result === "saved") {
      setClipDelivered(true);
      setNotice("Guardado en la carpeta del teléfono.");
      return;
    }
    if (result === "shared") {
      setClipDelivered(true);
      setNotice("Entregado. En Fotos queda si elegiste Guardar video.");
      return;
    }
    if (result === "downloaded") {
      setClipDelivered(true);
      setNotice("Descargado en este navegador.");
      return;
    }
    setClipDelivered(false);
    if (result !== "cancelled") setNotice("Pulsa guardar otra vez y elige Guardar video.");
  }

  async function runCountdown() {
    if (countdownRef.current || recordingRef.current) return false;
    const token = countdownToken.current + 1;
    countdownToken.current = token;
    countdownRef.current = 3;
    try {
      for (const value of [3, 2, 1]) {
        if (countdownToken.current !== token) return false;
        countdownRef.current = value;
        setCountdown(value);
        await wait(1000);
      }
      return countdownToken.current === token;
    } finally {
      if (countdownToken.current === token) {
        countdownRef.current = 0;
        setCountdown(null);
      }
    }
  }

  function waitForCamera() {
    const timeout = cameraAccepted() ? 8_000 : 60_000;
    const started = Date.now();
    return new Promise<void>((resolve, reject) => {
      const timer = window.setInterval(() => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (track && track.readyState === "live") {
          window.clearInterval(timer);
          resolve();
        } else if (cameraErrorRef.current) {
          window.clearInterval(timer);
          reject(new Error(cameraErrorRef.current));
        } else if (Date.now() - started > timeout) {
          window.clearInterval(timer);
          reject(new Error("No se pudo abrir la cámara."));
        }
      }, 80);
    });
  }

  async function takePhoto() {
    const video = videoRef.current;
    const canvas = captureRef.current;
    const frame = frameNow();
    const image = frame ? imagesRef.current[frame.src] : undefined;
    if (!video || !canvas || !image?.naturalWidth || recordingRef.current) {
      setNotice(`No se pudo guardar la foto. Inténtalo de nuevo. ${markFalla(FALLAS.foto)}`);
      setBusy(false);
      return;
    }
    if (!video.videoWidth) await wait(160);
    const context = canvas.getContext("2d");
    const worn = activeStamp();
    if (!context || !paintFrame(context, video, image, facingRef.current, undefined, worn)) {
      setNotice(`No se pudo guardar la foto. Inténtalo de nuevo. ${markFalla(FALLAS.foto)}`);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      let blob: Blob | null = null;
      try {
        blob = await withTimeout(canvasBlob(canvas, "image/jpeg", 0.92), 4000);
      } catch {
        blob = jpegFromCanvas(canvas);
      }
      if (!blob || blob.size < 1) {
        setNotice(`No se pudo guardar la foto. Inténtalo de nuevo. ${markFalla(FALLAS.foto)}`);
        return;
      }
      await present(blob, `fotomaton-foto-${stamp()}.jpg`, "foto", true);
    } catch {
      setNotice(`No se pudo guardar la foto. Inténtalo de nuevo. ${markFalla(FALLAS.foto)}`);
    } finally {
      setBusy(false);
    }
  }

  async function recordClip(burnFrame: boolean) {
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video || recordingRef.current) return;
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
    } catch {
      audio = null;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") {
      audio?.getTracks().forEach((track) => track.stop());
      setNotice(`No se pudo grabar el video. ${markFalla(FALLAS.video)}`);
      return;
    }
    const mixed = new MediaStream([videoTrack, ...(audio?.getAudioTracks() ?? [])]);
    let recorder: MediaRecorder;
    try {
      const options = recorderOptions(pickRecorderMime());
      recorder = options ? new MediaRecorder(mixed, options) : new MediaRecorder(mixed);
    } catch {
      try {
        recorder = new MediaRecorder(mixed);
      } catch {
        audio?.getTracks().forEach((track) => track.stop());
        setNotice(`Este navegador no pudo grabar el video. La foto sí funciona. ${markFalla(FALLAS.videoNavegador)}`);
        return;
      }
    }
    const chunks: Blob[] = [];
    const facingNow = facingRef.current;
    const frameImage = imagesRef.current[frameNow()?.src || ""];
    const worn = activeStamp();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    let resolveStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStop = () => resolve();
    });
    recorder.onstop = () => resolveStop();
    const finish = () => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      setRecording(false);
      audio?.getTracks().forEach((track) => track.stop());
      if (recorder.state !== "inactive") recorder.stop();
      window.setTimeout(resolveStop, 3000);
    };
    stopRecordingRef.current = finish;
    recordingRef.current = true;
    try {
      recorder.start(1000);
    } catch {
      recordingRef.current = false;
      audio?.getTracks().forEach((track) => track.stop());
      stopRecordingRef.current = null;
      setNotice(`Este navegador no pudo grabar el video. La foto sí funciona. ${markFalla(FALLAS.videoNavegador)}`);
      return;
    }
    setSeconds(0);
    setRecording(true);
    setNotice("");
    await stopped;
    stopRecordingRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    const mime = recorder.mimeType || chunks[0]?.type || "video/webm";
    let blob = new Blob(chunks, { type: mime });
    if (blob.size < 1) {
      setNotice(`No se pudo guardar el video. Inténtalo de nuevo. ${markFalla(FALLAS.video)}`);
      return;
    }
    let framed = false;
    if (burnFrame && frameImage?.naturalWidth) {
      setBusy(true);
      setNotice("Preparando el video…");
      try {
        const burned = await withTimeout(frameVideo(blob, frameImage, facingNow, worn), 8000);
        if (burned && burned.size > 0) {
          blob = burned;
          framed = true;
        }
      } catch {
        framed = false;
        markFalla(FALLAS.videoPreparar, false);
      } finally {
        setBusy(false);
        setNotice("");
      }
    }
    const filename = `fotomaton-${burnFrame ? "video" : "mensaje"}-${stamp()}.${extensionFor(blob.type || mime)}`;
    if (burnFrame) {
      await present(blob, filename, "video", framed);
      return;
    }
    const file = new File([blob], filename, { type: blob.type || mime, lastModified: Date.now() });
    const url = URL.createObjectURL(file);
    setClipDelivered(false);
    setClip((currentClip) => {
      if (currentClip) URL.revokeObjectURL(currentClip.url);
      return { url, file };
    });
    setMessageCamera(false);
    setNotice("Así quedó. Pulsa guardar y elige Guardar video.");
  }

  async function onPhoto() {
    if (busy || recordingRef.current) return;
    if (!(await runCountdown())) return;
    try {
      await takePhoto();
    } finally {
      setBusy(false);
    }
  }

  async function onVideo() {
    if (recordingRef.current) {
      stopRecordingRef.current?.();
      return;
    }
    if (busy) return;
    if (!(await runCountdown())) return;
    try {
      await recordClip(true);
    } finally {
      setBusy(false);
    }
  }

  async function beginTestimony() {
    if (busy || recordingRef.current || countdownRef.current) return;
    setMessageCamera(true);
    setCameraError("");
    cameraErrorRef.current = "";
    setNotice("");
    try {
      await waitForCamera();
    } catch (error) {
      setMessageCamera(false);
      setNotice(`${error instanceof Error ? error.message : "No se pudo abrir la cámara."} ${markFalla(fallaDeCamara(error))}`);
      return;
    }
    if (!(await runCountdown())) return;
    await recordClip(false);
  }

  async function sendMessage() {
    const text = message.trim();
    const currentClip = clipRef.current;
    if (!text && !currentClip) {
      setNotice("Escribe un mensaje o graba un testimonio.");
      return;
    }
    setSending(true);
    setNotice("");
    try {
      if (config.storage.mode === "local") {
        if (text) {
          const file = new File([text], `mensaje-${stamp()}.txt`, { type: "text/plain" });
          const result = await deliverFromGesture(file);
          if (result === "cancelled" || result === "needs-gesture") return;
          setMessage("");
          setNotice("Mensaje entregado al navegador. Guarda el video con su botón si también grabaste uno.");
        } else if (currentClip) {
          await saveClip();
        }
        return;
      }
      const files = currentClip
        ? [currentClip.file]
        : [new File([text], `mensaje-${stamp()}.txt`, { type: "text/plain" })];
      await enqueueFiles(files, { kind: "message", text });
      if (currentClip) {
        URL.revokeObjectURL(currentClip.url);
        setClip(null);
      }
      setMessage("");
      setNotice("");
    } catch {
      setNotice(`No se pudo guardar el mensaje. Inténtalo de nuevo. ${markFalla(FALLAS.mensaje)}`);
    } finally {
      setSending(false);
    }
  }

  function goEntry() {
    stopRecordingRef.current?.();
    countdownToken.current += 1;
    countdownRef.current = 0;
    setCountdown(null);
    setMode("entry");
    setMessageCamera(false);
  }

  const panel = [previous, current, next];
  const wide = !portrait;
  const shutterPx = wide ? 128 : 154;
  const filterPx = wide ? 44 : 56;
  const cameraOpen = showPhotoCamera || showMessageCamera;
  const liveCover = sourceSize.width > 0 && stage.width > 0 ? coverRect(stage.width, stage.height, sourceSize.width, sourceSize.height) : null;
  const shell = showPhotoCamera
    ? "fixed inset-0 h-dvh w-full overflow-hidden bg-[#f6efe6] text-[#3d2428]"
    : cameraOpen
      ? "relative h-dvh w-full overflow-hidden bg-[#f6efe6] text-[#3d2428]"
      : `flex h-dvh w-full flex-col overflow-hidden bg-[#f6efe6] text-[#3d2428] ${wide ? "px-2 pt-[max(0.2rem,env(safe-area-inset-top))] pb-[max(0.2rem,env(safe-area-inset-bottom))]" : "px-3 pt-[max(0.35rem,env(safe-area-inset-top))] pb-[max(0.4rem,env(safe-area-inset-bottom))]"}`;

  return (
    <div className={shell} style={{ fontFamily: "system-ui, sans-serif" }} data-screen={mode} data-orientation={wide ? "landscape" : "portrait"}>
      {line ? (
        <p role="status" className={`${cameraOpen ? "absolute inset-x-3 top-14 z-50" : "relative z-50 mx-auto mt-1 max-w-xl"} rounded-2xl bg-[#fff8ef]/95 px-3 py-2 text-center text-xs leading-snug text-[#6b2433] shadow-sm`}>
          {line}
          {failed ? <button type="button" className="ml-2 underline" onClick={() => void retryUploads()}>Reintentar envío</button> : null}
        </p>
      ) : null}
      {showMessageCamera ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-2 px-2 pt-[max(0.15rem,env(safe-area-inset-top))]">
          <button type="button" onClick={goEntry} className={`pointer-events-auto rounded-full bg-white/75 text-[#8c3a4a] ${wide ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-1 text-xs"}`}>Menú</button>
          <h1 className={`rounded-full bg-white/75 leading-none text-[#6b2433] ${wide ? "px-1.5 py-0 text-[11px]" : "px-2.5 py-1 text-sm"}`} style={{ fontFamily: "Georgia, serif" }}>Fotomatón</h1>
          <p className={`max-w-[28%] truncate rounded-full bg-white/75 ${wide ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-1 text-xs"}`}>{config.eventName}</p>
        </div>
      ) : (
        <div className={`${showPhotoCamera ? "absolute inset-x-0 top-0 z-40 px-3 pt-[max(0.35rem,env(safe-area-inset-top))]" : ""} grid shrink-0 items-center ${showPhotoCamera ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)_auto]"} ${wide ? "gap-1.5" : "gap-2"}`}>
          {showPhotoCamera ? (
            <div role="group" aria-label="Foto o video" className={`inline-flex justify-self-start rounded-full bg-white/90 shadow-sm ${wide ? "p-0.5" : "p-1"}`}>
              <button
                type="button"
                aria-pressed={captureKind === "foto"}
                disabled={recording || countdown !== null || Boolean(shot)}
                onClick={() => setCaptureKind("foto")}
                className={`rounded-full font-semibold disabled:opacity-40 ${wide ? "px-2.5 py-0.5 text-[11px]" : "min-h-9 px-3.5 py-1 text-sm"} ${captureKind === "foto" ? "bg-[#f07a1a] text-white" : "text-[#6b2433]"}`}
              >
                Foto
              </button>
              <button
                type="button"
                aria-pressed={captureKind === "video"}
                disabled={recording || countdown !== null || Boolean(shot)}
                onClick={() => setCaptureKind("video")}
                className={`rounded-full font-semibold disabled:opacity-40 ${wide ? "px-2.5 py-0.5 text-[11px]" : "min-h-9 px-3.5 py-1 text-sm"} ${captureKind === "video" ? "bg-[#f07a1a] text-white" : "text-[#6b2433]"}`}
              >
                Video
              </button>
            </div>
          ) : (
            <button type="button" onClick={goEntry} className={`justify-self-start ${wide ? "text-xs text-[#8c3a4a]" : "text-sm text-[#8c3a4a]"}`}>Menú</button>
          )}
          <h1 className={`${showPhotoCamera ? "sr-only" : `truncate text-center ${wide ? "text-base leading-none text-[#6b2433]" : "text-xl leading-none text-[#6b2433]"}`}`} style={showPhotoCamera ? undefined : { fontFamily: "Georgia, serif" }}>Fotomatón</h1>
          <div className={`flex min-w-0 max-w-36 items-center justify-end ${wide ? "gap-1.5" : "gap-2"}`}>
            {showPhotoCamera ? <button type="button" onClick={goEntry} className={`shrink-0 rounded-full bg-white/80 ${wide ? "px-1.5 py-0 text-[11px] text-[#8c3a4a]" : "px-2 py-0.5 text-xs text-[#8c3a4a]"}`}>Menú</button> : null}
            <p className={`truncate text-right ${showPhotoCamera ? "rounded-full bg-white/80 px-2 py-0.5" : ""} ${wide ? "text-xs" : "text-sm"}`}>{config.eventName}</p>
          </div>
        </div>
      )}

      {mode === "entry" ? (
        <div className={`mx-auto flex w-full flex-1 ${wide ? "max-w-3xl flex-row items-center justify-center gap-3" : "max-w-md flex-col justify-center gap-4"}`}>
          <button type="button" onClick={() => setMode("photos")} className={`flex flex-col items-center bg-white shadow-sm ${wide ? "min-w-0 flex-1 gap-1 rounded-2xl px-3 py-3" : "gap-2 rounded-[2rem] px-4 py-5"}`}>
            <img src={assetPath("templates/button_take_photo_01.png")} alt="" className={wide ? "h-24 w-24 object-contain" : "h-56 w-56 object-contain"} />
            <span className={wide ? "text-lg text-[#6b2433]" : "text-2xl text-[#6b2433]"} style={{ fontFamily: "Georgia, serif" }}>Tomarte fotos</span>
          </button>
          <button type="button" onClick={() => setMode("message")} className={`flex flex-col items-center bg-white shadow-sm ${wide ? "min-w-0 flex-1 gap-1 rounded-2xl px-3 py-3" : "gap-2 rounded-[2rem] px-4 py-5"}`}>
            <img src={assetPath("templates/button_leave_message_01.png")} alt="" className={wide ? "h-24 w-24 object-contain" : "h-56 w-56 object-contain"} />
            <span className={wide ? "text-center text-lg text-[#6b2433]" : "text-center text-2xl text-[#6b2433]"} style={{ fontFamily: "Georgia, serif" }}>Dejar un mensaje</span>
          </button>
        </div>
      ) : null}

      {showPhotoCamera || showMessageCamera ? (
        <div ref={wellRef} className={showPhotoCamera ? "absolute inset-0 z-0 flex items-center justify-center" : cameraOpen ? "absolute inset-0 flex items-center justify-center" : "relative mt-1 min-h-0 flex-1"}>
          {stage.width > 0 ? (
            <div
              data-frame={showPhotoCamera ? current.id : "testimonio"}
              data-frame-index={showPhotoCamera ? index : 0}
              data-props={showPhotoCamera && propsOpen ? propId || "none" : "off"}
              data-countdown={countdown ?? ""}
              role="group"
              aria-label={showPhotoCamera ? "Marcos de la boda" : "Testimonio"}
              className="relative shrink-0 overflow-hidden rounded-none bg-transparent outline-none"
              style={{ width: stage.width, height: stage.height, touchAction: showPhotoCamera ? "none" : "auto", isolation: "isolate" }}
              onPointerDown={showPhotoCamera ? onPointerDown : undefined}
              onPointerMove={showPhotoCamera ? onPointerMove : undefined}
              onPointerUp={showPhotoCamera ? onPointerUp : undefined}
              onPointerCancel={showPhotoCamera ? onPointerUp : undefined}
            >
              <video
                ref={videoRef}
                className={`absolute z-0 max-w-none ${shot && showPhotoCamera ? "invisible" : ""}`}
                style={liveCover ? {
                  left: liveCover.x,
                  top: liveCover.y,
                  width: liveCover.width,
                  height: liveCover.height,
                  maxWidth: "none",
                  objectFit: "cover",
                  zIndex: 0,
                  transform: facing === "user" ? "scaleX(-1)" : undefined,
                } : {
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  maxWidth: "none",
                  objectFit: "cover",
                  zIndex: 0,
                  transform: facing === "user" ? "scaleX(-1)" : undefined,
                }}
                playsInline
                autoPlay
                muted
                disablePictureInPicture
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (video.videoWidth) setSourceSize({ width: video.videoWidth, height: video.videoHeight });
                }}
              />
              {showPhotoCamera && propsOpen && !shot ? <PropOverlay propId={propId} width={stage.width} height={stage.height} images={imagesRef.current} /> : null}
              {showPhotoCamera && shot ? (
                shot.kind === "foto" ? (
                  <img src={shot.url} alt="Foto con el marco" className="absolute inset-0 z-10 h-full w-full max-w-none object-contain" style={{ objectFit: "contain" }} />
                ) : (
                  <>
                    <video src={shot.url} className="absolute inset-0 z-10 h-full w-full max-w-none object-contain" style={{ objectFit: "contain" }} playsInline controls autoPlay />
                    {shot.framed ? null : <img src={current.src} alt="" className="pointer-events-none absolute inset-0 z-10 h-full w-full object-contain" style={{ objectFit: "contain" }} />}
                  </>
                )
              ) : null}
              {showPhotoCamera && !shot ? (
                <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
                  <div
                    className="flex h-full"
                    style={{
                      width: stage.width * 3,
                      transform: `translate3d(${-stage.width + drag}px, 0, 0)`,
                      transition: animate ? "transform 260ms ease" : "none",
                    }}
                    onTransitionEnd={onTransitionEnd}
                  >
                    {panel.map((frame, panelIndex) => (
                      <FrameSlide key={`${frame.id}-${panelIndex}`} frame={frame} width={stage.width} label={panelIndex === 1 ? frame.label : ""} />
                    ))}
                  </div>
                </div>
              ) : null}
              {showPhotoCamera && !shot ? (
                <>
                  <button type="button" aria-label={propsOpen ? "Accesorio anterior" : "Marco anterior"} disabled={recording || countdown !== null} onPointerDown={(event) => event.stopPropagation()} onClick={() => nudge(-1)} className={`absolute top-1/2 z-20 grid -translate-y-1/2 place-items-center rounded-full bg-white/70 text-[#6b2433] shadow-sm disabled:opacity-40 ${wide ? "left-1 h-6 w-6" : "left-2 h-10 w-10"}`}>
                    <Chevron direction="left" compact={wide} />
                  </button>
                  <button type="button" aria-label={propsOpen ? "Accesorio siguiente" : "Marco siguiente"} disabled={recording || countdown !== null} onPointerDown={(event) => event.stopPropagation()} onClick={() => nudge(1)} className={`absolute top-1/2 z-20 grid -translate-y-1/2 place-items-center rounded-full bg-white/70 text-[#6b2433] shadow-sm disabled:opacity-40 ${wide ? "right-1 h-6 w-6" : "right-2 h-10 w-10"}`}>
                    <Chevron direction="right" compact={wide} />
                  </button>
                </>
              ) : null}
              {recording ? (
                <p className={`absolute z-20 rounded-full bg-[#6b2433] font-semibold text-white ${wide ? "left-2 top-8 px-2 py-0.5 text-[11px]" : "left-3 top-3 px-3 py-1 text-sm"}`}>
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                </p>
              ) : null}
              {countdown ? (
                <p className={`pointer-events-none absolute inset-x-0 z-30 text-center font-semibold leading-none text-white ${wide ? "top-8 text-4xl" : "top-5 text-6xl"}`} style={{ textShadow: "0 6px 18px rgba(0,0,0,.55)" }} aria-live="assertive">
                  {countdown}
                </p>
              ) : null}
              {showPhotoCamera && !shot ? (
                <button
                  type="button"
                  aria-label="Cambiar cámara"
                  disabled={recording || countdown !== null}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setFacing((currentFacing) => (currentFacing === "user" ? "environment" : "user"))}
                  className={`absolute z-30 bg-transparent p-0 disabled:opacity-40 ${wide ? "right-1 top-10 h-10 w-10" : "right-2 top-16 h-14 w-14"}`}
                >
                  <img src={assetPath("templates/camera_flip_01.png")} alt="" draggable={false} className="block h-full w-full max-w-none object-contain" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showPhotoCamera ? (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-[70] flex flex-col items-center px-3 ${wide ? "gap-1 pb-[max(0.15rem,env(safe-area-inset-bottom))]" : "gap-2 pb-[max(0.45rem,env(safe-area-inset-bottom))]"}`}>
          {!shot ? (
            <div className="pointer-events-auto grid grid-cols-[1fr_auto_1fr] items-center" style={{ width: stage.width || "100%" }}>
              <span />
              {captureKind === "foto" ? (
                <button
                  type="button"
                  aria-label="Foto"
                  disabled={!cameraReady || !loaded[current.src] || busy || recording || countdown !== null}
                  onClick={() => void onPhoto()}
                  className="relative z-[2] justify-self-center bg-transparent p-0 disabled:opacity-40"
                  style={{ width: shutterPx, height: shutterPx }}
                >
                  <img src={assetPath("templates/camera_photo_capture_01.png")} alt="" draggable={false} className="block h-full w-full max-w-none object-contain" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={recording ? "Detener" : "Video"}
                  aria-pressed={recording}
                  disabled={!recording && (!cameraReady || !loaded[current.src] || busy || countdown !== null)}
                  onClick={() => void onVideo()}
                  className="relative z-[2] justify-self-center bg-transparent p-0 disabled:opacity-40"
                  style={{ width: shutterPx, height: shutterPx }}
                >
                  <img src={assetPath("templates/camera_video_record_01.png")} alt="" draggable={false} className="block h-full w-full max-w-none object-contain" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                </button>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-label={propsOpen ? "Quitar accesorios" : "Accesorios"}
                  aria-pressed={propsOpen}
                  disabled={recording || countdown !== null}
                  onClick={toggleProps}
                  className="relative z-[2] bg-transparent p-0 disabled:opacity-40"
                  style={{ width: filterPx, height: filterPx }}
                >
                  <img src={assetPath("templates/camera_filters_effects_01.png")} alt="" draggable={false} className="block h-full w-full max-w-none object-contain" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                </button>
              </div>
            </div>
          ) : null}
          <p className={wide ? "text-[10px] font-medium text-[#6b2433]" : "text-xs font-medium text-[#6b2433]"}>
            <span className={wide ? "rounded-full bg-white/75 px-1.5 py-0" : "rounded-full bg-white/80 px-2 py-0.5"}>{shot ? "Así quedó" : `${index + 1} / ${frames.length} · ${current.label}${propsOpen ? ` · ${propById(propId)?.label || "Sin nada"}` : ""}`}</span>
          </p>
          {cameraError ? <p className={wide ? "text-[10px] text-[#8c3a4a]" : "text-xs text-[#8c3a4a]"}><span className="rounded-full bg-white/80 px-2 py-0.5">{cameraError}</span></p> : null}
          {fallaTag ? <p className="text-[11px] leading-4 text-[#8c3a4a]/80">{fallaTag}</p> : null}
          {notice ? <p className={wide ? "text-[10px] font-medium text-[#6b2433]" : "text-xs font-medium text-[#6b2433]"} aria-live="polite"><span className="rounded-full bg-white/80 px-2 py-0.5">{notice}</span></p> : null}
          {shot ? (
            <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
              {!shotDelivered ? (
                <button type="button" aria-label="Guardar en el teléfono" onClick={() => void saveShot()} className={wide ? "h-14 w-14 bg-transparent p-0" : "h-24 w-24 bg-transparent p-0"}>
                  <img src={assetPath("templates/button_save_download_photo_01.png")} alt="" draggable={false} className="h-full w-full object-contain" />
                </button>
              ) : null}
              <button type="button" onClick={clearShot} className={wide ? "min-h-7 w-full rounded-full bg-white/75 px-2 text-[10px] font-semibold text-[#6b2433]" : "min-h-11 w-full rounded-full bg-white/85 px-3 text-sm font-semibold text-[#6b2433]"}>
                Tomar otra
              </button>
            </div>
          ) : null}
          <button type="button" onClick={goEntry} className={`pointer-events-auto text-[#8c3a4a] ${wide ? "text-[10px]" : "text-xs"}`}>
            <span className={wide ? "rounded-full bg-white/75 px-1.5 py-0" : "rounded-full bg-white/80 px-2 py-0.5"}>Opciones</span>
          </button>
        </div>
      ) : null}

      {mode === "message" && !showMessageCamera ? (
        <div className={`mx-auto flex w-full max-w-md flex-1 flex-col justify-center ${wide ? "gap-2" : "gap-3"}`}>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 4000))}
            rows={wide ? 3 : 5}
            maxLength={4000}
            placeholder={`Unas palabras para ${config.eventName}`} aria-label="Tu mensaje"
            className={`w-full border border-[#e2d3c4] bg-white outline-none ${wide ? "rounded-xl px-3 py-2 text-sm" : "rounded-2xl px-4 py-3"}`}
          />
          {clip ? (
            <div className="flex flex-col items-center gap-2">
              <video src={clip.url} className={wide ? "max-h-24 w-full rounded-xl object-cover" : "max-h-40 w-full rounded-2xl object-cover"} style={{ objectFit: "cover" }} playsInline controls />
              {!clipDelivered ? (
                <button type="button" aria-label="Guardar en el teléfono" onClick={() => void saveClip()} className="h-20 w-20 bg-transparent p-0">
                  <img src={assetPath("templates/button_save_download_photo_01.png")} alt="" draggable={false} className="h-full w-full object-contain" />
                </button>
              ) : null}
            </div>
          ) : null}
          {cameraError ? <p className="text-center text-sm text-[#8c3a4a]">{cameraError}</p> : null}
          {fallaTag ? <p className="text-center text-[11px] leading-4 text-[#8c3a4a]/80">{fallaTag}</p> : null}
          {notice ? <p className="text-center text-sm font-medium text-[#6b2433]" aria-live="polite">{notice}</p> : null}
          <div className={wide ? "grid grid-cols-2 gap-1" : "grid gap-2"}>
            <button type="button" disabled={sending || countdown !== null} onClick={() => (recording ? stopRecordingRef.current?.() : void beginTestimony())} className={wide ? "min-h-9 rounded-xl bg-[#c6a15b] px-2 text-sm font-semibold text-[#3d2428] disabled:opacity-40" : "min-h-14 rounded-2xl bg-[#c6a15b] px-4 py-3 text-base font-semibold text-[#3d2428] disabled:opacity-40"}>
              {clip ? "Volver a grabar" : "Grabar testimonio"}
            </button>
            <button type="button" disabled={sending || recording || countdown !== null} onClick={() => void sendMessage()} className={wide ? "min-h-9 rounded-xl bg-[#6b2433] px-2 text-sm font-semibold text-[#fff8ef] disabled:opacity-40" : "min-h-14 rounded-2xl bg-[#6b2433] px-4 py-3 text-base font-semibold text-[#fff8ef] disabled:opacity-40"}>
              {config.storage.mode === "local" ? "Guardar mensaje" : "Enviar mensaje"}
            </button>
            <button type="button" onClick={goEntry} className={wide ? "col-span-2 text-xs text-[#8c3a4a]" : "min-h-12 text-sm text-[#8c3a4a]"}>Opciones</button>
          </div>
        </div>
      ) : null}
      {showMessageCamera ? (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center ${wide ? "px-2 pb-[max(0.15rem,env(safe-area-inset-bottom))]" : "px-3 pb-[max(0.45rem,env(safe-area-inset-bottom))]"}`}>
          <button
            type="button"
            onClick={() => {
              if (recording) {
                stopRecordingRef.current?.();
                return;
              }
              countdownToken.current += 1;
              countdownRef.current = 0;
              setCountdown(null);
              setMessageCamera(false);
            }}
            className={wide ? "pointer-events-auto min-h-7 rounded-full bg-[#c6a15b]/85 px-3 text-[10px] font-semibold text-[#3d2428]" : "pointer-events-auto min-h-11 rounded-full bg-[#c6a15b]/90 px-4 text-sm font-semibold text-[#3d2428]"}
          >
            {recording ? "Detener" : "Cancelar"}
          </button>
        </div>
      ) : null}
      {mode === "entry" ? <p className="px-3 pb-2 text-center text-sm">{config.storage.mode === "local" ? "Tus capturas se quedan en este dispositivo. Usa Guardar para descargarlas." : "Las capturas se envían al almacenamiento configurado por este evento."}</p> : null}
      <canvas ref={captureRef} className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" aria-hidden="true" />
    </div>
  );
}

function FrameSlide({ frame, width, label }: { frame: BodaFrame; width: number; label: string }) {
  return <img src={frame.src} alt={label} draggable={false} className="block h-full max-w-none object-contain" style={{ width, height: "100%", objectFit: "contain", display: "block" }} />;
}

function PropOverlay({ propId, width, height, images }: { propId: string; width: number; height: number; images: Record<string, HTMLImageElement | undefined> }) {
  const prop = propById(propId);
  if (!prop || width <= 0 || height <= 0) return null;
  return propPieces(prop).map((piece) => {
    const image = images[piece.src];
    const box = propBox(piece, width, height, image?.naturalWidth || 700, image?.naturalHeight || 500);
    return (
      <img
        key={piece.src}
        data-accessory={prop.id}
        src={piece.src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute z-[1]"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      />
    );
  });
}
