/** Único lugar para configurar el evento y el destino público de las capturas. */
export const config = {
  eventName: import.meta.env.VITE_EVENT_NAME?.trim() || "Nuestro evento",
  eventId: import.meta.env.VITE_EVENT_ID?.trim() || "mi-evento",
  storage: {
    mode: (import.meta.env.VITE_STORAGE_MODE || "local") as "local" | "endpoint",
    endpoint: import.meta.env.VITE_STORAGE_ENDPOINT?.trim() || "",
  },
};

export function configurationError() {
  if (!["local", "endpoint"].includes(config.storage.mode)) return "VITE_STORAGE_MODE debe ser local o endpoint.";
  if (config.storage.mode === "endpoint") {
    if (!config.storage.endpoint) return "Completa VITE_STORAGE_ENDPOINT con la dirección de tu propio servidor.";
    try {
      const url = new URL(config.storage.endpoint, window.location.href);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
        return "El servidor de almacenamiento debe usar HTTPS, sin credenciales en la URL.";
      }
    } catch {
      return "VITE_STORAGE_ENDPOINT no es una URL válida.";
    }
  }
  return "";
}

export function assetPath(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}
