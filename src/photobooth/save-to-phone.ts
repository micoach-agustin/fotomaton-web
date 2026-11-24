import { config } from "../config";

const DB_NAME = "fotomaton-web-saves";
const DB_VERSION = 1;
const FLAG = "fotomaton-web-save-ok";
const MODE = "fotomaton-web-save-mode";
const HANDLE_KEY = "directory";

export type SaveMode = "directory" | "share" | "download";
export type SaveResult = "saved" | "shared" | "downloaded" | "cancelled" | "needs-gesture";

let memoryHandle: FileSystemDirectoryHandle | null = null;

export function saveWasGranted() {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function saveMode(): SaveMode | "" {
  try {
    const value = localStorage.getItem(MODE);
    if (value === "directory" || value === "share" || value === "download") return value;
  } catch {
    /* Sin modo guardado, la primera vez pregunta. */
  }
  return "";
}

function markGranted(mode: SaveMode) {
  try {
    localStorage.setItem(FLAG, "1");
    localStorage.setItem(MODE, mode);
  } catch {
    /* La sesión igual escribe si el handle sigue en memoria. */
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle() {
  if (memoryHandle) return memoryHandle;
  try {
    const db = await openDb();
    try {
      const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
        const request = db.transaction("kv", "readonly").objectStore("kv").get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
        request.onerror = () => reject(request.error);
      });
      if (handle) memoryHandle = handle;
      return handle || null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function storeHandle(handle: FileSystemDirectoryHandle) {
  memoryHandle = handle;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* En esta visita queda el handle en memoria. */
  }
}

function picker() {
  return (
    window as Window & {
      showDirectoryPicker?: (options?: { id?: string; mode?: "readwrite"; startIn?: "pictures" | "downloads" }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
}

async function permissionGranted(handle: FileSystemDirectoryHandle, interactive: boolean) {
  const mode = { mode: "readwrite" as const };
  try {
    if (handle.queryPermission) {
      if ((await handle.queryPermission(mode)) === "granted") return true;
      if (!interactive || !handle.requestPermission) return false;
      return (await handle.requestPermission(mode)) === "granted";
    }
  } catch {
    return false;
  }
  return false;
}

async function writeFile(handle: FileSystemDirectoryHandle, file: File) {
  const target = await handle.getFileHandle(file.name, { create: true });
  const writable = await target.createWritable();
  await writable.write(file);
  await writable.close();
}

function downloadAnchor(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** iPhone y iPad no escriben en Fotos en silencio. Ahí solo vale la hoja de compartir. */
export function iosLibrary() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || touchMac;
}

function shareOrHold(file: File): Promise<SaveResult> {
  if (!navigator.canShare?.({ files: [file] })) {
    if (iosLibrary()) return Promise.resolve("needs-gesture");
    downloadAnchor(file);
    return Promise.resolve("downloaded");
  }
  return navigator.share({ files: [file], title: config.eventName }).then(
    () => "shared" as const,
    (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled" as const;
      return "needs-gesture" as const;
    },
  );
}

/**
 * Solo carpeta ya concedida, sin hoja de compartir y sin decir que está en Fotos.
 * En iPhone devuelve unavailable: el botón tiene que abrir Guardar imagen.
 */
export async function trySilentDirectorySave(file: File): Promise<"saved" | "unavailable"> {
  if (iosLibrary()) return "unavailable";
  const handle = memoryHandle || (await readHandle());
  if (!handle || !(await permissionGranted(handle, false))) return "unavailable";
  try {
    await writeFile(handle, file);
    markGranted("directory");
    return "saved";
  } catch {
    return "unavailable";
  }
}

/**
 * Llamar en el mismo toque del botón, sin un await antes.
 * En iPhone abre la hoja del sistema (Guardar imagen / Guardar video).
 * No marca nada como guardado: eso lo decide quien recibe el resultado.
 */
export function deliverFromGesture(file: File): Promise<SaveResult> {
  if (iosLibrary() || !picker()) return shareOrHold(file);
  if (memoryHandle) {
    return permissionGranted(memoryHandle, false).then(async (allowed) => {
      if (!allowed) return shareOrHold(file);
      try {
        await writeFile(memoryHandle as FileSystemDirectoryHandle, file);
        markGranted("directory");
        return "saved" as const;
      } catch {
        return shareOrHold(file);
      }
    });
  }
  const open = picker();
  if (!open) return shareOrHold(file);
  return open({ id: "fotomaton-web-fotos", mode: "readwrite", startIn: "pictures" })
    .then(async (picked) => {
      await storeHandle(picked);
      await writeFile(picked, file);
      markGranted("directory");
      return "saved" as const;
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled" as const;
      return shareOrHold(file);
    });
}

/**
 * La primera vez pide destino. Después escribe en la carpeta ya concedida.
 * Safari no puede escribir en Fotos en silencio: ahí solo se usa la hoja del sistema.
 * No toca la cola de envío: esa copia sigue hasta que el servidor confirma cada bloque.
 */
export async function saveToPhone(file: File, interactive: boolean): Promise<SaveResult> {
  if (!interactive) return trySilentDirectorySave(file).then((result) => (result === "saved" ? "saved" : "needs-gesture"));
  return deliverFromGesture(file);
}
