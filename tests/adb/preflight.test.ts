import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { runPreflight } from "../../src/adb/preflight.js";

const mockExecFile = vi.mocked(execFile);

/**
 * Helper: queue sequential ADB responses.
 *
 * runPreflight calls several ADB commands in sequence. This helper
 * feeds mock stdout responses in order so each call gets the right data.
 */
function mockSequence(responses: string[]) {
  let callIndex = 0;
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    const stdout = responses[callIndex] ?? "";
    callIndex++;
    if (cb) cb(null, { stdout, stderr: "" });
    return {} as any;
  });
}

function mockAllErrors() {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    const err: any = new Error("command failed");
    err.stderr = "error";
    err.code = 1;
    if (cb) cb(err);
    return {} as any;
  });
}

// Typical healthy device responses, in the order runPreflight issues ADB calls:
// 1. listDevices (adb devices -l)            — checkAdbConnectivity
// 2. listDevices (adb devices -l)            — checkUsbAuthorized
// 3. adbShell dumpsys power                  — checkScreenOn (isScreenOn)
// 4. adbShell pm list packages               — checkAdbKeyboardInstalled
// 5. adbShell settings get secure ...        — checkAdbKeyboardActive
// 6. adbShell df -h                          — checkStorage (getStorageInfo)
// 7. listDevices (adb devices -l)            — resolveSerial

const DEVICES_OUTPUT = [
  "List of devices attached",
  "ABC123           device usb:1-1 product:starqltechn model:SM_G9600 device:starqltechn transport_id:1",
].join("\n");

const SCREEN_ON = "Display Power: state=ON";
const SCREEN_OFF = "Display Power: state=OFF";

const PACKAGES = [
  "package:com.android.settings",
  "package:com.android.adbkeyboard",
  "package:com.example.testapp",
].join("\n");

const PACKAGES_NO_ADBKB = [
  "package:com.android.settings",
  "package:com.example.testapp",
].join("\n");

const IME_ADBKEYBOARD = "com.android.adbkeyboard/.AdbIME";
const IME_SAMSUNG = "com.samsung.android.honeyboard/.service.HoneyBoardService";

const DF_OUTPUT = [
  "Filesystem     Size  Used Avail Use% Mounted on",
  "/dev/block/dm-0  24G  12G   12G  50% /",
  "/dev/block/sda17 108G  40G   68G  37% /data",
].join("\n");

const DF_LOW_STORAGE = [
  "Filesystem     Size  Used Avail Use% Mounted on",
  "/dev/block/dm-0  24G  23G   50M  98% /",
  "/dev/block/sda17 108G 107G   50M  99% /data",
].join("\n");

