import { propBox, propPieces, type BodaProp } from "./props";

export type Facing = "user" | "environment";

type VideoSource = CanvasImageSource & { videoWidth: number; videoHeight: number };

export type FrameStamp = {
  image: HTMLImageElement;
  prop: BodaProp;
  images?: Record<string, HTMLImageElement | undefined>;
};

/** El accesorio queda entre la foto y el marco. Los botones no pasan por aquí. */
export function paintProp(ctx: CanvasRenderingContext2D, stamp: FrameStamp, frameWidth: number, frameHeight: number) {
  for (const piece of propPieces(stamp.prop)) {
    const image = piece.src === stamp.prop.src ? stamp.image : stamp.images?.[piece.src];
    if (!image?.naturalWidth || !image.naturalHeight) continue;
    const box = propBox(piece, frameWidth, frameHeight, image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, box.x, box.y, box.width, box.height);
  }
}

/** Mismo recorte que el visor: llena el marco y no acerca más de lo que ya se ve. */
export function coverRect(boxW: number, boxH: number, srcW: number, srcH: number) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/** Recorte que llena el marco, sin franjas. El espejo de la frontal queda en la foto guardada. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  source: VideoSource,
  frame: HTMLImageElement,
  facing: Facing,
  size?: { width: number; height: number },
  stamp?: FrameStamp | null,
) {
  const width = size?.width || frame.naturalWidth;
  const height = size?.height || frame.naturalHeight;
  if (!width || !height || !source.videoWidth || !source.videoHeight) return false;
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;
  ctx.fillStyle = "#140e10";
  ctx.fillRect(0, 0, width, height);
  const covered = coverRect(width, height, source.videoWidth, source.videoHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  if (facing === "user") {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, covered.x, covered.y, covered.width, covered.height);
  ctx.restore();
  if (stamp?.image && stamp.prop) paintProp(ctx, stamp, width, height);
  ctx.drawImage(frame, 0, 0, width, height);
  return true;
}

export function evenFrameSize(frame: HTMLImageElement) {
  const maxEdge = 1920;
  const long = Math.max(frame.naturalWidth, frame.naturalHeight) || 1;
  const scale = long > maxEdge ? maxEdge / long : 1;
  const width = Math.max(2, Math.round((frame.naturalWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round((frame.naturalHeight * scale) / 2) * 2);
  return { width, height };
}
