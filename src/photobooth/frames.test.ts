import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { orderedFrames } from "./frames";
import { propSources } from "./props";
import { coverRect } from "./frame-paint";

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
});
