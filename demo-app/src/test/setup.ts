import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement matchMedia.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!window.DOMMatrix) {
    window.DOMMatrix = class {
      constructor() {}
    } as unknown as typeof DOMMatrix;
  }
  // Radix Select uses scrollIntoView; jsdom doesn't implement it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

beforeEach(() => {
  // Each test starts from a clean seed.
  window.localStorage.clear();
  // Simulate the production <html lang="ar" dir="rtl"> root.
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
