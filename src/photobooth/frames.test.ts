import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { orderedFrames } from "./frames";
import { propBox, propById, propSources } from "./props";
import { coverRect, paintProp } from "./frame-paint";

describe("templates and camera composition", () => {
  it("includes both orientations for every frame and all accessory PNGs", () => {
    const portrait = orderedFrames(true);
    const landscape = orderedFrames(false);
    expect(portrait).toHaveLength(9);
    expect(landscape.map((frame) => frame.id)).toEqual(portrait.map((frame) => frame.id));
    for (const src of [...portrait, ...landscape].map((frame) => frame.src).concat(propSources())) {
      const path = `public/${src.replace(/^\.?\//, "")}`;
      expect(existsSync(path), src).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
    }
  });

  it("fills a portrait frame with landscape video without stretching it", () => {
    const rect = coverRect(900, 1600, 1920, 1080);
    expect(rect.height).toBe(1600);
    expect(rect.width / rect.height).toBeCloseTo(1920 / 1080);
    expect(rect.x).toBeLessThan(0);
    expect(rect.y).toBe(0);
  });

  it("keeps glasses at the same face scale when rotating a frame of the same height", () => {
    const glasses = propById("lentes")!;
    const portrait = propBox(glasses, 360, 640, 700, 500);
    const landscape = propBox(glasses, 1137, 640, 700, 500);
    expect(portrait.width).toBeCloseTo(360 * glasses.width);
    expect(landscape.width).toBeCloseTo(portrait.width);
    expect(landscape.height).toBeCloseTo(portrait.height);
    expect(landscape.x + landscape.width * glasses.anchorX).toBeCloseTo(1137 / 2);
    expect(landscape.y).toBeCloseTo(portrait.y);
  });

  it("uses matching accessory coordinates in the preview and exported landscape photo", () => {
    const glasses = propById("lentes")!;
    const preview = propBox(glasses, 960, 540, 700, 500);
    const image = { naturalWidth: 700, naturalHeight: 500 } as HTMLImageElement;
    const calls: unknown[][] = [];
    const context = { drawImage: (...args: unknown[]) => calls.push(args) } as unknown as CanvasRenderingContext2D;
    paintProp(context, { prop: glasses, image }, 3840, 2160);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(image);
    expect(calls[0].slice(1)).toEqual([preview.x, preview.y, preview.width, preview.height].map((value) => value * 4));
  });
});
