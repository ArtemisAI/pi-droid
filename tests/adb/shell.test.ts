import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
}));

import { adbShell } from "../../src/adb/exec.js";
import {
  executeShell,
  executeShellScript,
  getProcessList,
  killProcess,
  getMemoryInfo,
} from "../../src/adb/shell.js";

const mockAdbShell = vi.mocked(adbShell);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── executeShell ─────────────────────────────────────────────────────

describe("executeShell()", () => {
  it("returns stdout and exit code 0 on success", async () => {
    mockAdbShell.mockResolvedValue("hello world\n:::EXIT_CODE::0");
    const result = await executeShell("echo hello world");
    expect(result.stdout).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("captures non-zero exit code", async () => {
    mockAdbShell.mockResolvedValue("ls: /nope: No such file or directory\n:::EXIT_CODE::1");
    const result = await executeShell("ls /nope");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("No such file or directory");
  });

  it("handles output with no exit code marker gracefully", async () => {
    mockAdbShell.mockResolvedValue("some output without marker");
    const result = await executeShell("some cmd");
    expect(result.stdout).toBe("some output without marker");
    expect(result.exitCode).toBe(0);
  });

  it("passes serial and timeout options through", async () => {
    mockAdbShell.mockResolvedValue(":::EXIT_CODE::0");
    await executeShell("whoami", { serial: "ABC123", timeout: 5000 });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.stringContaining("whoami"),
      expect.objectContaining({ serial: "ABC123", timeout: 5000 }),
    );
  });

  it("passes maxOutput as maxBuffer", async () => {
    mockAdbShell.mockResolvedValue(":::EXIT_CODE::0");
    await executeShell("cat /dev/zero", { maxOutput: 512 });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxBuffer: 512 }),
    );
  });

  it("handles empty stdout", async () => {
    mockAdbShell.mockResolvedValue(":::EXIT_CODE::0");
    const result = await executeShell("true");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("handles multi-line output", async () => {
    mockAdbShell.mockResolvedValue("line1\nline2\nline3\n:::EXIT_CODE::0");
    const result = await executeShell("seq 1 3");
    expect(result.stdout).toBe("line1\nline2\nline3");
    expect(result.exitCode).toBe(0);
  });
});

// ── executeShellScript ───────────────────────────────────────────────

describe("executeShellScript()", () => {
  it("pushes script, executes, and cleans up", async () => {
    // First call: push script via base64
    // Second call: the executeShell wrapper (the actual command)
    // Third call: rm cleanup
    let callCount = 0;
    mockAdbShell.mockImplementation(async (cmd: string) => {
      callCount++;
      if (cmd.includes("base64")) return ""; // push
      if (cmd.includes("rm -f")) return ""; // cleanup
      return "script output\n:::EXIT_CODE::0"; // execution
    });

    const result = await executeShellScript("echo hello\necho world");
    expect(result.stdout).toBe("script output");
    expect(result.exitCode).toBe(0);

    // Verify push, execute, and cleanup calls
    const calls = mockAdbShell.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("base64");
    expect(calls[0]).toContain("chmod");
    expect(calls[1]).toContain("sh ");
    expect(calls[2]).toContain("rm -f");
  });

  it("uses custom interpreter", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("base64")) return "";
      if (cmd.includes("rm -f")) return "";
      return ":::EXIT_CODE::0";
    });

    await executeShellScript("print('hi')", { interpreter: "python3" });

    const calls = mockAdbShell.mock.calls.map((c) => c[0] as string);
    const execCall = calls.find((c) => c.includes("python3"));
    expect(execCall).toBeDefined();
  });

  it("cleans up even when execution fails", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("base64")) return "";
      if (cmd.includes("rm -f")) return "";
      throw new Error("execution failed");
    });

    await expect(executeShellScript("bad script")).rejects.toThrow("execution failed");

    // rm should still have been called
    const calls = mockAdbShell.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("rm -f"))).toBe(true);
  });
});

