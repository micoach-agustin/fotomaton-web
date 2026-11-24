import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: true });
});

async function pending() {
  const names = await indexedDB.databases();
  if (!names.length) return [];
  return new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open(names[0].name!);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("captures");
      const request = tx.objectStore("captures").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    };
  });
}

function remote() {
  vi.stubEnv("VITE_STORAGE_MODE", "endpoint");
  vi.stubEnv("VITE_STORAGE_ENDPOINT", "/api/photobooth");
}

describe("storage isolation and acknowledgement", () => {
  it("does not open a queue or make network requests in local mode", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const storage = await import("./storage");
    await storage.enqueueFiles([new File(["photo"], "photo.jpg")], { kind: "capture" });
    await storage.retryUploads();
    expect(fetch).not.toHaveBeenCalled();
    expect(await indexedDB.databases()).toEqual([]);
  });

  it("keeps a capture after a failed request and removes it only after acknowledgement", async () => {
    remote();
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const storage = await import("./storage");
    await storage.enqueueFiles([new File(["photo"], "photo.jpg", { type: "image/jpeg" })], { kind: "capture" });
    await storage.retryUploads();
    expect(await pending()).toHaveLength(1);
    const firstId = fetch.mock.calls[0][1].headers["Idempotency-Key"];
    fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await storage.retryUploads();
    expect(await pending()).toHaveLength(0);
    const [url, request] = fetch.mock.calls.at(-1)!;
    expect(url).toBe("/api/photobooth");
    expect(request.headers["Idempotency-Key"]).toBe(firstId);
    expect(JSON.parse(request.body.get("metadata")).captureId).toBe(firstId);
    expect(request.body.get("file").type).toBe("image/jpeg");
  });

  it("does not treat an HTTP 200 response without ok:true as stored", async () => {
    remote();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    const storage = await import("./storage");
    await storage.enqueueFiles([new File(["message"], "message.txt")], { kind: "message", text: "Hola" });
    await storage.retryUploads();
    expect(await pending()).toHaveLength(1);
  });
});
