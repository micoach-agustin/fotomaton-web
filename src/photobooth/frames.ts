import { assetPath } from "../config";

export type FrameOrientation = "portrait" | "landscape";

export type BodaFrame = {
  id: string;
  src: string;
  label: string;
  orientation: FrameOrientation;
};

type FramePair = {
  id: string;
  label: string;
  /** Id estable del conteo, por ejemplo marco:el-coche. */
  uso: string;
  portrait: string;
  landscape: string;
};

/** Cada id tiene su PNG vertical y el horizontal. No se rotan los viejos. */
export const BODA_FRAME_PAIRS: FramePair[] = [
  {
    id: "nombres",
    label: "Los nombres",
    uso: "marco:nombres",
    portrait: assetPath("templates/frame_photo_wedding_01_bottom_names.png"),
    landscape: assetPath("templates/frame_photo_wedding_01_landscape_names.png"),
  },
  {
    id: "fecha",
    label: "La fecha",
    uso: "marco:la-fecha",
    portrait: assetPath("templates/frame_photo_wedding_02_top_date.png"),
    landscape: assetPath("templates/frame_photo_wedding_02_landscape_date.png"),
  },
  {
    id: "campanas",
    label: "Campanas",
    uso: "marco:campanas",
    portrait: assetPath("templates/frame_photo_wedding_03_vertical_bells_names.png"),
    landscape: assetPath("templates/frame_photo_wedding_03_landscape_bells_names.png"),
  },
  {
    id: "coche",
    label: "El coche",
    uso: "marco:el-coche",
    portrait: assetPath("templates/frame_photo_wedding_04_portrait_car_date.png"),
    landscape: assetPath("templates/frame_photo_wedding_04_landscape_car_date.png"),
  },
  {
    id: "cabina",
    label: "La cabina",
    uso: "marco:la-cabina",
    portrait: assetPath("templates/frame_photo_wedding_05_portrait_photo_booth_names.png"),
    landscape: assetPath("templates/frame_photo_wedding_05_landscape_photo_booth_names.png"),
  },
  {
    id: "retro",
    label: "Retro",
    uso: "marco:retro",
    portrait: assetPath("templates/frame_photo_retro_portrait_01.png"),
    landscape: assetPath("templates/frame_photo_retro_landscape_01.png"),
  },
  {
    id: "viaje",
    label: "Viaje",
    uso: "marco:viaje",
    portrait: assetPath("templates/frame_photo_travel_portrait_01.png"),
    landscape: assetPath("templates/frame_photo_travel_landscape_01.png"),
  },
  {
    id: "bloques",
    label: "Bloques",
    uso: "marco:bloques",
    portrait: assetPath("templates/frame_photo_blocks_portrait_01.png"),
    landscape: assetPath("templates/frame_photo_blocks_landscape_01.png"),
  },
  {
    id: "magia",
    label: "Magia",
    uso: "marco:magia",
    portrait: assetPath("templates/frame_photo_magic_portrait_01.png"),
    landscape: assetPath("templates/frame_photo_magic_landscape_01.png"),
  },
];

export function frameUso(id: string) {
  return BODA_FRAME_PAIRS.find((frame) => frame.id === id)?.uso || "";
}

export function allFrameSources() {
  return BODA_FRAME_PAIRS.flatMap((frame) => [frame.portrait, frame.landscape]);
}

/** Vertical: los portrait. Horizontal: los landscape. El id se conserva al girar. */
export function orderedFrames(portrait: boolean): BodaFrame[] {
  const orientation = portrait ? "portrait" : "landscape";
  return BODA_FRAME_PAIRS.map((frame) => ({
    id: frame.id,
    label: frame.label,
    orientation,
    src: portrait ? frame.portrait : frame.landscape,
  }));
}
