import { useEffect, useState } from "react";
import { config } from "../config";

type Metadata = { kind: "capture" | "message"; text?: string };
type Job = {
  id: string;
  file: Blob;
  filename: string;
  metadata: Metadata & { captureId: string; eventId: string; eventName: string; createdAt: string };
  failed: boolean;
};
type Status = { pending: number; failed: number; line: string };
const listeners = new Set<(value: Status) => void>();
let status: Status = { pending: 0, failed: 0, line: "" };
let draining: Promise<void> | null = null;
let opened: Promise<IDBDatabase> | null = null;

function db() {
  if (!opened) {
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      // A new event or endpoint never receives another event's pending captures.
      const name = `fotomaton-web-queue:${config.eventId}:${config.storage.endpoint}`;
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("captures", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { opened = null; throw error; });
  }
  return opened;
}

async function write(job: Job | string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("captures", "readwrite");
    const table = tx.objectStore("captures");
    if (typeof job === "string") table.delete(job);
    else table.put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("No se pudo guardar en este navegador."));
  });
}

async function jobs() {
  const database = await db();
  return new Promise<Job[]>((resolve, reject) => {
    const request = database.transaction("captures").objectStore("captures").getAll();
    request.onsuccess = () => resolve(request.result as Job[]);
    request.onerror = () => reject(request.error);
  });
}

async function publish() {
  const pending = await jobs();
  const failed = pending.filter((job) => job.failed).length;
  status = {
    pending: pending.length,
    failed,
    line: pending.length ? `${pending.length} captura(s) pendientes de envío.${failed ? " No se confirmó el envío; guarda también una copia en el teléfono." : " Mantén esta página abierta hasta que terminen."}` : "",
  };
  listeners.forEach((listener) => listener(status));
}

export async function enqueueFiles(files: File[], metadata: Metadata) {
  if (config.storage.mode === "local") return;
  for (const file of files) {
    const id = crypto.randomUUID();
    await write({
      id, file, filename: file.name, failed: false,
      metadata: { ...metadata, captureId: id, eventId: config.eventId, eventName: config.eventName, createdAt: new Date().toISOString() },
    });
  }
  await publish();
  // Persistence completes before the caller clears any preview.
  void retryUploads();
}

/** POST multipart: file + JSON metadata. Only { ok: true } acknowledges storage. */
export function retryUploads(): Promise<void> {
  if (config.storage.mode === "local") return Promise.resolve();
  if (draining) return draining;
  draining = (async () => {
    try {
      const attempted = new Set<string>();
      while (navigator.onLine) {
        const batch = (await jobs()).filter((job) => !attempted.has(job.id));
        if (!batch.length) break;
        for (const job of batch) {
          if (!navigator.onLine) break;
          attempted.add(job.id);
        try {
          const form = new FormData();
          form.append("file", job.file, job.filename);
          form.append("metadata", JSON.stringify(job.metadata));
          const response = await fetch(config.storage.endpoint, {
            method: "POST", body: form,
            headers: { "Idempotency-Key": job.id },
            credentials: "same-origin",
            signal: AbortSignal.timeout(120_000),
          });
          const payload = await response.json();
          if (!response.ok || payload?.ok !== true) throw new Error("El servidor no confirmó el archivo.");
          await write(job.id);
        } catch {
          await write({ ...job, failed: true });
        }
        await publish();
        }
      }
      await publish();
    } catch {
      status = { ...status, failed: Math.max(1, status.failed), line: "No se pudo acceder a la cola del navegador. Guarda tu captura en el teléfono." };
      listeners.forEach((listener) => listener(status));
    }
  })().finally(() => { draining = null; });
  return draining;
}

export function useUploadStatus() {
  const [value, setValue] = useState(status);
  useEffect(() => {
    if (config.storage.mode === "local") return;
    listeners.add(setValue);
    void publish().catch(() => undefined);
    void retryUploads();
    const retry = () => { void retryUploads(); };
    window.addEventListener("online", retry);
    return () => { listeners.delete(setValue); window.removeEventListener("online", retry); };
  }, []);
  return value;
}
