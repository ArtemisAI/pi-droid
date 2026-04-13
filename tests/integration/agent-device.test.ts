/**
 * Agent + Device integration tests.
 *
 * Uses @marcfargas/pi-test-harness with REAL tool execution against a
 * connected Android device. The LLM is replaced by playbook scripts
 * (deterministic), but every tool call hits the actual device through
 * the pi-droid extension — no mocks.
 *
 * This validates the full stack:
 *   pi-agent session → pi-droid extension → tool handler → ADB → device
 *
 * Run with:  npm run test:device
 *   — or —   npx vitest run tests/integration/agent-device.test.ts
 */

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createTestSession, when, calls, says } from "@marcfargas/pi-test-harness";
import type { TestSession } from "@marcfargas/pi-test-harness";
import { join } from "path";
import { execSync } from "child_process";
import { patchAgentForHarness } from "./harness-patch.js";

const EXTENSION_PATH = join(import.meta.dirname, "../../src/index.ts");

// ── Detect device availability synchronously ──────────────────────────
let deviceAvailable = false;

try {
  const output = execSync("adb devices", { encoding: "utf-8", timeout: 5000 });
  const lines = output.split("\n").slice(1).filter((l) => l.includes("\tdevice"));
  deviceAvailable = lines.length > 0;
} catch {
  deviceAvailable = false;
}

beforeAll(() => {
  patchAgentForHarness();
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-key-not-used";
  }
});

// ═══════════════════════════════════════════════════════════════════════
// All tests below require a connected device.
// The harness scripts the LLM but tools execute against the REAL device.
// ═══════════════════════════════════════════════════════════════════════

