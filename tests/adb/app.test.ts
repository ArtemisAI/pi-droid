import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
  getForegroundPackage: vi.fn(async () => ""),
}));

import { adbShell, getForegroundPackage } from "../../src/adb/exec.js";
import {
  launchApp,
  stopApp,
  getAppInfo,
  listPackages,
  keepScreenOn,
  restoreScreenTimeout,
  wakeScreen,
  isScreenOn,
} from "../../src/adb/app.js";

const mockAdbShell = vi.mocked(adbShell);
const mockGetForegroundPackage = vi.mocked(getForegroundPackage);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── launchApp ───────────────────────────────────────────────────────

describe("launchApp()", () => {
  it("launches via monkey when no activity specified", async () => {
    await launchApp("com.example.app");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "monkey -p com.example.app -c android.intent.category.LAUNCHER 1",
      expect.any(Object),
    );
  });

  it("launches specific activity with am start -n", async () => {
    await launchApp("com.example.app", { activity: ".MainActivity" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -n com.example.app/.MainActivity",
      expect.any(Object),
    );
  });

  it("passes serial option through", async () => {
    await launchApp("com.example.app", { serial: "ABC123" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "ABC123" }),
    );
  });
});

// ── stopApp ─────────────────────────────────────────────────────────

describe("stopApp()", () => {
  it("sends am force-stop command", async () => {
    await stopApp("com.example.app");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am force-stop com.example.app",
      expect.any(Object),
    );
  });

  it("passes serial option through", async () => {
    await stopApp("com.example.app", { serial: "DEV1" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am force-stop com.example.app",
      expect.objectContaining({ serial: "DEV1" }),
    );
  });
});

// ── getAppInfo ──────────────────────────────────────────────────────

describe("getAppInfo()", () => {
  it("returns running=true and foreground=true when app is in foreground", async () => {
    mockAdbShell.mockResolvedValue("12345");
    mockGetForegroundPackage.mockResolvedValue("com.example.app");

    const info = await getAppInfo("com.example.app");
    expect(info.packageName).toBe("com.example.app");
    expect(info.running).toBe(true);
    expect(info.foreground).toBe(true);
  });

  it("returns running=true but foreground=false when app is in background", async () => {
    mockAdbShell.mockResolvedValue("12345");
    mockGetForegroundPackage.mockResolvedValue("com.other.app");

    const info = await getAppInfo("com.example.app");
    expect(info.running).toBe(true);
    expect(info.foreground).toBe(false);
  });

  it("returns running=false when pidof returns empty", async () => {
    mockAdbShell.mockResolvedValue("");
    mockGetForegroundPackage.mockResolvedValue("com.other.app");

    const info = await getAppInfo("com.example.app");
    expect(info.running).toBe(false);
    expect(info.foreground).toBe(false);
  });

  it("returns running=false when pidof throws", async () => {
    mockAdbShell.mockRejectedValue(new Error("pidof failed"));
    mockGetForegroundPackage.mockResolvedValue("com.other.app");

    const info = await getAppInfo("com.example.app");
    expect(info.running).toBe(false);
    expect(info.foreground).toBe(false);
  });
});

// ── listPackages ────────────────────────────────────────────────────

describe("listPackages()", () => {
  it("parses package list output", async () => {
    mockAdbShell.mockResolvedValue(
      "package:com.example.app\npackage:com.other.app\n",
    );

    const packages = await listPackages();
    expect(packages).toEqual(["com.example.app", "com.other.app"]);
  });

  it("filters packages with grep", async () => {
    mockAdbShell.mockResolvedValue("package:com.example.app\n");
    await listPackages("example");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "pm list packages | grep -i example",
      expect.any(Object),
    );
  });

  it("returns empty array when command fails", async () => {
    mockAdbShell.mockRejectedValueOnce(new Error("grep found nothing"));
    const packages = await listPackages("nonexistent");
    expect(packages).toEqual([]);
  });
});

// ── keepScreenOn / restoreScreenTimeout ─────────────────────────────

describe("keepScreenOn()", () => {
  it("sends svc power stayon true", async () => {
    await keepScreenOn();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "svc power stayon true",
      expect.any(Object),
    );
  });
});

describe("restoreScreenTimeout()", () => {
  it("sends svc power stayon false", async () => {
    await restoreScreenTimeout();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "svc power stayon false",
      expect.any(Object),
    );
  });
});

// ── wakeScreen ──────────────────────────────────────────────────────

describe("wakeScreen()", () => {
  it("sends KEYCODE_WAKEUP keyevent", async () => {
    await wakeScreen();
    expect(mockAdbShell).toHaveBeenCalledWith(
      "input keyevent KEYCODE_WAKEUP",
      expect.any(Object),
    );
  });
});

// ── isScreenOn ──────────────────────────────────────────────────────

describe("isScreenOn()", () => {
  it("returns true when display state is ON", async () => {
    mockAdbShell.mockResolvedValue("Display Power: state=ON");
    const result = await isScreenOn();
    expect(result).toBe(true);
  });

  it("returns false when display state is OFF", async () => {
    mockAdbShell.mockResolvedValue("Display Power: state=OFF");
    const result = await isScreenOn();
    expect(result).toBe(false);
  });
});
