import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCachedTree,
  setCachedTree,
  invalidateCache,
  isCacheValid,
  setCacheTtl,
} from "../../src/adb/cache.js";
import type { UITreeResult } from "../../src/adb/types.js";

function makeFakeTree(label = "test"): UITreeResult {
  return {
    elements: [],
    interactive: [],
    rawXml: `<hierarchy>${label}</hierarchy>`,
    xmlPath: `/tmp/fake_${label}.xml`,
    foregroundPackage: "com.test.app",
  };
}

beforeEach(() => {
  invalidateCache();
  setCacheTtl(2000); // reset to default
});

describe("cache set/get", () => {
  it("returns null when cache is empty", () => {
    expect(getCachedTree()).toBeNull();
    expect(isCacheValid()).toBe(false);
  });

  it("returns stored tree before TTL expires", () => {
    const tree = makeFakeTree();
    setCachedTree(tree);
    expect(getCachedTree()).toBe(tree);
    expect(isCacheValid()).toBe(true);
  });
});

describe("invalidateCache", () => {
  it("clears the cache so get returns null", () => {
    setCachedTree(makeFakeTree());
    expect(isCacheValid()).toBe(true);
    invalidateCache();
    expect(getCachedTree()).toBeNull();
    expect(isCacheValid()).toBe(false);
  });
});

describe("TTL expiration", () => {
  it("returns null after TTL expires", () => {
    setCacheTtl(50); // 50ms TTL
    setCachedTree(makeFakeTree());
    expect(getCachedTree()).not.toBeNull();

    // Advance time past TTL
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    expect(getCachedTree()).toBeNull();
    vi.useRealTimers();
  });

  it("returns tree within TTL window", () => {
    setCacheTtl(5000);
    const tree = makeFakeTree();
    setCachedTree(tree);

    vi.useFakeTimers();
    vi.advanceTimersByTime(1000); // still within 5s
    expect(getCachedTree()).toBe(tree);
    vi.useRealTimers();
  });
});