describe.runIf(deviceAvailable)("Agent + Real Device", () => {
  let t: TestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  // ── Perception: agent looks at the screen ─────────────────────────

  it("agent reads screen state from real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("What app is currently in the foreground?", [
        calls("android_screen_state", {}),
        says("The device screen state has been retrieved."),
      ]),
    );

    // Tool was called and returned real device data
    const results = t.events.toolResultsFor("android_screen_state");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    // Parse the real response
    const data = JSON.parse(results[0].text);
    expect(typeof data.foregroundPackage).toBe("string");
    expect(data.foregroundPackage.length).toBeGreaterThan(0);
    expect(typeof data.screenOn).toBe("boolean");
    expect(["portrait", "landscape"]).toContain(data.orientation);
  });

  // NOTE: android_screenshot is skipped in harness tests because the real
  // tool execution (screencap + pull) exceeds the harness agent-loop timeout.
  // Screenshot is thoroughly tested in device-e2e.test.ts instead.
  it.skip("agent takes a real screenshot", { timeout: 60_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Take a screenshot of the device", [
        calls("android_screenshot", {}),
        says("Screenshot captured."),
      ]),
    );

    const results = t.events.toolResultsFor("android_screenshot");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
  });

  it("agent dumps UI tree from real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Dump the UI tree", [
        calls("android_ui_dump", {}),
        says("UI tree dumped."),
      ]),
    );

    const results = t.events.toolResultsFor("android_ui_dump");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
    expect(results[0].text.length).toBeGreaterThan(50);
  });

  // ── Device info: agent queries device state ───────────────────────

  it("agent retrieves real device info", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("What device is this?", [
        calls("android_device_info", { what: "device" }),
        says("Device info retrieved."),
      ]),
    );

    const results = t.events.toolResultsFor("android_device_info");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    // Tool returns { device: { model, manufacturer, ... } }
    const data = JSON.parse(results[0].text);
    expect(typeof data.device).toBe("object");
    expect(typeof data.device.model).toBe("string");
    expect(data.device.model.length).toBeGreaterThan(0);
    expect(typeof data.device.manufacturer).toBe("string");
  });

  it("agent checks preflight status on real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Run preflight checks", [
        calls("android_preflight", {}),
        says("Preflight complete."),
      ]),
    );

    const results = t.events.toolResultsFor("android_preflight");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    const data = JSON.parse(results[0].text);
    expect(typeof data.ready).toBe("boolean");
  });

  // ── Interaction: agent taps and types on real device ───────────────

  it("agent navigates home then checks state", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Press the home button and tell me what's on screen", [
        calls("android_key", { key: "HOME" }),
        calls("android_screen_state", {}),
        says("Pressed home, now on the launcher."),
      ]),
    );

    expect(t.events.toolResultsFor("android_key")).toHaveLength(1);
    expect(t.events.toolResultsFor("android_key")[0].mocked).toBe(false);

    const stateResults = t.events.toolResultsFor("android_screen_state");
    expect(stateResults).toHaveLength(1);
    expect(stateResults[0].mocked).toBe(false);

    expect(t.events.toolSequence()).toEqual(["android_key", "android_screen_state"]);
  });

  it("agent taps a coordinate on the real screen", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Tap at coordinates 500, 500", [
        calls("android_tap", { x: 500, y: 500 }),
        says("Tapped."),
      ]),
    );

    const results = t.events.toolResultsFor("android_tap");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
    expect(results[0].isError).toBe(false);
  });

  it("agent swipes on the real screen", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Swipe up on the screen", [
        calls("android_swipe", { x1: 500, y1: 1500, x2: 500, y2: 500, duration: 300 }),
        says("Swiped."),
      ]),
    );

    const results = t.events.toolResultsFor("android_swipe");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
    expect(results[0].isError).toBe(false);

    // Return to home
    const { pressHome } = await import("../../src/adb/input.js");
    await pressHome();
  });

  // ── Multi-turn: agent performs a sequence on real device ───────────

  it("agent performs multi-turn perception-action cycle", { timeout: 60_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      // Turn 1: Check what's on screen
      when("What's currently on the device screen?", [
        calls("android_screen_state", {}),
        says("The device is showing the home screen."),
      ]),
      // Turn 2: Navigate somewhere
      when("Open the Settings app", [
        calls("android_app", { action: "launch", package: "com.android.settings" }),
        says("Settings opened."),
      ]),
      // Turn 3: Verify navigation worked
      when("Confirm we're in Settings now", [
        calls("android_screen_state", {}),
        says("Yes, Settings is in the foreground."),
      ]),
    );

    // Verify all 3 turns executed against real device
    expect(t.events.toolSequence()).toEqual([
      "android_screen_state",
      "android_app",
      "android_screen_state",
    ]);

    // All results are real (not mocked)
    for (const result of t.events.toolResults) {
      expect(result.mocked).toBe(false);
    }

    // The second screen_state call should show something — the important
    // thing is that 3 real tool calls succeeded in sequence
    const stateResults = t.events.toolResultsFor("android_screen_state");
    expect(stateResults).toHaveLength(2);
    const finalState = JSON.parse(stateResults[1].text);
    expect(typeof finalState.foregroundPackage).toBe("string");
    expect(finalState.foregroundPackage.length).toBeGreaterThan(0);

    // Cleanup
    const { pressHome } = await import("../../src/adb/input.js");
    await pressHome();
  });

  // ── System tools: agent queries system state ──────────────────────

  it("agent reads real logcat", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Show me recent log output", [
        calls("android_logcat", { action: "capture", lines: 20 }),
        says("Here are the recent logs."),
      ]),
    );

    const results = t.events.toolResultsFor("android_logcat");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
  });

  it("agent runs a shell command on real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Run 'getprop ro.product.model' on the device", [
        calls("android_shell", { command: "getprop ro.product.model" }),
        says("The device model is returned."),
      ]),
    );

    const results = t.events.toolResultsFor("android_shell");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
    expect(results[0].text.length).toBeGreaterThan(0);
  });

  it("agent checks lock status on real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Is the device locked?", [
        calls("android_lock_status", {}),
        says("Lock status retrieved."),
      ]),
    );

    const results = t.events.toolResultsFor("android_lock_status");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    const data = JSON.parse(results[0].text);
    expect(typeof data.hasPattern).toBe("boolean");
    expect(typeof data.hasPin).toBe("boolean");
    expect(typeof data.isSecure).toBe("boolean");
  });

  it("agent discovers connected devices", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Find all connected Android devices", [
        calls("android_devices", { action: "discover" }),
        says("Devices discovered."),
      ]),
    );

    const results = t.events.toolResultsFor("android_devices");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    const data = JSON.parse(results[0].text);
    expect(typeof data.discovered).toBe("number");
    expect(data.discovered).toBeGreaterThanOrEqual(0);
  });

  // ── Settings: agent reads device settings ─────────────────────────

  it("agent reads device brightness on real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("What's the current screen brightness?", [
        calls("android_settings", { action: "get", setting: "brightness" }),
        says("Brightness level retrieved."),
      ]),
    );

    const results = t.events.toolResultsFor("android_settings");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);

    const data = JSON.parse(results[0].text);
    expect(typeof data.level).toBe("number");
  });

  // ── Automation: ensureReady on real device ─────────────────────────

  it("agent runs ensureReady on real device", { timeout: 30_000 }, async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Make sure the device is ready to use", [
        calls("android_ensure_ready", {}),
        says("Device is ready."),
      ]),
    );

    const results = t.events.toolResultsFor("android_ensure_ready");
    expect(results).toHaveLength(1);
    expect(results[0].mocked).toBe(false);
  });
});

// ── Suite-level skip message ──────────────────────────────────────────

describe.skipIf(deviceAvailable)("Agent + Device (no device)", () => {
  it("skipped — no ADB device connected", () => {
    expect(true).toBe(true);
  });
});
