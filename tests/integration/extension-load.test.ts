/**
 * Integration tests: extension loading and tool registration.
 *
 * Uses @marcfargas/pi-test-harness to run a real pi session with our
 * extension. ADB tools are mocked — no physical device needed.
 */

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createTestSession, when, calls, says } from "@marcfargas/pi-test-harness";
import type { TestSession } from "@marcfargas/pi-test-harness";
import { join } from "path";
import { patchAgentForHarness } from "./harness-patch.js";

const EXTENSION_PATH = join(import.meta.dirname, "../../src/index.ts");

beforeAll(() => {
  patchAgentForHarness();
  // The harness replaces the stream function so no real LLM calls happen,
  // but the session validates API key presence before delegating to the agent.
  // Set a dummy key so the validation passes.
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-key-not-used";
  }
});

/** Minimal mock responses for ADB tools so the extension loads cleanly. */
const ADB_MOCKS = {
  android_screenshot: () =>
    JSON.stringify({ path: "/tmp/screen.png", width: 1440, height: 2960 }),
  android_screen_state: () =>
    JSON.stringify({
      activity: "com.android.launcher3/.Launcher",
      package: "com.android.launcher3",
      isLocked: false,
      orientation: "portrait",
    }),
  android_look: () =>
    JSON.stringify({
      elements: [
        { index: 0, text: "Chrome", bounds: { left: 80, top: 180, right: 200, bottom: 300 } },
        { index: 1, text: "Settings", bounds: { left: 300, top: 180, right: 420, bottom: 300 } },
      ],
    }),
  android_ui_dump: () => "<hierarchy>...</hierarchy>",
  android_device_info: () =>
    JSON.stringify({ model: "SM-G960F", sdk: 28, brand: "samsung" }),
  android_preflight: () =>
    JSON.stringify({ ready: true, checks: [] }),
  android_ensure_ready: () =>
    JSON.stringify({ ready: true }),
  android_tap: () => JSON.stringify({ success: true }),
  android_type: () => JSON.stringify({ success: true }),
  android_swipe: () => JSON.stringify({ success: true }),
  android_scroll: () => JSON.stringify({ success: true }),
  android_key: () => JSON.stringify({ success: true }),
  android_app: () =>
    JSON.stringify({ success: true, status: "running" }),
  android_wait: () => JSON.stringify({ found: true }),
  android_wait_activity: () => JSON.stringify({ matched: true }),
  android_shell: () => JSON.stringify({ stdout: "", exitCode: 0 }),
  android_ocr: () => JSON.stringify({ text: "Sample text", confidence: 0.92 }),
  android_observe: () =>
    JSON.stringify({ activity: "com.android.launcher3/.Launcher" }),
  android_find_and_tap: () => JSON.stringify({ found: true, tapped: true }),
  android_scroll_find: () =>
    JSON.stringify({ found: true, element: { text: "Target" } }),
  android_plugin_status: () => JSON.stringify({}),
  android_plugin_action: () =>
    JSON.stringify({ success: true, data: {} }),
  android_plugin_cycle: () =>
    JSON.stringify({ success: true }),
  android_skills: () => JSON.stringify({ skills: [] }),
  android_account_list: () => JSON.stringify({ accounts: [] }),
  android_account_create: () => JSON.stringify({ success: true }),
  android_account_run_pending: () =>
    JSON.stringify({ ran: 0, skipped: 0 }),
  android_lock_status: () =>
    JSON.stringify({ locked: false, type: "none" }),
  android_lock_clear: () => JSON.stringify({ success: true }),
  android_lock_set_pattern: () => JSON.stringify({ success: true }),
  android_lock_set_pin: () => JSON.stringify({ success: true }),
  android_devices: () =>
    JSON.stringify({ devices: [{ serial: "mock123", state: "device" }] }),
  android_install: () => JSON.stringify({ success: true }),
  android_record: () => JSON.stringify({ recording: false }),
  android_wifi: () => JSON.stringify({ connected: true }),
  android_settings: () => JSON.stringify({ value: "auto" }),
  android_logcat: () => JSON.stringify({ lines: [] }),
  android_processes: () => JSON.stringify({ processes: [] }),
};

