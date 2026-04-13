import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock exec module
vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
}));

// Mock fs operations
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("fake-png-data")),
  unlink: vi.fn(async () => undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

import { adbShell, adb } from "../../src/adb/exec.js";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { takeScreenshot, setScreenshotDir, screenshotBase64 } from "../../src/adb/screenshot.js";

const mockAdbShell = vi.mocked(adbShell);
const mockAdb = vi.mocked(adb);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdir = vi.mocked(mkdir);
const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: wm size returns a standard resolution
  mockAdbShell.mockImplementation(async (cmd: string) => {
    if (cmd === "wm size") return "Physical size: 1440x2960";
    return "";
  });
  mockAdb.mockResolvedValue("");
  mockExistsSync.mockReturnValue(true);
  setScreenshotDir("/tmp/pi-droid/screenshots");
});

describe("takeScreenshot()", () => {
  it("captures screencap on device", async () => {
    await takeScreenshot();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "screencap -p /sdcard/pi-droid-screen.png",
      expect.any(Object),
    );
  });

  it("pulls screenshot to local path", async () => {
    const result = await takeScreenshot();
    expect(mockAdb).toHaveBeenCalledWith(
      ["pull", "/sdcard/pi-droid-screen.png", expect.stringContaining("screen_")],
      expect.any(Object),
    );
    expect(result.path).toContain("screen_");
    expect(result.path).toContain(".png");
  });

  it("uses custom prefix in filename", async () => {
    const result = await takeScreenshot({ prefix: "profile" });
    expect(result.path).toContain("profile_");
  });

  it("parses screen dimensions from wm size", async () => {
    const result = await takeScreenshot();
    expect(result.width).toBe(1440);
    expect(result.height).toBe(2960);
  });

  it("returns zero dimensions when wm size is unparseable", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd === "wm size") return "no display";
      return "";
    });
    const result = await takeScreenshot();
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("creates screenshot directory if it does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await takeScreenshot();
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("screenshots"),
      { recursive: true },
    );
  });

  it("does not create directory if it already exists", async () => {
    mockExistsSync.mockReturnValue(true);
    await takeScreenshot();
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("includes base64 when option is set", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake-png") as any);
    const result = await takeScreenshot({ includeBase64: true });
    expect(result.base64).toBe(Buffer.from("fake-png").toString("base64"));
  });

  it("does not include base64 by default", async () => {
    const result = await takeScreenshot();
    expect(result.base64).toBeUndefined();
  });

  it("passes serial option through to adb calls", async () => {
    await takeScreenshot({ serial: "XYZ789" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "XYZ789" }),
    );
    expect(mockAdb).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ serial: "XYZ789" }),
    );
  });

  it("respects custom screenshot directory", async () => {
    setScreenshotDir("/custom/dir");
    const result = await takeScreenshot();
    expect(result.path).toContain("/custom/dir/");
  });
});

describe("screenshotBase64()", () => {
  it("captures and returns base64 string", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("image-data") as any);
    const b64 = await screenshotBase64();
    expect(b64).toBe(Buffer.from("image-data").toString("base64"));
  });

  it("pulls to a temp path", async () => {
    await screenshotBase64();
    expect(mockAdb).toHaveBeenCalledWith(
      ["pull", "/sdcard/pi-droid-screen.png", expect.stringContaining("/tmp/pi-droid-quick-")],
      expect.any(Object),
    );
  });
});
