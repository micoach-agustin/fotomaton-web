/** Tags estables. El invitado ve el tag. Solo se muestran en este dispositivo; no se envían a ningún servidor. */

export type Falla = {
  tag: string;
  mensaje: string;
};

export const FALLAS = {
  camaraPermiso: { tag: "ERR-FOTO-0101", mensaje: "La cámara no tiene permiso." },
  camaraAusente: { tag: "ERR-FOTO-0102", mensaje: "No hay cámara en este dispositivo." },
  camaraOcupada: { tag: "ERR-FOTO-0103", mensaje: "La cámara está ocupada." },
  camaraAbrir: { tag: "ERR-FOTO-0104", mensaje: "No se pudo abrir la cámara." },
  foto: { tag: "ERR-FOTO-0201", mensaje: "No se pudo guardar la foto." },
  video: { tag: "ERR-FOTO-0202", mensaje: "No se pudo grabar el video." },
  videoPreparar: { tag: "ERR-FOTO-0203", mensaje: "El video tardó demasiado en prepararse." },
  videoNavegador: { tag: "ERR-FOTO-0204", mensaje: "Este navegador no pudo grabar el video." },
  cola: { tag: "ERR-FOTO-0301", mensaje: "No se pudo dejar el archivo en el teléfono." },
  subida: { tag: "ERR-FOTO-0302", mensaje: "La subida no avanzó. El archivo sigue en el teléfono." },
  mensaje: { tag: "ERR-FOTO-0501", mensaje: "No se pudo guardar el mensaje." },
  telefono: { tag: "ERR-FOTO-0502", mensaje: "No se pudo guardar en el teléfono." },
} as const satisfies Record<string, Falla>;

export function fallaDeCamara(error: unknown): Falla {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return FALLAS.camaraPermiso;
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return FALLAS.camaraAusente;
  if (name === "NotReadableError" || name === "TrackStartError") return FALLAS.camaraOcupada;
  return FALLAS.camaraAbrir;
}
