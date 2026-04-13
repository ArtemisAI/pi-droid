import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../src/adb/screenshot.js", () => ({
  takeScreenshot: vi.fn(),
}));

import { execFile } from "node:child_process";
import { takeScreenshot } from "../../src/adb/screenshot.js";
import { runOcrOnImage, runOcrOnCurrentScreen } from "../../src/adb/ocr.js";

const mockExecFile = vi.mocked(execFile);
const mockTakeScreenshot = vi.mocked(takeScreenshot);

const TSV_OUTPUT = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t100\t200\t120\t30\t95.4\tPlay",
  "5\t1\t1\t1\t1\t2\t240\t200\t150\t30\t42.0\tLowConf",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    if (cb) cb(null, { stdout: TSV_OUTPUT, stderr: "" });
    return {} as any;
  });
});

describe("runOcrOnImage()", () => {
  it("throws a clear install error when tesseract is missing", async () => {
    mockExecFile.mockImplementation((_cmd, args, _opts, callback?: any) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      if (Array.isArray(args) && args[0] === "--version") {
        const err: any = new Error("spawn tesseract ENOENT");
        err.code = "ENOENT";
        if (cb) cb(err);
        return {} as any;
      }
      if (cb) cb(null, { stdout: TSV_OUTPUT, stderr: "" });
      return {} as any;
    });

    await expect(runOcrOnImage("/tmp/screen.png")).rejects.toThrow(
      "Tesseract is not installed. Install with: apt install tesseract-ocr",
    );
  });

  it("extracts OCR elements with bounds and confidence", async () => {
    const result = await runOcrOnImage("/tmp/screen.png", { confidenceThreshold: 50 });
    expect(result.source).toBe("ocr");
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].text).toBe("Play");
    expect(result.elements[0].bounds).toEqual({ left: 100, top: 200, right: 220, bottom: 230 });
    expect(result.elements[0].source).toBe("ocr");
    expect(result.elements[0].confidence).toBe(95.4);
  });

  it("invokes tesseract with TSV output mode", async () => {
    await runOcrOnImage("/tmp/screen.png");
    expect(mockExecFile).toHaveBeenCalledWith(
      "tesseract",
      ["/tmp/screen.png", "stdout", "tsv"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe("runOcrOnCurrentScreen()", () => {
  it("captures screenshot before OCR", async () => {
    mockTakeScreenshot.mockResolvedValue({
      path: "/tmp/current.png",
      width: 1440,
      height: 2960,
    });
    const result = await runOcrOnCurrentScreen({ serial: "ABC123", confidenceThreshold: 50 });
    expect(mockTakeScreenshot).toHaveBeenCalledWith(expect.objectContaining({ serial: "ABC123" }));
    expect(result.screenshotPath).toBe("/tmp/current.png");
  });
});
