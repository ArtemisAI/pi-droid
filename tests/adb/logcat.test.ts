import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock exec module
vi.mock("../../src/adb/exec.js", () => ({
  adb: vi.fn(async () => ""),
}));

import { adb } from "../../src/adb/exec.js";
import {
  captureLogcat,
  searchLogcat,
  clearLogcat,
  getLogcatStats,
} from "../../src/adb/logcat.js";

const mockAdb = vi.mocked(adb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureLogcat()", () => {
  it("dumps logcat in non-blocking mode", async () => {
    mockAdb.mockResolvedValue("line1\nline2\nline3");
    const result = await captureLogcat({ duration: 0 });

    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-d"],
      expect.any(Object),
    );
    expect(result.lines).toEqual(["line1", "line2", "line3"]);
    expect(result.count).toBe(3);
  });

  it("clears logcat before capturing when clear option is set", async () => {
    mockAdb.mockResolvedValue("fresh log");
    await captureLogcat({ duration: 0, clear: true });

    // First call should be clear, second should be dump
    expect(mockAdb).toHaveBeenCalledTimes(2);
    expect(mockAdb).toHaveBeenNthCalledWith(1, ["logcat", "-c"], expect.any(Object));
    expect(mockAdb).toHaveBeenNthCalledWith(2, ["logcat", "-d"], expect.any(Object));
  });

  it("applies filter spec to logcat args", async () => {
    mockAdb.mockResolvedValue("filtered output");
    await captureLogcat({ duration: 0, filter: "ActivityManager:I" });

    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-d", "ActivityManager:I", "*:S"],
      expect.any(Object),
    );
  });

  it("limits output to maxLines", async () => {
    const manyLines = Array.from({ length: 300 }, (_, i) => `line${i}`).join("\n");
    mockAdb.mockResolvedValue(manyLines);

    const result = await captureLogcat({ duration: 0, maxLines: 50 });
    expect(result.lines).toHaveLength(50);
    expect(result.count).toBe(50);
    // Should return the LAST 50 lines
    expect(result.lines[0]).toBe("line250");
    expect(result.lines[49]).toBe("line299");
  });

  it("returns default duration of 5000", async () => {
    mockAdb.mockResolvedValue("");
    const result = await captureLogcat({ duration: 0 });
    expect(result.duration).toBe(0);
  });

  it("passes serial option through to adb", async () => {
    mockAdb.mockResolvedValue("log");
    await captureLogcat({ duration: 0, serial: "ABC123" });

    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-d"],
      expect.objectContaining({ serial: "ABC123" }),
    );
  });

  it("filters out empty lines", async () => {
    mockAdb.mockResolvedValue("line1\n\n  \nline2\n");
    const result = await captureLogcat({ duration: 0 });
    expect(result.lines).toEqual(["line1", "line2"]);
  });
});

describe("searchLogcat()", () => {
  it("uses -t N -d to fetch recent lines", async () => {
    mockAdb.mockResolvedValue("some log line");
    await searchLogcat("pattern");

    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-t", "1000", "-d"],
      expect.any(Object),
    );
  });

  it("filters lines matching the regex pattern", async () => {
    mockAdb.mockResolvedValue(
      [
        "04-08 12:00:00 I/ActivityManager: Start proc",
        "04-08 12:00:01 D/dalvikvm: GC freed 123K",
        "04-08 12:00:02 E/ActivityManager: ANR in com.example",
        "04-08 12:00:03 I/SurfaceFlinger: VSYNC",
      ].join("\n"),
    );

    const matches = await searchLogcat("ActivityManager");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toContain("Start proc");
    expect(matches[1]).toContain("ANR");
  });

  it("supports regex patterns", async () => {
    mockAdb.mockResolvedValue("error 404\nwarning low\nerror 500\ninfo ok");
    const matches = await searchLogcat("error \\d+");
    expect(matches).toEqual(["error 404", "error 500"]);
  });

  it("uses custom line count", async () => {
    mockAdb.mockResolvedValue("");
    await searchLogcat("test", { lines: 500 });

    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-t", "500", "-d"],
      expect.any(Object),
    );
  });

  it("returns empty array when no matches", async () => {
    mockAdb.mockResolvedValue("nothing relevant here");
    const matches = await searchLogcat("NONEXISTENT_TAG");
    expect(matches).toEqual([]);
  });

  it("passes serial option through to adb", async () => {
    mockAdb.mockResolvedValue("");
    await searchLogcat("test", { serial: "XYZ789" });

    expect(mockAdb).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ serial: "XYZ789" }),
    );
  });
});

describe("clearLogcat()", () => {
  it("calls adb logcat -c", async () => {
    await clearLogcat();
    expect(mockAdb).toHaveBeenCalledWith(["logcat", "-c"], expect.any(Object));
  });

  it("passes serial option through to adb", async () => {
    await clearLogcat({ serial: "DEV001" });
    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-c"],
      expect.objectContaining({ serial: "DEV001" }),
    );
  });
});

describe("getLogcatStats()", () => {
  it("calls adb logcat -g", async () => {
    mockAdb.mockResolvedValue("main: ring buffer is 256Kb\nsystem: ring buffer is 256Kb\ncrash: ring buffer is 64Kb");
    await getLogcatStats();
    expect(mockAdb).toHaveBeenCalledWith(["logcat", "-g"], expect.any(Object));
  });

  it("parses buffer sizes from output", async () => {
    mockAdb.mockResolvedValue(
      [
        "main: ring buffer is 256Kb (64Kb consumed)",
        "system: ring buffer is 256Kb (32Kb consumed)",
        "crash: ring buffer is 64Kb (0b consumed)",
      ].join("\n"),
    );

    const stats = await getLogcatStats();
    expect(stats.main).toBe("256Kb");
    expect(stats.system).toBe("256Kb");
    expect(stats.crash).toBe("64Kb");
  });

  it("returns unknown for missing buffers", async () => {
    mockAdb.mockResolvedValue("some unexpected output");
    const stats = await getLogcatStats();
    expect(stats.main).toBe("unknown");
    expect(stats.system).toBe("unknown");
    expect(stats.crash).toBe("unknown");
  });

  it("passes serial option through to adb", async () => {
    mockAdb.mockResolvedValue("");
    await getLogcatStats({ serial: "PHONE1" });
    expect(mockAdb).toHaveBeenCalledWith(
      ["logcat", "-g"],
      expect.objectContaining({ serial: "PHONE1" }),
    );
  });
});