// ── getProcessList ───────────────────────────────────────────────────

describe("getProcessList()", () => {
  it("parses standard ps output", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "  PID USER          RSS NAME",
        "    1 root         4500 init",
        "  234 system      12800 system_server",
        " 1024 u0_a123      8192 com.example.app",
      ].join("\n"),
    );

    const procs = await getProcessList();
    expect(procs).toHaveLength(3);

    expect(procs[0]).toEqual({ pid: 1, user: "root", rss: 4500, name: "init" });
    expect(procs[1]).toEqual({ pid: 234, user: "system", rss: 12800, name: "system_server" });
    expect(procs[2]).toEqual({ pid: 1024, user: "u0_a123", rss: 8192, name: "com.example.app" });
  });

  it("handles empty process list", async () => {
    mockAdbShell.mockResolvedValue("  PID USER          RSS NAME\n");
    const procs = await getProcessList();
    expect(procs).toHaveLength(0);
  });

  it("skips malformed lines", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "  PID USER          RSS NAME",
        "    1 root         4500 init",
        "garbage line",
        "  notanumber user 100 app",
        "",
        "  500 system      2048 zygote",
      ].join("\n"),
    );

    const procs = await getProcessList();
    expect(procs).toHaveLength(2);
    expect(procs[0].pid).toBe(1);
    expect(procs[1].pid).toBe(500);
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("  PID USER RSS NAME\n");
    await getProcessList({ serial: "DEV1" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "ps -A -o PID,USER,RSS,NAME",
      expect.objectContaining({ serial: "DEV1" }),
    );
  });
});

// ── killProcess ──────────────────────────────────────────────────────

describe("killProcess()", () => {
  it("returns true when kill succeeds (exit code 0)", async () => {
    mockAdbShell.mockResolvedValue(":::EXIT_CODE::0");
    const ok = await killProcess(1234);
    expect(ok).toBe(true);
  });

  it("returns false when kill fails (exit code 1)", async () => {
    mockAdbShell.mockResolvedValue("No such process\n:::EXIT_CODE::1");
    const ok = await killProcess(9999);
    expect(ok).toBe(false);
  });

  it("returns false when adb throws", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const ok = await killProcess(1);
    expect(ok).toBe(false);
  });

  it("sends the correct kill command", async () => {
    mockAdbShell.mockResolvedValue(":::EXIT_CODE::0");
    await killProcess(42);
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.stringContaining("kill 42"),
      expect.any(Object),
    );
  });
});

// ── getMemoryInfo ────────────────────────────────────────────────────

describe("getMemoryInfo()", () => {
  const meminfo = [
    "MemTotal:        3842088 kB",
    "MemFree:          512000 kB",
    "MemAvailable:    1536000 kB",
    "Buffers:          102400 kB",
    "Cached:           819200 kB",
  ].join("\n");

  it("parses /proc/meminfo correctly", async () => {
    mockAdbShell.mockResolvedValue(meminfo);
    const info = await getMemoryInfo();

    expect(info.totalMb).toBe(Math.round(3842088 / 1024));
    expect(info.freeMb).toBe(Math.round(512000 / 1024));
    expect(info.availableMb).toBe(Math.round(1536000 / 1024));
    expect(info.usedPercent).toBe(Math.round(((3842088 - 1536000) / 3842088) * 100));
  });

  it("reads cat /proc/meminfo", async () => {
    mockAdbShell.mockResolvedValue(meminfo);
    await getMemoryInfo({ serial: "XYZ" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "cat /proc/meminfo",
      expect.objectContaining({ serial: "XYZ" }),
    );
  });

  it("throws when meminfo is missing expected fields", async () => {
    mockAdbShell.mockResolvedValue("MemTotal: 4096 kB\nMemFree: 1024 kB\n");
    await expect(getMemoryInfo()).rejects.toThrow("Could not find MemAvailable");
  });
});
