export type Facing = "user" | "environment";

const ACCEPT_KEY = "fotomaton-web-camera-ok";

type Live = { stream: MediaStream; facing: Facing };
type Flight = { facing: Facing; promise: Promise<MediaStream> };

let live: Live | null = null;
let inflight: Flight | null = null;
let holders = 0;
let releaseTimer = 0;

export function cameraAccepted() {
  try {
    return localStorage.getItem(ACCEPT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markCameraAccepted() {
  try {
    localStorage.setItem(ACCEPT_KEY, "1");
  } catch {
    /* El navegador recuerda el permiso del origen. */
  }
}

function clearCameraAccepted() {
  try {
    localStorage.removeItem(ACCEPT_KEY);
  } catch {
    /* Sin almacenamiento no hay pantalla propia que ocultar. */
  }
}

export async function cameraPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";
  try {
    const status = await permissions.query({ name: "camera" as PermissionName });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
  } catch {
    /* Safari no consulta el permiso de cámara. */
  }
  return "unknown";
}

export function liveStream(facing: Facing) {
  const track = live?.stream.getVideoTracks()[0];
  if (!live || live.facing !== facing || !track || track.readyState !== "live") return null;
  return live.stream;
}

function rememberStream(stream: MediaStream, facing: Facing) {
  if (live && live.stream !== stream) {
    live.stream.getTracks().forEach((track) => track.stop());
  }
  live = { stream, facing };
}

/** Suelta la cámara un minuto después de salir, para reutilizarla en la misma visita. */
export function holdCamera() {
  holders += 1;
  window.clearTimeout(releaseTimer);
  return () => {
    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      releaseTimer = window.setTimeout(() => {
        if (holders === 0) {
          live?.stream.getTracks().forEach((track) => track.stop());
          live = null;
        }
      }, 60_000);
    }
  };
}

async function openCamera(facing: Facing, portrait: boolean) {
  const aspect = portrait ? 9 / 16 : 16 / 9;
  const width = portrait ? 2160 : 3840;
  const height = portrait ? 3840 : 2160;
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        aspectRatio: { ideal: aspect },
        width: { ideal: width },
        height: { ideal: height },
      },
    },
    {
      audio: false,
      video: {
        facingMode: { exact: facing },
        aspectRatio: aspect,
        width: { ideal: width },
        height: { ideal: height },
      },
    },
    { audio: false, video: { facingMode: facing, aspectRatio: { ideal: aspect } } },
    { audio: false, video: { facingMode: facing } },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({
            aspectRatio: { ideal: aspect },
            width: { ideal: width },
            height: { ideal: height },
            facingMode: facing,
          });
        } catch {
          /* Si el celular no recorta el sensor, el video igual llena el marco. */
        }
      }
      return stream;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("No se pudo abrir la cámara.");
}

export async function tuneCamera(stream: MediaStream, facing: Facing, portrait: boolean) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const aspect = portrait ? 9 / 16 : 16 / 9;
  try {
    await track.applyConstraints({ aspectRatio: { ideal: aspect }, facingMode: facing });
  } catch {
    /* object-cover llena el marco. */
  }
}

/**
 * Una sola getUserMedia por cámara. Si el permiso ya está granted, o esta visita
 * ya tiene el stream, no hay otra pantalla de validación.
 */
export function acquireCamera(facing: Facing, portrait: boolean) {
  const existing = liveStream(facing);
  if (existing) return Promise.resolve(existing);
  if (inflight?.facing === facing) return inflight.promise;
  let promise!: Promise<MediaStream>;
  promise = (async () => {
    const permission = await cameraPermission();
    if (permission === "denied") {
      clearCameraAccepted();
      throw new DOMException("La cámara está bloqueada.", "NotAllowedError");
    }
    const ready = liveStream(facing);
    if (ready) return ready;
    const stream = await openCamera(facing, portrait);
    if (inflight?.promise !== promise) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Se cambió la cámara.", "AbortError");
    }
    rememberStream(stream, facing);
    markCameraAccepted();
    return stream;
  })().finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { facing, promise };
  return promise;
}