function healthyResponses(): string[] {
  return [
    DEVICES_OUTPUT, // checkAdbConnectivity
    DEVICES_OUTPUT, // checkUsbAuthorized
    SCREEN_ON,      // checkScreenOn
    PACKAGES,       // checkAdbKeyboardInstalled
    IME_ADBKEYBOARD,// checkAdbKeyboardActive
    DF_OUTPUT,      // checkStorage
    DEVICES_OUTPUT, // resolveSerial
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPreflight()", () => {
  it("returns ready=true when all checks pass", async () => {
    mockSequence(healthyResponses());

    const result = await runPreflight({ serial: "ABC123" });

    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.serial).toBe("ABC123");
    expect(result.timestamp).toBeTruthy();
  });

  it("checks have correct names", async () => {
    mockSequence(healthyResponses());

    const result = await runPreflight();
    const names = result.checks.map((c) => c.name);

    expect(names).toEqual([
      "adb-connectivity",
      "usb-authorized",
      "screen-on",
      "adbkeyboard-installed",
      "adbkeyboard-active",
      "storage-available",
    ]);
  });

  it("fails adb-connectivity when no devices found", async () => {
    const noDevices = "List of devices attached";
    mockSequence([
      noDevices,    // checkAdbConnectivity — no devices
      noDevices,    // checkUsbAuthorized — no device found
      SCREEN_OFF,   // checkScreenOn — will likely fail
      PACKAGES,     // checkAdbKeyboardInstalled
      IME_ADBKEYBOARD,
      DF_OUTPUT,
      noDevices,    // resolveSerial
    ]);

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    const conn = result.checks.find((c) => c.name === "adb-connectivity");
    expect(conn?.passed).toBe(false);
    expect(conn?.fix).toBeTruthy();
  });

  it("fails usb-authorized when device state is unauthorized", async () => {
    const unauthorizedOutput = [
      "List of devices attached",
      "ABC123           unauthorized usb:1-1 transport_id:1",
    ].join("\n");

    mockSequence([
      unauthorizedOutput, // checkAdbConnectivity — no "device" state
      unauthorizedOutput, // checkUsbAuthorized
      SCREEN_ON,
      PACKAGES,
      IME_ADBKEYBOARD,
      DF_OUTPUT,
      unauthorizedOutput, // resolveSerial
    ]);

    const result = await runPreflight({ serial: "ABC123" });

    expect(result.ready).toBe(false);
    const auth = result.checks.find((c) => c.name === "usb-authorized");
    expect(auth?.passed).toBe(false);
    expect(auth?.message).toContain("unauthorized");
  });

  it("fails screen-on when screen is off", async () => {
    mockSequence([
      DEVICES_OUTPUT,
      DEVICES_OUTPUT,
      SCREEN_OFF,        // screen off
      PACKAGES,
      IME_ADBKEYBOARD,
      DF_OUTPUT,
      DEVICES_OUTPUT,
    ]);

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    const screen = result.checks.find((c) => c.name === "screen-on");
    expect(screen?.passed).toBe(false);
    expect(screen?.fix).toContain("KEYCODE_WAKEUP");
  });

  it("fails adbkeyboard-installed when package not found", async () => {
    mockSequence([
      DEVICES_OUTPUT,
      DEVICES_OUTPUT,
      SCREEN_ON,
      PACKAGES_NO_ADBKB,  // missing adbkeyboard
      IME_SAMSUNG,
      DF_OUTPUT,
      DEVICES_OUTPUT,
    ]);

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    const installed = result.checks.find((c) => c.name === "adbkeyboard-installed");
    expect(installed?.passed).toBe(false);
  });

  it("fails adbkeyboard-active when different IME is set", async () => {
    mockSequence([
      DEVICES_OUTPUT,
      DEVICES_OUTPUT,
      SCREEN_ON,
      PACKAGES,
      IME_SAMSUNG,        // wrong IME
      DF_OUTPUT,
      DEVICES_OUTPUT,
    ]);

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    const active = result.checks.find((c) => c.name === "adbkeyboard-active");
    expect(active?.passed).toBe(false);
    expect(active?.message).toContain(IME_SAMSUNG);
    expect(active?.fix).toContain("ime set");
  });

  it("fails storage-available when less than 100MB free", async () => {
    mockSequence([
      DEVICES_OUTPUT,
      DEVICES_OUTPUT,
      SCREEN_ON,
      PACKAGES,
      IME_ADBKEYBOARD,
      DF_LOW_STORAGE,     // low storage
      DEVICES_OUTPUT,
    ]);

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    const storage = result.checks.find((c) => c.name === "storage-available");
    expect(storage?.passed).toBe(false);
    expect(storage?.fix).toContain("Free up");
  });

  it("handles complete ADB failure gracefully", async () => {
    mockAllErrors();

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    // All checks should have failed but not thrown
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every((c) => !c.passed)).toBe(true);
  });

  it("resolves serial from device list when not provided", async () => {
    mockSequence(healthyResponses());

    const result = await runPreflight();
    expect(result.serial).toBe("ABC123");
  });

  it("includes ISO timestamp", async () => {
    mockSequence(healthyResponses());

    const result = await runPreflight();
    // Should be a valid ISO date string
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
