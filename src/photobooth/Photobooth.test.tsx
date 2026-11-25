// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Photobooth from "./Photobooth";

vi.mock("./camera-session", () => ({
  acquireCamera: () => new Promise(() => {}),
  cameraAccepted: () => false,
  holdCamera: () => () => {},
  tuneCamera: () => Promise.resolve(),
}));

let portrait = false;
const changes = new Set<() => void>();
beforeEach(() => {
  portrait = false;
  changes.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return portrait; },
    addEventListener: (_event: string, callback: () => void) => changes.add(callback),
    removeEventListener: (_event: string, callback: () => void) => changes.delete(callback),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1280, height: 800, x: 0, y: 0, top: 0, left: 0, right: 1280, bottom: 800, toJSON: () => ({}),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("accessory controls", () => {
  it("shows glasses on the first click in landscape, and hides them on the next click", () => {
    const { container } = render(<Photobooth />);
    fireEvent.click(screen.getByRole("button", { name: "Tomarte fotos" }));
    fireEvent.click(screen.getByRole("button", { name: /^Accesorios$/ }));
    expect(container.querySelector("[data-accessory=lentes]")).not.toBeNull();
    expect(container.querySelector("[data-frame]")?.getAttribute("data-props")).toBe("lentes");
    fireEvent.click(screen.getByRole("button", { name: "Quitar accesorios" }));
    expect(container.querySelector("[data-accessory]")).toBeNull();
    expect(screen.getByRole("button", { name: "Marco siguiente" })).toBeTruthy();
  });

  it("changes the accessory instead of the frame in landscape and keeps it after rotation", () => {
    const { container } = render(<Photobooth />);
    fireEvent.click(screen.getByRole("button", { name: "Tomarte fotos" }));
    const frame = container.querySelector("[data-frame]")?.getAttribute("data-frame");
    fireEvent.click(screen.getByRole("button", { name: /^Accesorios$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Accesorio siguiente" }));
    expect(container.querySelector("[data-accessory=velo]")).not.toBeNull();
    expect(container.querySelector("[data-frame]")?.getAttribute("data-frame")).toBe(frame);
    act(() => { portrait = true; changes.forEach((change) => change()); });
    expect(container.querySelector("[data-screen]")?.getAttribute("data-orientation")).toBe("portrait");
    expect(container.querySelector("[data-accessory=velo]")).not.toBeNull();
    act(() => { portrait = false; changes.forEach((change) => change()); });
    expect(container.querySelector("[data-accessory=velo]")).not.toBeNull();
  });
});
