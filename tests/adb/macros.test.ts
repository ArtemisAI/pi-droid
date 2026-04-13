import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock input module used by macros
vi.mock("../../src/adb/input.js", () => ({
  tap: vi.fn(async () => {}),
  swipe: vi.fn(async () => {}),
  typeText: vi.fn(async () => {}),
  keyEvent: vi.fn(async () => {}),
}));

import { tap, swipe, typeText, keyEvent } from "../../src/adb/input.js";
import {
  executeMacro,
  saveMacro,
  loadMacro,
  listMacros,
} from "../../src/adb/macros.js";
import type { GestureMacro } from "../../src/adb/types.js";

const mockTap = vi.mocked(tap);
const mockSwipe = vi.mocked(swipe);
const mockTypeText = vi.mocked(typeText);
const mockKeyEvent = vi.mocked(keyEvent);

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await mkdtemp(join(tmpdir(), "pi-droid-macro-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeMacro(overrides: Partial<GestureMacro> = {}): GestureMacro {
  return {
    name: "test-macro",
    description: "A test macro",
    steps: [],
    ...overrides,
  };
}

describe("executeMacro()", () => {
  it("calls tap for tap steps", async () => {
    const macro = makeMacro({
      steps: [{ type: "tap", params: { x: 100, y: 200 } }],
    });
    await executeMacro(macro);
    expect(mockTap).toHaveBeenCalledWith(100, 200, { duration: undefined });
  });

  it("calls swipe for swipe steps", async () => {
    const macro = makeMacro({
      steps: [{ type: "swipe", params: { x1: 0, y1: 100, x2: 0, y2: 500, duration: 300 } }],
    });
    await executeMacro(macro);
    expect(mockSwipe).toHaveBeenCalledWith(0, 100, 0, 500, { duration: 300 });
  });

  it("calls keyEvent for key steps", async () => {
    const macro = makeMacro({
      steps: [{ type: "key", params: { keycode: "KEYCODE_BACK" } }],
    });
    await executeMacro(macro);
    expect(mockKeyEvent).toHaveBeenCalledWith("KEYCODE_BACK");
  });

  it("calls typeText for type steps", async () => {
    const macro = makeMacro({
      steps: [{ type: "type", params: { text: "hello world" } }],
    });
    await executeMacro(macro);
    expect(mockTypeText).toHaveBeenCalledWith("hello world");
  });

  it("executes multiple steps in order", async () => {
    const callOrder: string[] = [];
    mockTap.mockImplementation(async () => { callOrder.push("tap"); });
    mockKeyEvent.mockImplementation(async () => { callOrder.push("key"); });
    mockTypeText.mockImplementation(async () => { callOrder.push("type"); });

    const macro = makeMacro({
      steps: [
        { type: "tap", params: { x: 10, y: 20 } },
        { type: "key", params: { keycode: "KEYCODE_TAB" } },
        { type: "type", params: { text: "test" } },
      ],
    });
    await executeMacro(macro, { stepDelay: 0 });
    expect(callOrder).toEqual(["tap", "key", "type"]);
  });

  it("throws on unknown step type", async () => {
    const macro = makeMacro({
      steps: [{ type: "unknown" as any, params: {} }],
    });
    await expect(executeMacro(macro)).rejects.toThrow("Unknown gesture step type");
  });

  it("handles wait steps (does not call input functions)", async () => {
    const macro = makeMacro({
      steps: [{ type: "wait", params: { ms: 1 } }],
    });
    await executeMacro(macro, { stepDelay: 0 });
    expect(mockTap).not.toHaveBeenCalled();
    expect(mockSwipe).not.toHaveBeenCalled();
    expect(mockKeyEvent).not.toHaveBeenCalled();
    expect(mockTypeText).not.toHaveBeenCalled();
  });
});

describe("saveMacro()", () => {
  it("writes macro JSON to the directory", async () => {
    const macro = makeMacro({
      steps: [{ type: "tap", params: { x: 1, y: 2 } }],
    });
    const filePath = await saveMacro(macro, tempDir);
    expect(filePath).toBe(join(tempDir, "test-macro.json"));

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("test-macro");
    expect(parsed.steps).toHaveLength(1);
  });

  it("creates directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "sub", "dir");
    const macro = makeMacro();
    const filePath = await saveMacro(macro, nestedDir);
    expect(filePath).toContain("sub/dir/test-macro.json");
  });

  it("sanitizes unsafe characters in macro name", async () => {
    const macro = makeMacro({ name: "my macro/v2" });
    const filePath = await saveMacro(macro, tempDir);
    expect(filePath).toBe(join(tempDir, "my_macro_v2.json"));
  });
});

describe("loadMacro()", () => {
  it("loads a previously saved macro", async () => {
    const macro = makeMacro({
      description: "round-trip test",
      steps: [{ type: "key", params: { keycode: "KEYCODE_HOME" } }],
    });
    await saveMacro(macro, tempDir);
    const loaded = await loadMacro("test-macro", tempDir);
    expect(loaded.name).toBe("test-macro");
    expect(loaded.description).toBe("round-trip test");
    expect(loaded.steps).toHaveLength(1);
  });

  it("throws when macro file does not exist", async () => {
    await expect(loadMacro("nonexistent", tempDir)).rejects.toThrow();
  });
});

describe("listMacros()", () => {
  it("returns empty array for empty directory", async () => {
    const names = await listMacros(tempDir);
    expect(names).toEqual([]);
  });

  it("returns empty array when directory does not exist", async () => {
    const names = await listMacros(join(tempDir, "nope"));
    expect(names).toEqual([]);
  });

  it("lists saved macro names without .json extension", async () => {
    await saveMacro(makeMacro({ name: "alpha" }), tempDir);
    await saveMacro(makeMacro({ name: "beta" }), tempDir);
    const names = await listMacros(tempDir);
    expect(names.sort()).toEqual(["alpha", "beta"]);
  });
});
