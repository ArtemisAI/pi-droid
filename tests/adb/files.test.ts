import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
  getForegroundPackage: vi.fn(async () => ""),
}));

import { adbShell, adb } from "../../src/adb/exec.js";
import {
  pushFile,
  pullFile,
  listDir,
  deleteFile,
  getStorageInfo,
  fileExists,
} from "../../src/adb/files.js";

const mockAdbShell = vi.mocked(adbShell);
const mockAdb = vi.mocked(adb);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── pushFile ────────────────────────────────────────────────────────

describe("pushFile()", () => {
  it("calls adb push with correct args", async () => {
    mockAdb.mockResolvedValue("1 file pushed. 2.5 MB/s (1024 bytes in 0.001s)");

    const result = await pushFile("/tmp/local.txt", "/sdcard/remote.txt");
    expect(mockAdb).toHaveBeenCalledWith(
      ["push", "/tmp/local.txt", "/sdcard/remote.txt"],
      expect.any(Object),
    );
    expect(result.source).toBe("/tmp/local.txt");
    expect(result.destination).toBe("/sdcard/remote.txt");
    expect(result.output).toContain("1 file pushed");
  });

  it("passes serial option through", async () => {
    mockAdb.mockResolvedValue("pushed");
    await pushFile("/tmp/a", "/sdcard/b", { serial: "DEV1" });
    expect(mockAdb).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ serial: "DEV1" }),
    );
  });
});

// ── pullFile ────────────────────────────────────────────────────────

describe("pullFile()", () => {
  it("calls adb pull with correct args", async () => {
    mockAdb.mockResolvedValue("1 file pulled. 3.0 MB/s (2048 bytes in 0.001s)");

    const result = await pullFile("/sdcard/remote.txt", "/tmp/local.txt");
    expect(mockAdb).toHaveBeenCalledWith(
      ["pull", "/sdcard/remote.txt", "/tmp/local.txt"],
      expect.any(Object),
    );
    expect(result.source).toBe("/sdcard/remote.txt");
    expect(result.destination).toBe("/tmp/local.txt");
    expect(result.output).toContain("1 file pulled");
  });
});

// ── listDir ─────────────────────────────────────────────────────────

describe("listDir()", () => {
  it("parses ls -la output into DirEntry objects", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "total 24",
        "drwxr-xr-x 3 root root 4096 2024-01-15 10:30 subdir",
        "-rw-r--r-- 1 root root 1234 2024-01-15 10:30 file.txt",
        "lrwxrwxrwx 1 root root   12 2024-01-15 10:30 link -> /target",
        "drwxr-xr-x 2 root root 4096 2024-01-15 10:30 .",
        "drwxr-xr-x 5 root root 4096 2024-01-15 10:30 ..",
      ].join("\n"),
    );

    const entries = await listDir("/sdcard");
    expect(entries).toHaveLength(3); // excludes total, ., ..

    expect(entries[0]).toMatchObject({
      permissions: "drwxr-xr-x",
      owner: "root",
      group: "root",
      size: 4096,
      name: "subdir",
      isDirectory: true,
      isSymlink: false,
    });

    expect(entries[1]).toMatchObject({
      name: "file.txt",
      size: 1234,
      isDirectory: false,
    });

    expect(entries[2]).toMatchObject({
      name: "link",
      isSymlink: true,
    });
  });

  it("sends ls -la command with correct path", async () => {
    mockAdbShell.mockResolvedValue("");
    await listDir("/sdcard/Download");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "ls -la /sdcard/Download",
      expect.any(Object),
    );
  });

  it("returns empty array for empty directory", async () => {
    mockAdbShell.mockResolvedValue("total 0\n");
    const entries = await listDir("/empty");
    expect(entries).toEqual([]);
  });

  it("skips malformed lines", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "total 4",
        "-rw-r--r-- 1 root root 100 2024-01-15 10:30 good.txt",
        "short line",
        "",
      ].join("\n"),
    );
    const entries = await listDir("/sdcard");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("good.txt");
  });
});

// ── deleteFile ──────────────────────────────────────────────────────

describe("deleteFile()", () => {
  it("sends rm command for file", async () => {
    await deleteFile("/sdcard/file.txt");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "rm /sdcard/file.txt",
      expect.any(Object),
    );
  });

  it("sends rm -r for recursive delete", async () => {
    await deleteFile("/sdcard/dir", { recursive: true });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "rm -r /sdcard/dir",
      expect.any(Object),
    );
  });

  it("sends rm -r -f for recursive force delete", async () => {
    await deleteFile("/sdcard/dir", { recursive: true, force: true });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "rm -r -f /sdcard/dir",
      expect.any(Object),
    );
  });

  it("sends rm -f for force delete", async () => {
    await deleteFile("/sdcard/file.txt", { force: true });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "rm -f /sdcard/file.txt",
      expect.any(Object),
    );
  });
});

// ── getStorageInfo ──────────────────────────────────────────────────

describe("getStorageInfo()", () => {
  it("parses df -h output", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "Filesystem      Size  Used Avail Use% Mounted on",
        "/dev/block/dm-0  25G  12G   13G  48% /",
        "tmpfs            1.8G  100M 1.7G   6% /dev",
        "/dev/fuse        25G  12G   13G  48% /storage/emulated",
      ].join("\n"),
    );

    const info = await getStorageInfo();
    expect(info).toHaveLength(3);
    expect(info[0]).toEqual({
      filesystem: "/dev/block/dm-0",
      size: "25G",
      used: "12G",
      available: "13G",
      usePercent: "48%",
      mountedOn: "/",
    });
  });

  it("skips header and empty lines", async () => {
    mockAdbShell.mockResolvedValue(
      "Filesystem Size Used Avail Use% Mounted\n\n",
    );
    const info = await getStorageInfo();
    expect(info).toEqual([]);
  });

  it("skips lines with fewer than 6 columns", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "Filesystem Size Used Avail Use% Mounted",
        "/dev/dm-0 25G 12G 13G 48% /",
        "bad line",
      ].join("\n"),
    );
    const info = await getStorageInfo();
    expect(info).toHaveLength(1);
  });
});

// ── fileExists ──────────────────────────────────────────────────────

describe("fileExists()", () => {
  it("returns true when file exists", async () => {
    mockAdbShell.mockResolvedValue("EXISTS");
    const exists = await fileExists("/sdcard/file.txt");
    expect(exists).toBe(true);
  });

  it("returns false when file does not exist", async () => {
    mockAdbShell.mockResolvedValue("");
    const exists = await fileExists("/sdcard/missing.txt");
    expect(exists).toBe(false);
  });

  it("returns false when command throws", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const exists = await fileExists("/sdcard/file.txt");
    expect(exists).toBe(false);
  });

  it("sends correct test command", async () => {
    mockAdbShell.mockResolvedValue("EXISTS");
    await fileExists("/sdcard/test.txt");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "[ -e /sdcard/test.txt ] && echo EXISTS",
      expect.any(Object),
    );
  });
});
