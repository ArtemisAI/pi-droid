import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
  getForegroundPackage: vi.fn(async () => ""),
}));

import { adbShell } from "../../src/adb/exec.js";
import {
  getBatteryInfo,
  getNetworkInfo,
  getDeviceInfo,
  isScreenLocked,
  getRunningApps,
} from "../../src/adb/monitor.js";

const mockAdbShell = vi.mocked(adbShell);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getBatteryInfo ──────────────────────────────────────────────────

describe("getBatteryInfo()", () => {
  const batteryDump = [
    "Current Battery Service state:",
    "  AC powered: false",
    "  USB powered: true",
    "  status: 2",
    "  health: 2",
    "  level: 78",
    "  temperature: 295",
    "  voltage: 4150",
  ].join("\n");

  it("parses battery level and status", async () => {
    mockAdbShell.mockResolvedValue(batteryDump);
    const info = await getBatteryInfo();
    expect(info.level).toBe(78);
    expect(info.status).toBe("charging");
    expect(info.charging).toBe(true);
    expect(info.temperature).toBe(29.5);
  });

  it("detects discharging status (code 3)", async () => {
    mockAdbShell.mockResolvedValue(
      batteryDump.replace("status: 2", "status: 3"),
    );
    const info = await getBatteryInfo();
    expect(info.status).toBe("discharging");
    expect(info.charging).toBe(false);
  });

  it("detects full status (code 5)", async () => {
    mockAdbShell.mockResolvedValue(
      batteryDump.replace("status: 2", "status: 5").replace("level: 78", "level: 100"),
    );
    const info = await getBatteryInfo();
    expect(info.status).toBe("full");
    expect(info.charging).toBe(true);
    expect(info.level).toBe(100);
  });

  it("returns unknown for unrecognized status code", async () => {
    mockAdbShell.mockResolvedValue(
      batteryDump.replace("status: 2", "status: 99"),
    );
    const info = await getBatteryInfo();
    expect(info.status).toBe("unknown");
    expect(info.charging).toBe(false);
  });

  it("returns defaults when fields are missing", async () => {
    mockAdbShell.mockResolvedValue("Current Battery Service state:\n");
    const info = await getBatteryInfo();
    expect(info.level).toBe(0);
    expect(info.temperature).toBe(0);
  });

  it("sends dumpsys battery command", async () => {
    mockAdbShell.mockResolvedValue(batteryDump);
    await getBatteryInfo({ serial: "XYZ" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "dumpsys battery",
      expect.objectContaining({ serial: "XYZ" }),
    );
  });
});

// ── getNetworkInfo ──────────────────────────────────────────────────

describe("getNetworkInfo()", () => {
  it("detects wifi enabled with SSID", async () => {
    let callCount = 0;
    mockAdbShell.mockImplementation(async (cmd: string) => {
      callCount++;
      if (cmd.includes("airplane_mode_on")) return "0";
      if (cmd.includes("Wi-Fi is")) return "Wi-Fi is enabled";
      if (cmd.includes("mWifiInfo")) return 'SSID: "MyNetwork", BSSID: aa:bb';
      if (cmd.includes("mDataConnectionState")) return "mDataConnectionState=2";
      return "";
    });

    const info = await getNetworkInfo();
    expect(info.wifi).toBe(true);
    expect(info.wifiSsid).toBe("MyNetwork");
    expect(info.cellular).toBe(true);
    expect(info.airplaneMode).toBe(false);
  });

  it("detects airplane mode on", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("airplane_mode_on")) return "1";
      if (cmd.includes("Wi-Fi is")) return "Wi-Fi is disabled";
      if (cmd.includes("mDataConnectionState")) return "mDataConnectionState=0";
      return "";
    });

    const info = await getNetworkInfo();
    expect(info.airplaneMode).toBe(true);
    expect(info.wifi).toBe(false);
  });

  it("handles wifi disabled", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("airplane_mode_on")) return "0";
      if (cmd.includes("Wi-Fi is")) return "Wi-Fi is disabled";
      if (cmd.includes("mDataConnectionState")) return "mDataConnectionState=0";
      return "";
    });

    const info = await getNetworkInfo();
    expect(info.wifi).toBe(false);
    expect(info.wifiSsid).toBeUndefined();
    expect(info.cellular).toBe(false);
  });

  it("handles errors gracefully", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const info = await getNetworkInfo();
    expect(info.wifi).toBe(false);
    expect(info.cellular).toBe(false);
    expect(info.airplaneMode).toBe(false);
  });

  it("ignores SSID <none>", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("airplane_mode_on")) return "0";
      if (cmd.includes("Wi-Fi is")) return "Wi-Fi is enabled";
      if (cmd.includes("mWifiInfo")) return "SSID: <none>, BSSID: none";
      if (cmd.includes("mDataConnectionState")) return "mDataConnectionState=0";
      return "";
    });

    const info = await getNetworkInfo();
    expect(info.wifi).toBe(true);
    expect(info.wifiSsid).toBeUndefined();
  });
});

