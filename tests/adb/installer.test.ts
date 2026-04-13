import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
}));

import { adb, adbShell } from "../../src/adb/exec.js";
import {
  installApk,
  uninstallPackage,
  getPackageVersion,
  isPackageInstalled,
  getApkPath,
} from "../../src/adb/installer.js";

const mockAdb = vi.mocked(adb);
const mockAdbShell = vi.mocked(adbShell);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("installApk()", () => {
  it("installs with -r flag by default", async () => {
    mockAdb.mockResolvedValue("Success");
    const result = await installApk("/tmp/app.apk");
    expect(mockAdb).toHaveBeenCalledWith(["install", "-r", "/tmp/app.apk"], {});
    expect(result.success).toBe(true);
    expect(result.message).toBe("Success");
  });

  it("skips -r when replace is false", async () => {
    mockAdb.mockResolvedValue("Success");
    await installApk("/tmp/app.apk", { replace: false });
    expect(mockAdb).toHaveBeenCalledWith(["install", "/tmp/app.apk"], {});
  });

  it("adds -d flag when downgrade is true", async () => {
    mockAdb.mockResolvedValue("Success");
    await installApk("/tmp/app.apk", { downgrade: true });
    expect(mockAdb).toHaveBeenCalledWith(
      ["install", "-r", "-d", "/tmp/app.apk"],
      {},
    );
  });

  it("passes serial through to adb", async () => {
    mockAdb.mockResolvedValue("Success");
    await installApk("/tmp/app.apk", { serial: "ABC123" });
    expect(mockAdb).toHaveBeenCalledWith(
      ["install", "-r", "/tmp/app.apk"],
      { serial: "ABC123" },
    );
  });

  it("returns failure on error", async () => {
    mockAdb.mockRejectedValue(new Error("INSTALL_FAILED_ALREADY_EXISTS"));
    const result = await installApk("/tmp/app.apk", { replace: false });
    expect(result.success).toBe(false);
    expect(result.message).toContain("INSTALL_FAILED_ALREADY_EXISTS");
  });

  it("returns success false when output lacks Success", async () => {
    mockAdb.mockResolvedValue("Failure [INSTALL_FAILED_OLDER_SDK]");
    const result = await installApk("/tmp/app.apk");
    expect(result.success).toBe(false);
  });
});

describe("uninstallPackage()", () => {
  it("uninstalls a package", async () => {
    mockAdb.mockResolvedValue("Success");
    const result = await uninstallPackage("com.example.app");
    expect(mockAdb).toHaveBeenCalledWith(["uninstall", "com.example.app"], {});
    expect(result.success).toBe(true);
  });

  it("adds -k flag when keepData is true", async () => {
    mockAdb.mockResolvedValue("Success");
    await uninstallPackage("com.example.app", { keepData: true });
    expect(mockAdb).toHaveBeenCalledWith(
      ["uninstall", "-k", "com.example.app"],
      {},
    );
  });

  it("returns failure on error", async () => {
    mockAdb.mockRejectedValue(new Error("Unknown package"));
    const result = await uninstallPackage("com.example.app");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown package");
  });
});

describe("getPackageVersion()", () => {
  it("parses version from dumpsys output", async () => {
    mockAdbShell.mockResolvedValue(
      "  versionCode=42 minSdk=21 targetSdk=33\n  versionName=1.2.3\n",
    );
    const version = await getPackageVersion("com.example.app");
    expect(version).toEqual({ versionName: "1.2.3", versionCode: 42 });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "dumpsys package com.example.app",
      {},
    );
  });

  it("returns null when package is not installed", async () => {
    mockAdbShell.mockResolvedValue("Unable to find package: com.nope");
    const version = await getPackageVersion("com.nope");
    expect(version).toBeNull();
  });

  it("returns null on error", async () => {
    mockAdbShell.mockRejectedValue(new Error("fail"));
    const version = await getPackageVersion("com.example.app");
    expect(version).toBeNull();
  });
});

describe("isPackageInstalled()", () => {
  it("returns true when package is listed", async () => {
    mockAdbShell.mockResolvedValue(
      "package:com.example.app\npackage:com.example.app.debug\n",
    );
    const result = await isPackageInstalled("com.example.app");
    expect(result).toBe(true);
  });

  it("returns false for partial matches only", async () => {
    mockAdbShell.mockResolvedValue("package:com.example.app.debug\n");
    const result = await isPackageInstalled("com.example.app");
    expect(result).toBe(false);
  });

  it("returns false on error", async () => {
    mockAdbShell.mockRejectedValue(new Error("fail"));
    const result = await isPackageInstalled("com.example.app");
    expect(result).toBe(false);
  });
});

describe("getApkPath()", () => {
  it("returns the APK path", async () => {
    mockAdbShell.mockResolvedValue("package:/data/app/com.example.app-1/base.apk\n");
    const path = await getApkPath("com.example.app");
    expect(path).toBe("/data/app/com.example.app-1/base.apk");
    expect(mockAdbShell).toHaveBeenCalledWith("pm path com.example.app", {});
  });

  it("returns null when package not found", async () => {
    mockAdbShell.mockRejectedValue(new Error("not found"));
    const path = await getApkPath("com.nope");
    expect(path).toBeNull();
  });

  it("returns null when output has no package: prefix", async () => {
    mockAdbShell.mockResolvedValue("");
    const path = await getApkPath("com.nope");
    expect(path).toBeNull();
  });
});
