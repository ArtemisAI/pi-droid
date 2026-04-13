import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

import { adbShell, adb } from "../../src/adb/exec.js";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  startRecording,
  stopRecording,
  pullRecording,
  isRecording,
} from "../../src/adb/recording.js";

const mockAdbShell = vi.mocked(adbShell);
const mockAdb = vi.mocked(adb);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdir = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── startRecording ──────────────────────────────────────────────────

describe("startRecording()", () => {
  it("returns the remote path", async () => {
    mockAdbShell.mockResolvedValue("");
    const path = await startRecording();
    expect(path).toBe("/sdcard/pi-droid-rec.mp4");
  });

  it("sends screenrecord command with default 180s time limit", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording();
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("screenrecord");
    expect(call).toContain("--time-limit 180");
    expect(call).toContain("/sdcard/pi-droid-rec.mp4");
  });

  it("uses nohup and background execution", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording();
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("nohup");
    expect(call).toContain("> /dev/null 2>&1 &");
  });

  it("applies custom maxDuration", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording({ maxDuration: 60 });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("--time-limit 60");
  });

  it("applies bitRate option", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording({ bitRate: 6000000 });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("--bit-rate 6000000");
  });

  it("applies size option", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording({ size: "1280x720" });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("--size 1280x720");
  });

  it("applies all options together", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording({ maxDuration: 30, bitRate: 4000000, size: "720x1280" });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("--time-limit 30");
    expect(call).toContain("--bit-rate 4000000");
    expect(call).toContain("--size 720x1280");
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await startRecording({ serial: "ABC123" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "ABC123" }),
    );
  });
});

// ── stopRecording ───────────────────────────────────────────────────

describe("stopRecording()", () => {
  it("sends pkill -INT to screenrecord", async () => {
    mockAdbShell.mockResolvedValue("");
    await stopRecording();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "pkill -INT screenrecord",
      expect.any(Object),
    );
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await stopRecording({ serial: "DEV1" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "pkill -INT screenrecord",
      expect.objectContaining({ serial: "DEV1" }),
    );
  });
});

// ── pullRecording ───────────────────────────────────────────────────

describe("pullRecording()", () => {
  it("creates output directory if it does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockAdb.mockResolvedValue("");
    await pullRecording();
    expect(mockMkdir).toHaveBeenCalledWith("/tmp/pi-droid/recordings", { recursive: true });
  });

  it("skips mkdir if directory exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockAdb.mockResolvedValue("");
    await pullRecording();
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("pulls from the correct remote path", async () => {
    mockExistsSync.mockReturnValue(true);
    mockAdb.mockResolvedValue("");
    await pullRecording();
    const pullArgs = mockAdb.mock.calls[0][0] as string[];
    expect(pullArgs[0]).toBe("pull");
    expect(pullArgs[1]).toBe("/sdcard/pi-droid-rec.mp4");
  });

  it("returns a local path with timestamp", async () => {
    mockExistsSync.mockReturnValue(true);
    mockAdb.mockResolvedValue("");
    const localPath = await pullRecording();
    expect(localPath).toMatch(/\/tmp\/pi-droid\/recordings\/rec_.*\.mp4$/);
  });

  it("uses custom local directory", async () => {
    mockExistsSync.mockReturnValue(false);
    mockAdb.mockResolvedValue("");
    const localPath = await pullRecording("/my/custom/dir");
    expect(mockMkdir).toHaveBeenCalledWith("/my/custom/dir", { recursive: true });
    expect(localPath).toMatch(/\/my\/custom\/dir\/rec_.*\.mp4$/);
  });

  it("passes serial option to adb pull", async () => {
    mockExistsSync.mockReturnValue(true);
    mockAdb.mockResolvedValue("");
    await pullRecording(undefined, { serial: "S9" });
    expect(mockAdb).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ serial: "S9" }),
    );
  });
});

// ── isRecording ─────────────────────────────────────────────────────

describe("isRecording()", () => {
  it("returns true when pidof returns a PID", async () => {
    mockAdbShell.mockResolvedValue("12345");
    const result = await isRecording();
    expect(result).toBe(true);
  });

  it("returns false when pidof returns empty", async () => {
    mockAdbShell.mockResolvedValue("  ");
    const result = await isRecording();
    expect(result).toBe(false);
  });

  it("returns false when adbShell throws", async () => {
    mockAdbShell.mockRejectedValue(new Error("no process found"));
    const result = await isRecording();
    expect(result).toBe(false);
  });

  it("calls pidof screenrecord", async () => {
    mockAdbShell.mockResolvedValue("");
    await isRecording();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "pidof screenrecord",
      expect.any(Object),
    );
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await isRecording({ serial: "XYZ" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "pidof screenrecord",
      expect.objectContaining({ serial: "XYZ" }),
    );
  });
});
