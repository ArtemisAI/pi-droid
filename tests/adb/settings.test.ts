import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
  setWifiEnabled,
  isWifiEnabled,
  setBluetoothEnabled,
  isBluetoothEnabled,
  setAirplaneMode,
  setBrightness,
  getBrightness,
  setAutoBrightness,
  setVolume,
  getVolume,
  setScreenTimeout,
  getScreenTimeout,
  setLocationEnabled,
  isLocationEnabled,
  setAutoRotate,
  isAutoRotateEnabled,
  getSetting,
  putSetting,
  setDoNotDisturb,
  isDoNotDisturbEnabled,
} from "../../src/adb/settings.js";

const mockExecFile = vi.mocked(execFile);

let callResponses: string[];
let callIndex: number;

function mockSequential(...responses: string[]) {
  callResponses = responses;
  callIndex = 0;
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    const stdout = callResponses[callIndex] ?? "";
    callIndex++;
    if (cb) cb(null, { stdout, stderr: "" });
    return {} as any;
  });
}

function mockStdout(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    if (cb) cb(null, { stdout, stderr: "" });
    return {} as any;
  });
}

function mockError(stderr = "error") {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    const err: any = new Error("command failed");
    err.stderr = stderr;
    err.code = 1;
    if (cb) cb(err);
    return {} as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── WiFi ──────────────────────────────────────────────────────────────

describe("setWifiEnabled()", () => {
  it("enables wifi via svc", async () => {
    mockStdout("");
    await setWifiEnabled(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      expect.arrayContaining(["shell", "svc wifi enable"]),
      expect.anything(),
      expect.any(Function),
    );
  });

  it("disables wifi via svc", async () => {
    mockStdout("");
    await setWifiEnabled(false);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      expect.arrayContaining(["shell", "svc wifi disable"]),
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("isWifiEnabled()", () => {
  it("returns true when wifi_on is 1", async () => {
    mockStdout("1\n");
    expect(await isWifiEnabled()).toBe(true);
  });

  it("returns false when wifi_on is 0", async () => {
    mockStdout("0\n");
    expect(await isWifiEnabled()).toBe(false);
  });
});

// ── Bluetooth ─────────────────────────────────────────────────────────

describe("setBluetoothEnabled()", () => {
  it("enables bluetooth via cmd bluetooth_manager", async () => {
    mockStdout("");
    await setBluetoothEnabled(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      expect.arrayContaining(["shell", "cmd bluetooth_manager enable"]),
      expect.anything(),
      expect.any(Function),
    );
  });

  it("falls back to svc bluetooth when cmd fails", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      callCount++;
      if (callCount === 1) {
        const err: any = new Error("cmd not found");
        err.stderr = "error";
        err.code = 1;
        if (cb) cb(err);
      } else {
        if (cb) cb(null, { stdout: "", stderr: "" });
      }
      return {} as any;
    });

    await setBluetoothEnabled(true);
    expect(callCount).toBe(2);
  });
});

describe("isBluetoothEnabled()", () => {
  it("returns true when bluetooth_on is 1", async () => {
    mockStdout("1\n");
    expect(await isBluetoothEnabled()).toBe(true);
  });

  it("returns false when bluetooth_on is 0", async () => {
    mockStdout("0\n");
    expect(await isBluetoothEnabled()).toBe(false);
  });
});

// ── Airplane Mode ─────────────────────────────────────────────────────

describe("setAirplaneMode()", () => {
  it("enables airplane mode and broadcasts intent", async () => {
    mockStdout("");
    await setAirplaneMode(true);
    // Two calls: settings put + am broadcast
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("disables airplane mode", async () => {
    mockStdout("");
    await setAirplaneMode(false);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});

// ── Brightness ────────────────────────────────────────────────────────

describe("setBrightness()", () => {
  it("sets brightness and disables auto-brightness", async () => {
    mockStdout("");
    await setBrightness(128);
    // Two calls: disable auto-brightness + set brightness
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("clamps brightness to 0-255 range", async () => {
    mockStdout("");
    await setBrightness(300);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system screen_brightness 255"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("clamps negative brightness to 0", async () => {
    mockStdout("");
    await setBrightness(-10);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system screen_brightness 0"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("getBrightness()", () => {
  it("parses brightness level and auto mode", async () => {
    mockSequential("128\n", "1\n");
    const result = await getBrightness();
    expect(result.level).toBe(128);
    expect(result.auto).toBe(true);
  });

  it("returns auto false when mode is 0", async () => {
    mockSequential("200\n", "0\n");
    const result = await getBrightness();
    expect(result.level).toBe(200);
    expect(result.auto).toBe(false);
  });

  it("returns 0 for unparseable brightness", async () => {
    mockSequential("null\n", "0\n");
    const result = await getBrightness();
    expect(result.level).toBe(0);
  });
});

// ── Volume ────────────────────────────────────────────────────────────

describe("setVolume()", () => {
  it("sets music volume with stream id 3", async () => {
    mockStdout("");
    await setVolume("music", 10);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "media volume --stream 3 --set 10"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("sets ring volume with stream id 2", async () => {
    mockStdout("");
    await setVolume("ring", 5);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "media volume --stream 2 --set 5"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("clamps volume to 0-25 range", async () => {
    mockStdout("");
    await setVolume("music", 30);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "media volume --stream 3 --set 25"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("getVolume()", () => {
  it("parses volume from media output", async () => {
    mockStdout("volume is 7 in range [0..15]\n");
    const vol = await getVolume("music");
    expect(vol).toBe(7);
  });

  it("returns 0 when output cannot be parsed", async () => {
    mockStdout("unknown output\n");
    const vol = await getVolume("alarm");
    expect(vol).toBe(0);
  });
});

// ── Screen Timeout ────────────────────────────────────────────────────

describe("setScreenTimeout()", () => {
  it("sets screen timeout in ms", async () => {
    mockStdout("");
    await setScreenTimeout(60000);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system screen_off_timeout 60000"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("getScreenTimeout()", () => {
  it("parses screen timeout value", async () => {
    mockStdout("60000\n");
    expect(await getScreenTimeout()).toBe(60000);
  });

  it("returns default 30000 for unparseable output", async () => {
    mockStdout("null\n");
    expect(await getScreenTimeout()).toBe(30000);
  });
});

// ── Location ──────────────────────────────────────────────────────────

describe("setLocationEnabled()", () => {
  it("enables location with high accuracy mode (3)", async () => {
    mockStdout("");
    await setLocationEnabled(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put secure location_mode 3"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("disables location with mode 0", async () => {
    mockStdout("");
    await setLocationEnabled(false);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put secure location_mode 0"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("isLocationEnabled()", () => {
  it("returns true when location_mode > 0", async () => {
    mockStdout("3\n");
    expect(await isLocationEnabled()).toBe(true);
  });

  it("returns false when location_mode is 0", async () => {
    mockStdout("0\n");
    expect(await isLocationEnabled()).toBe(false);
  });
});

// ── Auto-Rotate ───────────────────────────────────────────────────────

describe("setAutoRotate()", () => {
  it("enables auto-rotate", async () => {
    mockStdout("");
    await setAutoRotate(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system accelerometer_rotation 1"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("disables auto-rotate", async () => {
    mockStdout("");
    await setAutoRotate(false);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system accelerometer_rotation 0"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("isAutoRotateEnabled()", () => {
  it("returns true when accelerometer_rotation is 1", async () => {
    mockStdout("1\n");
    expect(await isAutoRotateEnabled()).toBe(true);
  });

  it("returns false when accelerometer_rotation is 0", async () => {
    mockStdout("0\n");
    expect(await isAutoRotateEnabled()).toBe(false);
  });
});

// ── Generic getSetting / putSetting ───────────────────────────────────

describe("getSetting()", () => {
  it("reads a setting from the given namespace", async () => {
    mockStdout("some_value\n");
    const val = await getSetting("global", "airplane_mode_on");
    expect(val).toBe("some_value");
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings get global 'airplane_mode_on'"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("putSetting()", () => {
  it("writes a setting to the given namespace", async () => {
    mockStdout("");
    await putSetting("system", "screen_brightness", 200);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["shell", "settings put system 'screen_brightness' '200'"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ── Error Handling ────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws AdbError when command fails", async () => {
    mockError("device not found");
    await expect(isWifiEnabled()).rejects.toThrow();
  });

  it("throws on setBrightness failure", async () => {
    mockError("device offline");
    await expect(setBrightness(100)).rejects.toThrow();
  });
});
