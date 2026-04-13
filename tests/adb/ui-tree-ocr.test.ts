import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UIElement } from "../../src/adb/types.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => ""),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
  getForegroundPackage: vi.fn(async () => "com.example.app"),
}));

vi.mock("../../src/adb/ocr.js", () => ({
  runOcrOnCurrentScreen: vi.fn(async () => ({ source: "ocr", screenshotPath: "/tmp/s.png", confidenceThreshold: 50, elements: [] })),
}));

import { readFile } from "node:fs/promises";
import { adbShell } from "../../src/adb/exec.js";
import { runOcrOnCurrentScreen } from "../../src/adb/ocr.js";
import { dumpUiTree } from "../../src/adb/ui-tree.js";

const mockReadFile = vi.mocked(readFile);
const mockAdbShell = vi.mocked(adbShell);
const mockRunOcrOnCurrentScreen = vi.mocked(runOcrOnCurrentScreen);

function makeOcrElement(text: string): UIElement {
  return {
    resourceId: "",
    text,
    contentDesc: text,
    className: "android.view.View",
    packageName: "ocr",
    bounds: { left: 100, top: 200, right: 300, bottom: 260 },
    center: { x: 200, y: 230 },
    clickable: false,
    focusable: true,
    scrollable: false,
    enabled: true,
    selected: false,
    checked: false,
    children: [],
    depth: 0,
    index: 0,
    source: "ocr",
    confidence: 99,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdbShell.mockImplementation(async () => "");
});

describe("dumpUiTree() OCR fallback", () => {
  it("uses OCR fallback when XML is minimal and merges results", async () => {
    mockReadFile.mockResolvedValue(`<?xml version="1.0"?><hierarchy><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" clickable="false" enabled="true" focusable="false" scrollable="false" selected="false" checked="false" bounds="[0,0][1440,2960]"/></hierarchy>`);
    mockRunOcrOnCurrentScreen.mockResolvedValue({
      source: "ocr",
      screenshotPath: "/tmp/screen.png",
      confidenceThreshold: 50,
      elements: [makeOcrElement("Play")],
    });

    const result = await dumpUiTree({ skipCache: true, ocrConfidenceThreshold: 70 });

    expect(result.source).toBe("merged");
    expect(result.elements.some((el) => el.text === "Play")).toBe(true);
    expect(mockRunOcrOnCurrentScreen).toHaveBeenCalledWith(expect.objectContaining({ confidenceThreshold: 70 }));
  });

  it("uses OCR-only output when uiautomator dump fails", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("uiautomator dump")) {
        throw new Error("uiautomator failed");
      }
      return "";
    });
    mockRunOcrOnCurrentScreen.mockResolvedValue({
      source: "ocr",
      screenshotPath: "/tmp/screen.png",
      confidenceThreshold: 50,
      elements: [makeOcrElement("Continue")],
    });

    const result = await dumpUiTree({ skipCache: true });

    expect(result.source).toBe("ocr");
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].text).toBe("Continue");
  });

  it("logs dump failure when debug option is enabled", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("uiautomator dump")) {
        throw new Error("uiautomator failed");
      }
      return "";
    });
    mockRunOcrOnCurrentScreen.mockResolvedValue({
      source: "ocr",
      screenshotPath: "/tmp/screen.png",
      confidenceThreshold: 50,
      elements: [makeOcrElement("Continue")],
    });

    await dumpUiTree({ skipCache: true, debug: true });
    expect(warnSpy).toHaveBeenCalledWith(
      "uiautomator dump failed, trying OCR fallback:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("does not run OCR when UI dump is usable", async () => {
    mockReadFile.mockResolvedValue(`<?xml version="1.0"?><hierarchy><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" clickable="false" enabled="true" focusable="false" scrollable="false" selected="false" checked="false" bounds="[0,0][1440,2960]"/><node index="1" text="Login" resource-id="com.example:id/login" class="android.widget.Button" package="com.example.app" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" selected="false" checked="false" bounds="[100,100][300,180]"/><node index="2" text="Username" resource-id="com.example:id/user" class="android.widget.EditText" package="com.example.app" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" selected="false" checked="false" bounds="[100,220][500,320]"/></hierarchy>`);

    const result = await dumpUiTree({ skipCache: true });

    expect(result.source).toBe("uiautomator");
    expect(mockRunOcrOnCurrentScreen).not.toHaveBeenCalled();
  });
});