// ── getDeviceInfo ───────────────────────────────────────────────────

describe("getDeviceInfo()", () => {
  it("parses device properties via getprop", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("ro.product.model")) return "SM-G960F\n";
      if (cmd.includes("ro.product.manufacturer")) return "samsung\n";
      if (cmd.includes("ro.build.version.release")) return "10\n";
      if (cmd.includes("ro.build.version.sdk")) return "29\n";
      if (cmd.includes("ro.serialno")) return "45465050374a3098\n";
      return "unknown";
    });

    const info = await getDeviceInfo();
    expect(info.model).toBe("SM-G960F");
    expect(info.manufacturer).toBe("samsung");
    expect(info.androidVersion).toBe("10");
    expect(info.sdkVersion).toBe(29);
    expect(info.serial).toBe("45465050374a3098");
  });

  it("returns 'unknown' for failed getprop calls", async () => {
    mockAdbShell.mockRejectedValue(new Error("getprop failed"));
    const info = await getDeviceInfo();
    expect(info.model).toBe("unknown");
    expect(info.manufacturer).toBe("unknown");
    expect(info.sdkVersion).toBe(0);
  });

  it("handles non-numeric SDK version", async () => {
    mockAdbShell.mockImplementation(async (cmd: string) => {
      if (cmd.includes("ro.build.version.sdk")) return "not-a-number\n";
      return "value\n";
    });

    const info = await getDeviceInfo();
    expect(info.sdkVersion).toBe(0);
  });

  it("passes serial option through", async () => {
    mockAdbShell.mockResolvedValue("value\n");
    await getDeviceInfo({ serial: "ABC" });
    // All 5 getprop calls should include the serial
    for (const call of mockAdbShell.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ serial: "ABC" }));
    }
  });
});

// ── isScreenLocked ──────────────────────────────────────────────────

describe("isScreenLocked()", () => {
  it("returns true when lockscreen is showing", async () => {
    mockAdbShell.mockResolvedValue("mDreamingLockscreen=true mShowingDream=false");
    const locked = await isScreenLocked();
    expect(locked).toBe(true);
  });

  it("returns true when keyguard is showing", async () => {
    mockAdbShell.mockResolvedValue("isStatusBarKeyguard=true");
    const locked = await isScreenLocked();
    expect(locked).toBe(true);
  });

  it("returns false when unlocked", async () => {
    mockAdbShell.mockResolvedValue("mDreamingLockscreen=false showing=false");
    const locked = await isScreenLocked();
    expect(locked).toBe(false);
  });
});

// ── getRunningApps ──────────────────────────────────────────────────

describe("getRunningApps()", () => {
  it("returns list of running app packages", async () => {
    mockAdbShell.mockResolvedValue(
      "com.example.app\ncom.android.chrome\ncom.whatsapp\n",
    );
    const apps = await getRunningApps();
    expect(apps).toEqual(["com.example.app", "com.android.chrome", "com.whatsapp"]);
  });

  it("returns empty array when no apps running", async () => {
    mockAdbShell.mockResolvedValue("");
    const apps = await getRunningApps();
    expect(apps).toEqual([]);
  });

  it("falls back to alternative ps command on failure", async () => {
    let callCount = 0;
    mockAdbShell.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("ps -A not supported");
      return "com.fallback.app\n";
    });

    const apps = await getRunningApps();
    expect(apps).toEqual(["com.fallback.app"]);
  });

  it("returns empty array when both ps commands fail", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const apps = await getRunningApps();
    expect(apps).toEqual([]);
  });
});