describe("Extension loading", () => {
  let t: TestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  it("loads extension and registers all tools", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    // Ask the agent something that exercises a core tool
    await t.run(
      when("What is on the screen right now?", [
        calls("android_screen_state", {}),
        says("The device is on the home screen — the launcher is in the foreground."),
      ]),
    );

    // Verify the tool was called
    const screenStateCalls = t.events.toolCallsFor("android_screen_state");
    expect(screenStateCalls).toHaveLength(1);
    expect(screenStateCalls[0].blocked).toBe(false);
  });

  it("handles multi-tool perception sequence", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Look at the screen and tell me what apps are visible", [
        calls("android_look", {}),
        says("I can see Chrome and Settings on the home screen."),
      ]),
    );

    const lookCalls = t.events.toolCallsFor("android_look");
    expect(lookCalls).toHaveLength(1);

    // Verify the mock returned our data
    const lookResults = t.events.toolResultsFor("android_look");
    expect(lookResults).toHaveLength(1);
    expect(lookResults[0].mocked).toBe(true);
    expect(lookResults[0].text).toContain("Chrome");
  });

  it("exercises tap and type tools", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Tap on Chrome and type hello", [
        calls("android_tap", { text: "Chrome" }),
        calls("android_type", { text: "hello" }),
        says("Done — tapped Chrome and typed hello."),
      ]),
    );

    expect(t.events.toolCallsFor("android_tap")).toHaveLength(1);
    expect(t.events.toolCallsFor("android_tap")[0].input).toEqual({ text: "Chrome" });
    expect(t.events.toolCallsFor("android_type")).toHaveLength(1);
    expect(t.events.toolCallsFor("android_type")[0].input).toEqual({ text: "hello" });
  });
});

describe("Multi-turn conversations", () => {
  let t: TestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  it("maintains session state across turns", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Check the device info", [
        calls("android_device_info", {}),
        says("This is a Samsung Galaxy S9 running SDK 28."),
      ]),
      when("Now check what's on screen", [
        calls("android_screen_state", {}),
        says("The launcher is in the foreground."),
      ]),
    );

    // Both turns executed
    expect(t.events.toolCallsFor("android_device_info")).toHaveLength(1);
    expect(t.events.toolCallsFor("android_screen_state")).toHaveLength(1);
    expect(t.events.toolSequence()).toEqual(["android_device_info", "android_screen_state"]);
  });
});

describe("Plugin tools", () => {
  let t: TestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  it("calls plugin status tool", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("What plugins are loaded?", [
        calls("android_plugin_status", {}),
        says("No plugins are currently loaded."),
      ]),
    );

    expect(t.events.toolCallsFor("android_plugin_status")).toHaveLength(1);
  });

  it("calls skills discovery tool", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("What Android skills are available?", [
        calls("android_skills", { format: "json" }),
        says("No plugin skills are registered yet."),
      ]),
    );

    expect(t.events.toolCallsFor("android_skills")).toHaveLength(1);
  });
});

describe("Account tools", () => {
  let t: TestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  it("lists accounts", async () => {
    t = await createTestSession({
      extensions: [EXTENSION_PATH],
      mockTools: ADB_MOCKS,
      mockUI: { confirm: true },
      propagateErrors: true,
    });

    await t.run(
      when("Show me all configured accounts", [
        calls("android_account_list", { filter: "all" }),
        says("No accounts are configured yet."),
      ]),
    );

    expect(t.events.toolCallsFor("android_account_list")).toHaveLength(1);
    expect(t.events.toolCallsFor("android_account_list")[0].input).toEqual({ filter: "all" });
  });
});
