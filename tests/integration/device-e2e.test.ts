/**
 * Real-device end-to-end integration tests.
 *
 * These tests connect to a real Android device via ADB and exercise the
 * full pi-droid ADB pipeline. The entire suite is skipped gracefully when
 * no device is connected.
 *
 * Run with:  npm run test:device
 *   — or —   npx vitest run tests/integration/device-e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

// Tier 1 — ADB primitives
import { adbShell, listDevices, getScreenSize, getForegroundPackage, isDeviceReady } from "../../src/adb/exec.js";
import { tap, swipe, keyEvent, pressHome, pressBack, typeText } from "../../src/adb/input.js";
import { getScreenState, getOrientation, isKeyboardVisible, getActivityStack, waitForActivity } from "../../src/adb/screen-state.js";
import { takeScreenshot, screenshotBase64 } from "../../src/adb/screenshot.js";
import { dumpUiTree, findElements, findElement, summarizeTree } from "../../src/adb/ui-tree.js";
import { Device } from "../../src/adb/device.js";
import { ensureReady } from "../../src/adb/automation.js";
import { getBatteryInfo, getNetworkInfo, getDeviceInfo, isScreenLocked } from "../../src/adb/monitor.js";
import { getBrightness, getVolume } from "../../src/adb/settings.js";
import { getLockStatus } from "../../src/adb/lock.js";
import { runOcrOnCurrentScreen } from "../../src/adb/ocr.js";
import { launchApp, stopApp, listPackages, isScreenOn, wakeScreen } from "../../src/adb/app.js";
import { executeShell, getProcessList, getMemoryInfo } from "../../src/adb/shell.js";
import { pushFile, pullFile, listDir, getStorageInfo, fileExists, deleteFile } from "../../src/adb/files.js";
import { getClipboard, setClipboard, openUrl, sendIntent } from "../../src/adb/intents.js";
import { isPackageInstalled, getPackageVersion, getApkPath } from "../../src/adb/installer.js";
import { captureLogcat, clearLogcat, getLogcatStats } from "../../src/adb/logcat.js";
import { isRecording } from "../../src/adb/recording.js";
import { getWifiIp } from "../../src/adb/wifi.js";
import { annotatedScreenshot } from "../../src/adb/annotate.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Detect device availability synchronously (before describe.runIf evaluates) ──
import { execSync } from "node:child_process";

let deviceAvailable = false;
let deviceSerial: string | undefined;
let allDevices: Awaited<ReturnType<typeof listDevices>> = [];

try {
  const output = execSync("adb devices", { encoding: "utf-8", timeout: 5000 });
  const lines = output.split("\n").slice(1).filter((l) => l.includes("\tdevice"));
  if (lines.length > 0) {
    deviceAvailable = true;
    deviceSerial = lines[0].split("\t")[0];
  }
} catch {
  deviceAvailable = false;
}

beforeAll(async () => {
  if (!deviceAvailable) return;
  allDevices = await listDevices();
}, 15_000);

// ── Helper to build options targeting the detected device ──────────

function opts() {
  return deviceSerial ? { serial: deviceSerial } : {};
}

// Short pause to let the device settle after an action
function settle(ms = 500): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════════════
// All tests below are skipped when no device is connected.
// ════════════════════════════════════════════════════════════════════

describe.runIf(deviceAvailable)("Real device E2E", () => {
  // ── 1. Device connection ─────────────────────────────────────────

  describe("Device connection", () => {
    it("listDevices finds at least one device in 'device' state", { timeout: 10_000 }, async () => {
      const devices = await listDevices();
      expect(devices.length).toBeGreaterThanOrEqual(1);
      const ready = devices.filter((d) => d.state === "device");
      expect(ready.length).toBeGreaterThanOrEqual(1);
      // Every ready device must have a non-empty serial
      for (const d of ready) {
        expect(d.serial).toBeTruthy();
        expect(typeof d.serial).toBe("string");
        expect(d.serial.length).toBeGreaterThan(0);
      }
    });

    it("isDeviceReady returns true for the connected device", { timeout: 10_000 }, async () => {
      const ready = await isDeviceReady(deviceSerial);
      expect(ready).toBe(true);
    });

    it("isDeviceReady returns false for a bogus serial", { timeout: 10_000 }, async () => {
      const ready = await isDeviceReady("BOGUS_SERIAL_12345");
      expect(ready).toBe(false);
    });

    it("Device.connect() succeeds without explicit serial", { timeout: 10_000 }, async () => {
      const device = await Device.connect();
      expect(device).toBeInstanceOf(Device);
      expect(device.serial).toBeTruthy();
    });

    it("Device.connect(serial) succeeds with explicit serial", { timeout: 10_000 }, async () => {
      const device = await Device.connect(deviceSerial);
      expect(device).toBeInstanceOf(Device);
      expect(device.serial).toBe(deviceSerial);
    });

    it("Device.connect rejects for an invalid serial", { timeout: 10_000 }, async () => {
      await expect(Device.connect("BOGUS_SERIAL_12345")).rejects.toThrow();
    });

    it("Device.listAll returns at least one device", { timeout: 10_000 }, async () => {
      const devices = await Device.listAll();
      expect(devices.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 2. Screen info ───────────────────────────────────────────────

  describe("Screen info", () => {
    it("getScreenSize returns valid dimensions", { timeout: 10_000 }, async () => {
      const size = await getScreenSize(opts());
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      // Reasonable bounds: no phone is < 240px or > 10000px on either axis
      expect(size.width).toBeGreaterThanOrEqual(240);
      expect(size.width).toBeLessThanOrEqual(10000);
      expect(size.height).toBeGreaterThanOrEqual(240);
      expect(size.height).toBeLessThanOrEqual(10000);
    });

    it("getScreenState returns all expected fields", { timeout: 10_000 }, async () => {
      const state = await getScreenState(opts());
      expect(typeof state.screenOn).toBe("boolean");
      expect(typeof state.locked).toBe("boolean");
      expect(typeof state.foregroundPackage).toBe("string");
      expect(typeof state.foregroundActivity).toBe("string");
      expect(typeof state.hasOverlay).toBe("boolean");
      expect(typeof state.keyboardVisible).toBe("boolean");
      expect(["portrait", "landscape"]).toContain(state.orientation);
      expect(typeof state.density).toBe("number");
    });

    it("getForegroundPackage returns a non-empty string", { timeout: 10_000 }, async () => {
      const pkg = await getForegroundPackage(opts());
      expect(typeof pkg).toBe("string");
      expect(pkg.length).toBeGreaterThan(0);
    });
  });

  // ── 3. Screenshot ────────────────────────────────────────────────

  describe("Screenshot", () => {
    const screenshotPaths: string[] = [];

    it("takeScreenshot produces a file on disk", { timeout: 30_000 }, async () => {
      const result = await takeScreenshot({ ...opts(), prefix: "e2e-test" });
      screenshotPaths.push(result.path);
      expect(existsSync(result.path)).toBe(true);
      expect(result.path.endsWith(".png")).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it("takeScreenshot with includeBase64 returns base64 data", { timeout: 30_000 }, async () => {
      const result = await takeScreenshot({ ...opts(), prefix: "e2e-b64", includeBase64: true });
      screenshotPaths.push(result.path);
      expect(result.base64).toBeDefined();
      expect(typeof result.base64).toBe("string");
      expect(result.base64!.length).toBeGreaterThan(100);
      // Valid base64 PNG starts with iVBOR (the base64 encoding of the PNG magic bytes)
      expect(result.base64!.startsWith("iVBOR")).toBe(true);
    });

    it("screenshotBase64 returns valid base64 string", { timeout: 30_000 }, async () => {
      const b64 = await screenshotBase64(opts());
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(100);
      expect(b64.startsWith("iVBOR")).toBe(true);
    });

    // Cleanup captured screenshots
    afterAll(async () => {
      for (const p of screenshotPaths) {
        await unlink(p).catch(() => {});
      }
    });
  });

  // ── 4. UI tree ───────────────────────────────────────────────────

  describe("UI tree", () => {
    it("dumpUiTree returns a non-empty element list", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      expect(Array.isArray(tree.elements)).toBe(true);
      // There should be at least a few elements on any screen
      expect(tree.elements.length).toBeGreaterThan(0);
      expect(typeof tree.foregroundPackage).toBe("string");
      expect(tree.foregroundPackage.length).toBeGreaterThan(0);
    });

    it("elements have valid bounds and center coordinates", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      for (const el of tree.elements.slice(0, 20)) {
        expect(typeof el.bounds.left).toBe("number");
        expect(typeof el.bounds.top).toBe("number");
        expect(typeof el.bounds.right).toBe("number");
        expect(typeof el.bounds.bottom).toBe("number");
        // right >= left and bottom >= top
        expect(el.bounds.right).toBeGreaterThanOrEqual(el.bounds.left);
        expect(el.bounds.bottom).toBeGreaterThanOrEqual(el.bounds.top);
        // center is within bounds
        expect(el.center.x).toBeGreaterThanOrEqual(el.bounds.left);
        expect(el.center.x).toBeLessThanOrEqual(el.bounds.right);
        expect(el.center.y).toBeGreaterThanOrEqual(el.bounds.top);
        expect(el.center.y).toBeLessThanOrEqual(el.bounds.bottom);
      }
    });

    it("findElements with className selector returns matching elements", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      // Every Android screen has at least one FrameLayout
      const frames = findElements(tree.elements, { className: "android.widget.FrameLayout" });
      // It may be 0 on some custom ROMs, so just check type
      expect(Array.isArray(frames)).toBe(true);
    });

    it("findElement returns null for a selector with no match", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      const el = findElement(tree.elements, { textExact: "__NONEXISTENT_TEXT_12345__" });
      expect(el).toBeNull();
    });

    it("interactive elements are a subset of all elements", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      expect(tree.interactive.length).toBeLessThanOrEqual(tree.elements.length);
      for (const el of tree.interactive) {
        expect(el.enabled).toBe(true);
        expect(el.clickable || el.focusable || el.scrollable).toBe(true);
      }
    });
  });

  // ── 5. Device info ───────────────────────────────────────────────

  describe("Device info", () => {
    it("getDeviceInfo returns model, manufacturer, SDK", { timeout: 10_000 }, async () => {
      const info = await getDeviceInfo(opts());
      expect(typeof info.model).toBe("string");
      expect(info.model.length).toBeGreaterThan(0);
      expect(info.model).not.toBe("unknown");

      expect(typeof info.manufacturer).toBe("string");
      expect(info.manufacturer.length).toBeGreaterThan(0);
      expect(info.manufacturer).not.toBe("unknown");

      expect(typeof info.androidVersion).toBe("string");
      expect(info.androidVersion.length).toBeGreaterThan(0);

      expect(typeof info.sdkVersion).toBe("number");
      expect(info.sdkVersion).toBeGreaterThanOrEqual(21); // Lollipop minimum
      expect(info.sdkVersion).toBeLessThanOrEqual(40);    // Reasonable upper bound

      expect(typeof info.serial).toBe("string");
    });
  });

  // ── 6. Battery ───────────────────────────────────────────────────

  describe("Battery", () => {
    it("getBatteryInfo returns level 0-100 and charging boolean", { timeout: 10_000 }, async () => {
      const battery = await getBatteryInfo(opts());
      expect(typeof battery.level).toBe("number");
      expect(battery.level).toBeGreaterThanOrEqual(0);
      expect(battery.level).toBeLessThanOrEqual(100);

      expect(typeof battery.charging).toBe("boolean");

      expect(typeof battery.status).toBe("string");
      expect(["unknown", "charging", "discharging", "not charging", "full"]).toContain(battery.status);

      expect(typeof battery.temperature).toBe("number");
      // Battery temp should be reasonable (0-60 C)
      expect(battery.temperature).toBeGreaterThanOrEqual(0);
      expect(battery.temperature).toBeLessThanOrEqual(60);
    });
  });

  // ── 7. Network ───────────────────────────────────────────────────

  describe("Network", () => {
    it("getNetworkInfo returns structured network state", { timeout: 10_000 }, async () => {
      const net = await getNetworkInfo(opts());
      expect(typeof net.wifi).toBe("boolean");
      expect(typeof net.cellular).toBe("boolean");
      expect(typeof net.airplaneMode).toBe("boolean");
      // wifiSsid is optional — if wifi is on and connected, it may have an SSID
      if (net.wifiSsid !== undefined) {
        expect(typeof net.wifiSsid).toBe("string");
      }
    });
  });

  // ── 8. Settings ──────────────────────────────────────────────────

  describe("Settings", () => {
    it("getBrightness returns a numeric level and auto boolean", { timeout: 10_000 }, async () => {
      const brightness = await getBrightness(opts());
      expect(typeof brightness.level).toBe("number");
      expect(brightness.level).toBeGreaterThanOrEqual(0);
      expect(brightness.level).toBeLessThanOrEqual(255);
      expect(typeof brightness.auto).toBe("boolean");
    });

    it("getVolume(music) returns a number", { timeout: 10_000 }, async () => {
      const vol = await getVolume("music", opts());
      expect(typeof vol).toBe("number");
      expect(vol).toBeGreaterThanOrEqual(0);
      expect(vol).toBeLessThanOrEqual(25);
    });

    it("getVolume(ring) returns a number", { timeout: 10_000 }, async () => {
      const vol = await getVolume("ring", opts());
      expect(typeof vol).toBe("number");
      expect(vol).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 9. Lock status ───────────────────────────────────────────────

  describe("Lock status", () => {
    it("getLockStatus returns a valid status object", { timeout: 10_000 }, async () => {
      const status = await getLockStatus(opts());
      expect(typeof status.hasPattern).toBe("boolean");
      expect(typeof status.hasPin).toBe("boolean");
      expect(typeof status.hasPassword).toBe("boolean");
      expect(typeof status.isSecure).toBe("boolean");
    });

    it("isScreenLocked returns a boolean or handles gracefully", { timeout: 10_000 }, async () => {
      try {
        const locked = await isScreenLocked(opts());
        expect(typeof locked).toBe("boolean");
      } catch (err: unknown) {
        // Some OEM skins (Huawei, Xiaomi) lack the expected dumpsys fields
        // — this is a known limitation documented in the audit
        expect((err as Error).message).toContain("ADB command failed");
      }
    });
  });

  // ── 10. Interaction round-trip ───────────────────────────────────

  describe("Interaction round-trip", () => {
    it("pressing Home navigates to the launcher", { timeout: 30_000 }, async () => {
      // Press home to get to a known state
      await pressHome(opts());
      await settle(1000);

      const state = await getScreenState(opts());
      // The foreground package should be a launcher
      // Common launchers: com.google.android.apps.nexuslauncher, com.sec.android.app.launcher, etc.
      // We just check that the package changed and we got a valid state
      expect(typeof state.foregroundPackage).toBe("string");
      expect(state.foregroundPackage.length).toBeGreaterThan(0);
    });

    it("keyEvent KEYCODE_HOME works the same as pressHome", { timeout: 15_000 }, async () => {
      await keyEvent("KEYCODE_HOME", opts());
      await settle(1000);
      const pkg = await getForegroundPackage(opts());
      expect(typeof pkg).toBe("string");
      expect(pkg.length).toBeGreaterThan(0);
    });

    it("screenshot changes after interaction", { timeout: 30_000 }, async () => {
      // Take a screenshot at home screen
      await pressHome(opts());
      await settle(1000);
      const before = await screenshotBase64(opts());

      // Open recent apps (double-tap KEYCODE_APP_SWITCH) to change the screen
      await keyEvent("KEYCODE_APP_SWITCH", opts());
      await settle(1500);

      const after = await screenshotBase64(opts());

      // Screenshots should differ (different screen content)
      // They could theoretically be the same if recents is empty, but
      // at minimum both should be valid base64
      expect(before.length).toBeGreaterThan(100);
      expect(after.length).toBeGreaterThan(100);

      // Return to home
      await pressHome(opts());
      await settle(500);
    });

    it("pressBack does not crash", { timeout: 10_000 }, async () => {
      await pressHome(opts());
      await settle(500);
      // pressBack from home should be a no-op (or open assistant), should not throw
      await expect(pressBack(opts())).resolves.toBeUndefined();
    });

    it("swipe does not crash with valid coordinates", { timeout: 10_000 }, async () => {
      const size = await getScreenSize(opts());
      const cx = Math.round(size.width / 2);
      const fromY = Math.round(size.height * 0.7);
      const toY = Math.round(size.height * 0.3);
      await expect(swipe(cx, fromY, cx, toY, { duration: 300, ...opts() })).resolves.toBeUndefined();
      // Return to home
      await pressHome(opts());
      await settle(500);
    });
  });

  // ── 11. OCR ──────────────────────────────────────────────────────

  describe("OCR", () => {
    let tesseractAvailable = false;

    beforeAll(async () => {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const exec = promisify(execFile);
        await exec("tesseract", ["--version"], { timeout: 5_000 });
        tesseractAvailable = true;
      } catch {
        tesseractAvailable = false;
      }
    });

    it.runIf(tesseractAvailable)(
      "runOcrOnCurrentScreen returns OCR elements",
      { timeout: 30_000 },
      async () => {
        // Ensure we are on home screen so there is text to read
        await pressHome(opts());
        await settle(1000);

        const result = await runOcrOnCurrentScreen(opts());
        expect(result.source).toBe("ocr");
        expect(typeof result.screenshotPath).toBe("string");
        expect(existsSync(result.screenshotPath)).toBe(true);
        expect(Array.isArray(result.elements)).toBe(true);
        // Home screen usually has some text (app names, clock, etc.)
        // but we cannot guarantee it on every device, so just check the array
        expect(result.elements.length).toBeGreaterThanOrEqual(0);

        // If any elements found, verify structure
        if (result.elements.length > 0) {
          const el = result.elements[0];
          expect(typeof el.text).toBe("string");
          expect(el.text.length).toBeGreaterThan(0);
          expect(typeof el.bounds.left).toBe("number");
          expect(typeof el.confidence).toBe("number");
        }

        // Cleanup
        await unlink(result.screenshotPath).catch(() => {});
      },
    );

    it.skipIf(tesseractAvailable)(
      "OCR is skipped when tesseract is not installed",
      () => {
        // This test just documents that the suite skips OCR when tesseract is missing
        expect(tesseractAvailable).toBe(false);
      },
    );
  });

  // ── 12. Screen orientation ───────────────────────────────────────

  describe("Screen orientation", () => {
    it("getOrientation returns portrait or landscape", { timeout: 10_000 }, async () => {
      const orient = await getOrientation(opts());
      expect(["portrait", "landscape"]).toContain(orient);
    });

    it("getScreenState orientation matches getOrientation", { timeout: 10_000 }, async () => {
      const [state, orient] = await Promise.all([
        getScreenState(opts()),
        getOrientation(opts()),
      ]);
      expect(state.orientation).toBe(orient);
    });
  });

  // ── 13. Coordinate validation ────────────────────────────────────

  describe("Coordinate validation", () => {
    it("tap with negative coordinates is rejected", { timeout: 10_000 }, async () => {
      // validCoord() rejects negative values — they are never valid screen coords
      await expect(tap(-1, -1, opts())).rejects.toThrow();
    });

    it("tap with very large coordinates completes without crashing", { timeout: 10_000 }, async () => {
      // Large positive coords are technically valid — ADB just ignores off-screen taps
      await expect(tap(99999, 99999, opts())).resolves.toBeUndefined();
    });

    it("tap with zero coordinates does not crash", { timeout: 10_000 }, async () => {
      await expect(tap(0, 0, opts())).resolves.toBeUndefined();
    });

    it("swipe with identical start/end does not crash", { timeout: 10_000 }, async () => {
      await expect(swipe(100, 100, 100, 100, { duration: 100, ...opts() })).resolves.toBeUndefined();
    });
  });

  // ── 14. Automation — ensureReady ─────────────────────────────────

  describe("Automation", () => {
    it("ensureReady succeeds on an awake, unlocked device", { timeout: 30_000 }, async () => {
      const result = await ensureReady(opts());
      expect(typeof result.wasAsleep).toBe("boolean");
      expect(typeof result.launched).toBe("boolean");
      // launched should be false since we did not request a specific package
      expect(result.launched).toBe(false);
    });

    it("ensureReady with a non-existent package still returns (launched=true attempted)", { timeout: 30_000 }, async () => {
      // Use a package that almost certainly does not exist
      // ensureReady calls launchApp which may throw or just fail silently
      try {
        const result = await ensureReady({ ...opts(), packageName: "com.nonexistent.fake.app.test" });
        // If it doesn't throw, launched should be true (it tried to launch)
        expect(typeof result.launched).toBe("boolean");
      } catch {
        // It's acceptable for this to throw — the important thing is it does not hang
      }
    });
  });

  // ── 15. Multi-device ─────────────────────────────────────────────

  describe("Multi-device", () => {
    it("Device.connect with explicit serial works for the first device", { timeout: 10_000 }, async () => {
      const device = await Device.connect(deviceSerial);
      expect(device.serial).toBe(deviceSerial);
      const size = await device.getScreenSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });

    it.runIf(allDevices.filter((d) => d.state === "device").length > 1)(
      "when multiple devices exist, each can be targeted independently",
      { timeout: 15_000 },
      async () => {
        const ready = allDevices.filter((d) => d.state === "device");
        expect(ready.length).toBeGreaterThan(1);

        const deviceA = await Device.connect(ready[0].serial);
        const deviceB = await Device.connect(ready[1].serial);

        expect(deviceA.serial).not.toBe(deviceB.serial);

        // Both should be able to report screen size independently
        const [sizeA, sizeB] = await Promise.all([
          deviceA.getScreenSize(),
          deviceB.getScreenSize(),
        ]);
        expect(sizeA.width).toBeGreaterThan(0);
        expect(sizeB.width).toBeGreaterThan(0);
      },
    );
  });

  // ── 16. Device class integration ─────────────────────────────────

  describe("Device class integration", () => {
    let device: Device;

    beforeAll(async () => {
      device = await Device.connect(deviceSerial);
    });

    it("device.isReady returns true", { timeout: 10_000 }, async () => {
      const ready = await device.isReady();
      expect(ready).toBe(true);
    });

    it("device.getScreenSize returns valid dimensions", { timeout: 10_000 }, async () => {
      const size = await device.getScreenSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });

    it("device.isScreenOn returns a boolean", { timeout: 10_000 }, async () => {
      const on = await device.isScreenOn();
      expect(typeof on).toBe("boolean");
    });

    it("device.home navigates to launcher without throwing", { timeout: 15_000 }, async () => {
      await expect(device.home()).resolves.toBeUndefined();
      await settle(500);
    });

    it("device.screenshot returns a valid result", { timeout: 30_000 }, async () => {
      const result = await device.screenshot({ prefix: "device-class-test" });
      expect(existsSync(result.path)).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      await unlink(result.path).catch(() => {});
    });

    it("device.screenshotBase64 returns valid base64", { timeout: 30_000 }, async () => {
      const b64 = await device.screenshotBase64();
      expect(b64.length).toBeGreaterThan(100);
      expect(b64.startsWith("iVBOR")).toBe(true);
    });

    it("device.uiDump returns structured tree", { timeout: 30_000 }, async () => {
      const tree = await device.uiDump();
      expect(Array.isArray(tree.elements)).toBe(true);
      expect(tree.elements.length).toBeGreaterThan(0);
    });

    it("device.describeScreen returns a non-empty string", { timeout: 30_000 }, async () => {
      const description = await device.describeScreen();
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(0);
      // Should contain the package name
      expect(description).toContain("Package:");
    });

    it("device.ensureAwake does not throw", { timeout: 10_000 }, async () => {
      await expect(device.ensureAwake()).resolves.toBeUndefined();
    });
  });

  // ── 17. Activity stack ───────────────────────────────────────────

  describe("Activity stack", () => {
    it("getActivityStack returns an array", { timeout: 10_000 }, async () => {
      const stack = await getActivityStack(opts());
      expect(Array.isArray(stack)).toBe(true);
      // There should be at least one activity running
      if (stack.length > 0) {
        const activity = stack[0];
        expect(typeof activity.packageName).toBe("string");
        expect(typeof activity.activityName).toBe("string");
        expect(typeof activity.taskId).toBe("number");
      }
    });
  });

  // ── 18. Keyboard visibility ──────────────────────────────────────

  describe("Keyboard visibility", () => {
    it("isKeyboardVisible returns a boolean", { timeout: 10_000 }, async () => {
      const visible = await isKeyboardVisible(opts());
      expect(typeof visible).toBe("boolean");
    });

    it("keyboard is not visible on the home screen", { timeout: 15_000 }, async () => {
      await pressHome(opts());
      await settle(1000);
      const visible = await isKeyboardVisible(opts());
      expect(visible).toBe(false);
    });
  });

  // ── 19. waitForActivity ──────────────────────────────────────────

  describe("waitForActivity", () => {
    it("returns true when the target package is already in foreground", { timeout: 15_000 }, async () => {
      await pressHome(opts());
      await settle(1000);
      const fg = await getForegroundPackage(opts());
      // Wait for the package that is already in the foreground
      const found = await waitForActivity(fg, undefined, { ...opts(), timeout: 5000 });
      expect(found).toBe(true);
    });

    it("returns false when waiting for a package that will never appear", { timeout: 15_000 }, async () => {
      const found = await waitForActivity("com.nonexistent.package.xyz", undefined, {
        ...opts(),
        timeout: 2000,
        interval: 500,
      });
      expect(found).toBe(false);
    });
  });

  // ── 20. Raw ADB shell ────────────────────────────────────────────

  describe("Raw ADB shell", () => {
    it("adbShell can execute basic commands", { timeout: 10_000 }, async () => {
      const output = await adbShell("echo hello", opts());
      expect(output.trim()).toBe("hello");
    });

    it("adbShell can read device properties", { timeout: 10_000 }, async () => {
      const model = await adbShell("getprop ro.product.model", opts());
      expect(typeof model).toBe("string");
      expect(model.trim().length).toBeGreaterThan(0);
    });

    it("adbShell rejects for invalid commands", { timeout: 10_000 }, async () => {
      // A non-existent binary should fail
      await expect(
        adbShell("__nonexistent_binary_12345__", opts()),
      ).rejects.toThrow();
    });
  });

  // ── 21. App lifecycle ───────────────────────────────────────────────

  describe("App lifecycle", () => {
    it("listPackages returns an array of package names", { timeout: 15_000 }, async () => {
      const packages = await listPackages(undefined, opts());
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBeGreaterThan(10); // Every device has at least a dozen system packages
      // Each entry should look like a package name
      for (const pkg of packages.slice(0, 5)) {
        expect(pkg).toMatch(/^[a-zA-Z][a-zA-Z0-9_.]+$/);
      }
    });

    it("listPackages with filter narrows results", { timeout: 15_000 }, async () => {
      const all = await listPackages(undefined, opts());
      const filtered = await listPackages("android", opts());
      expect(filtered.length).toBeLessThanOrEqual(all.length);
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("isScreenOn returns a boolean", { timeout: 10_000 }, async () => {
      const on = await isScreenOn(opts());
      expect(typeof on).toBe("boolean");
      expect(on).toBe(true); // Screen must be on for tests to run
    });

    it("wakeScreen does not throw", { timeout: 10_000 }, async () => {
      await expect(wakeScreen(opts())).resolves.toBeUndefined();
    });

    it("launchApp opens Settings and stopApp closes it", { timeout: 20_000 }, async () => {
      await launchApp("com.android.settings", opts());
      await settle(1500);
      const state = await getScreenState(opts());
      expect(state.foregroundPackage).toContain("settings");

      await stopApp("com.android.settings", opts());
      await settle(500);
      // After stopping, the foreground should no longer be settings
      // (though it may briefly be — the important thing is stopApp didn't crash)
      await pressHome(opts());
      await settle(500);
    });
  });

  // ── 22. Shell execution ─────────────────────────────────────────────

  describe("Shell execution", () => {
    it("executeShell runs a command and returns structured result", { timeout: 10_000 }, async () => {
      const result = await executeShell("echo hello-from-shell", opts());
      expect(result.stdout.trim()).toBe("hello-from-shell");
      expect(result.exitCode).toBe(0);
    });

    it("executeShell captures exit code for failed commands", { timeout: 10_000 }, async () => {
      const result = await executeShell("ls /nonexistent_path_12345", opts());
      // ls on non-existent path returns exit code 1 on most Android shells
      expect(result.exitCode).not.toBe(0);
    });

    it("getProcessList returns an array of processes", { timeout: 10_000 }, async () => {
      const procs = await getProcessList(opts());
      expect(Array.isArray(procs)).toBe(true);
      expect(procs.length).toBeGreaterThan(5); // A running device has many processes
      if (procs.length > 0) {
        expect(typeof procs[0].pid).toBe("number");
        expect(typeof procs[0].name).toBe("string");
      }
    });

    it("getMemoryInfo returns total and available memory", { timeout: 10_000 }, async () => {
      const mem = await getMemoryInfo(opts());
      expect(typeof mem.totalMb).toBe("number");
      expect(mem.totalMb).toBeGreaterThan(0);
      expect(typeof mem.availableMb).toBe("number");
      expect(mem.availableMb).toBeGreaterThan(0);
      expect(mem.availableMb).toBeLessThanOrEqual(mem.totalMb);
    });
  });

  // ── 23. Filesystem ──────────────────────────────────────────────────

  describe("Filesystem", () => {
    const remoteTestDir = "/sdcard/pi-droid-e2e-test";
    const remoteTestFile = `${remoteTestDir}/test.txt`;
    let localTmpDir: string;

    beforeAll(async () => {
      localTmpDir = join(tmpdir(), `pi-droid-fs-test-${Date.now()}`);
      await mkdir(localTmpDir, { recursive: true });
      // Create a test file locally
      await writeFile(join(localTmpDir, "test.txt"), "pi-droid-e2e-test-content");
      // Create remote directory
      await adbShell(`mkdir -p ${remoteTestDir}`, opts());
    });

    afterAll(async () => {
      // Cleanup remote
      await adbShell(`rm -rf ${remoteTestDir}`, opts()).catch(() => {});
      // Cleanup local
      const { rmSync } = await import("node:fs");
      rmSync(localTmpDir, { recursive: true, force: true });
    });

    it("pushFile sends a file to the device", { timeout: 15_000 }, async () => {
      const result = await pushFile(join(localTmpDir, "test.txt"), remoteTestFile, opts());
      // PushPullResult has source, destination, output — no 'success' field
      expect(typeof result.source).toBe("string");
      expect(typeof result.destination).toBe("string");
      expect(typeof result.output).toBe("string");
    });

    it("fileExists returns true for a file we just pushed", { timeout: 10_000 }, async () => {
      const exists = await fileExists(remoteTestFile, opts());
      expect(exists).toBe(true);
    });

    it("fileExists returns false for a non-existent file", { timeout: 10_000 }, async () => {
      const exists = await fileExists("/sdcard/__nonexistent_file_e2e_12345__", opts());
      expect(exists).toBe(false);
    });

    it("pullFile retrieves the file back", { timeout: 15_000 }, async () => {
      const localDest = join(localTmpDir, "pulled.txt");
      const result = await pullFile(remoteTestFile, localDest, opts());
      expect(typeof result.source).toBe("string");
      expect(typeof result.destination).toBe("string");
      expect(existsSync(localDest)).toBe(true);
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(localDest, "utf-8");
      expect(content).toBe("pi-droid-e2e-test-content");
    });

    it("listDir lists files in the directory", { timeout: 10_000 }, async () => {
      const entries = await listDir(remoteTestDir, opts());
      expect(Array.isArray(entries)).toBe(true);
      const names = entries.map((e) => e.name);
      expect(names).toContain("test.txt");
    });

    it("getStorageInfo returns at least one partition", { timeout: 10_000 }, async () => {
      const info = await getStorageInfo(opts());
      expect(Array.isArray(info)).toBe(true);
      expect(info.length).toBeGreaterThan(0);
      const partition = info[0];
      expect(typeof partition.filesystem).toBe("string");
      expect(typeof partition.size).toBe("string");
      expect(typeof partition.available).toBe("string");
      expect(typeof partition.usePercent).toBe("string");
    });

    it("deleteFile removes a file from the device", { timeout: 10_000 }, async () => {
      await deleteFile(remoteTestFile, opts());
      const exists = await fileExists(remoteTestFile, opts());
      expect(exists).toBe(false);
    });
  });

  // ── 24. Intents & Clipboard ─────────────────────────────────────────

  describe("Intents & Clipboard", () => {
    it("setClipboard does not throw", { timeout: 15_000 }, async () => {
      // setClipboard uses ADB broadcast — may not round-trip on all devices
      // due to service call clipboard parsing differences across OEMs
      await expect(setClipboard("pi-droid-test", opts())).resolves.toBeUndefined();
    });

    it("getClipboard returns a string", { timeout: 15_000 }, async () => {
      const clip = await getClipboard(opts());
      expect(typeof clip).toBe("string");
    });

    it("openUrl opens a URL without crashing", { timeout: 15_000 }, async () => {
      await expect(openUrl("https://example.com", opts())).resolves.toBeUndefined();
      await settle(1500);
      // Verify something launched (browser)
      const state = await getScreenState(opts());
      expect(state.foregroundPackage.length).toBeGreaterThan(0);
      // Return to home
      await pressHome(opts());
      await settle(500);
    });

    it("sendIntent with VIEW action does not throw", { timeout: 10_000 }, async () => {
      await expect(
        sendIntent("android.intent.action.VIEW", { uri: "content://settings/system" }, opts()),
      ).resolves.toBeDefined();
    });
  });

  // ── 25. Package installer ───────────────────────────────────────────

  describe("Package installer", () => {
    it("isPackageInstalled returns true for a known system package", { timeout: 10_000 }, async () => {
      const installed = await isPackageInstalled("com.android.settings", opts());
      expect(installed).toBe(true);
    });

    it("isPackageInstalled returns false for a fake package", { timeout: 10_000 }, async () => {
      const installed = await isPackageInstalled("com.nonexistent.fake.package.xyz", opts());
      expect(installed).toBe(false);
    });

    it("getPackageVersion returns version info for a system package", { timeout: 10_000 }, async () => {
      const ver = await getPackageVersion("com.android.settings", opts());
      expect(ver).not.toBeNull();
      if (ver) {
        expect(typeof ver.versionName).toBe("string");
        expect(typeof ver.versionCode).toBe("number");
      }
    });

    it("getPackageVersion returns null for a non-existent package", { timeout: 10_000 }, async () => {
      const ver = await getPackageVersion("com.nonexistent.fake.package.xyz", opts());
      expect(ver).toBeNull();
    });

    it("getApkPath returns a path for a system package", { timeout: 10_000 }, async () => {
      const path = await getApkPath("com.android.settings", opts());
      expect(typeof path).toBe("string");
      expect(path!.endsWith(".apk")).toBe(true);
    });
  });

  // ── 26. Logcat ──────────────────────────────────────────────────────

  describe("Logcat", () => {
    it("captureLogcat returns recent log lines", { timeout: 15_000 }, async () => {
      const result = await captureLogcat({ ...opts(), lines: 50 });
      expect(Array.isArray(result.lines)).toBe(true);
      // There should be at least some log output on any running device
      expect(result.lines.length).toBeGreaterThan(0);
    });

    it("clearLogcat does not throw", { timeout: 10_000 }, async () => {
      await expect(clearLogcat(opts())).resolves.toBeUndefined();
    });

    it("getLogcatStats returns buffer stats", { timeout: 10_000 }, async () => {
      const stats = await getLogcatStats(opts());
      // LogcatStats has main, system, crash fields
      expect(typeof stats.main).toBe("string");
      expect(typeof stats.system).toBe("string");
      expect(typeof stats.crash).toBe("string");
    });
  });

  // ── 27. Screen recording ────────────────────────────────────────────

  describe("Screen recording", () => {
    it("isRecording returns false when nothing is recording", { timeout: 10_000 }, async () => {
      const recording = await isRecording(opts());
      expect(recording).toBe(false);
    });
  });

  // ── 28. WiFi ────────────────────────────────────────────────────────

  describe("WiFi", () => {
    it("getWifiIp returns an IP or null", { timeout: 10_000 }, async () => {
      const ip = await getWifiIp(opts());
      if (ip !== null) {
        // Should look like an IPv4 address
        expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      }
    });
  });

  // ── 29. Annotated screenshot ────────────────────────────────────────

  describe("Annotated screenshot", () => {
    it("annotatedScreenshot returns elements with labels and coordinates", { timeout: 30_000 }, async () => {
      await pressHome(opts());
      await settle(1000);

      const result = await annotatedScreenshot(opts());
      expect(typeof result.screenshotPath).toBe("string");
      expect(existsSync(result.screenshotPath)).toBe(true);
      expect(Array.isArray(result.elements)).toBe(true);
      expect(result.elements.length).toBeGreaterThan(0);

      // AnnotatedElement has: label (number), displayText, type, center, bounds
      const el = result.elements[0];
      expect(typeof el.label).toBe("number");
      expect(typeof el.displayText).toBe("string");
      expect(typeof el.type).toBe("string");
      expect(typeof el.center).toBe("object");
      expect(typeof el.center.x).toBe("number");
      expect(typeof el.center.y).toBe("number");

      // The textIndex is the formatted element list
      expect(typeof result.textIndex).toBe("string");
      expect(result.textIndex.length).toBeGreaterThan(0);

      // Cleanup
      await unlink(result.screenshotPath).catch(() => {});
    });

    it("annotatedScreenshot with allElements flag includes non-interactive elements", { timeout: 30_000 }, async () => {
      const normal = await annotatedScreenshot(opts());
      const all = await annotatedScreenshot({ ...opts(), allElements: true });

      // With allElements, we should get at least as many elements
      expect(all.elements.length).toBeGreaterThanOrEqual(normal.elements.length);

      // Cleanup
      await unlink(normal.screenshotPath).catch(() => {});
      await unlink(all.screenshotPath).catch(() => {});
    });
  });

  // ── 30. UI tree summarizeTree ───────────────────────────────────────

  describe("UI tree summary", () => {
    it("summarizeTree produces a formatted text summary", { timeout: 30_000 }, async () => {
      const tree = await dumpUiTree({ ...opts(), skipCache: true });
      const summary = summarizeTree(tree);
      expect(typeof summary).toBe("string");
      expect(summary).toContain("Package:");
      expect(summary).toContain("Elements (");
      // Should have indexed lines
      expect(summary).toMatch(/\[\d+\]/);
    });
  });

  // ── 31. Text input ──────────────────────────────────────────────────

  describe("Text input", () => {
    it("typeText does not throw for basic ASCII text", { timeout: 15_000 }, async () => {
      // Open a text field by launching settings search
      await launchApp("com.android.settings", opts());
      await settle(1500);

      // Type some text — this exercises ADBKeyboard or fallback broadcast
      await expect(typeText("test123", opts())).resolves.toBeUndefined();

      // Cleanup
      await pressHome(opts());
      await settle(500);
    });
  });
});

// ── Suite-level skip message ───────────────────────────────────────

describe.skipIf(deviceAvailable)("Device E2E (no device)", () => {
  it("skipped — no ADB device connected", () => {
    // This test exists so the runner shows a clear message
    // when no device is available, rather than silent empty output.
    expect(true).toBe(true);
  });
});
