import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/adb/screenshot.js", () => ({
  takeScreenshot: vi.fn(async () => ({ path: "/tmp/screen.png", width: 1440, height: 2960 })),
}));

vi.mock("../../src/adb/input.js", () => ({
  keyEvent: vi.fn(async () => {}),
}));

vi.mock("../../src/adb/app.js", () => ({
  launchApp: vi.fn(async () => {}),
}));

import { launchApp } from "../../src/adb/app.js";
import { keyEvent } from "../../src/adb/input.js";
import { takeScreenshot } from "../../src/adb/screenshot.js";
import {
  createInputRouter,
  executeRoutedTool,
  resolveRoutedTool,
  type RouterConfig,
} from "../../src/tools/router.js";

const mockTakeScreenshot = vi.mocked(takeScreenshot);
const mockKeyEvent = vi.mocked(keyEvent);
const mockLaunchApp = vi.mocked(launchApp);

describe("resolveRoutedTool()", () => {
  const config: RouterConfig = {
    routes: [
      {
        name: "screenshot",
        patterns: ["\\b(?:take|capture)\\s+(?:a\\s+)?screenshot\\b"],
        tool: "android_screenshot",
      },
      {
        name: "home",
        patterns: ["^(?:go\\s+home|press\\s+home)$"],
        tool: "android_key",
        args: { key: "KEYCODE_HOME" },
      },
      {
        name: "back",
        patterns: ["^(?:go\\s+back|press\\s+back)$"],
        tool: "android_key",
        args: { key: "KEYCODE_BACK" },
      },
      {
        name: "open_app",
        patterns: ["^open\\s+(?<app>.+)$"],
        tool: "android_app",
        args: { action: "launch", package: "$app" },
      },
    ],
    appAliases: {
      chrome: "com.android.chrome",
    },
  };

  it("matches screenshot intent", () => {
    const route = resolveRoutedTool("take a screenshot", config);
    expect(route).toEqual({
      name: "screenshot",
      tool: "android_screenshot",
      args: {},
    });
  });

  it("matches go home intent", () => {
    const route = resolveRoutedTool("go home", config);
    expect(route).toEqual({
      name: "home",
      tool: "android_key",
      args: { key: "KEYCODE_HOME" },
    });
  });

  it("resolves open app route from alias", () => {
    const route = resolveRoutedTool("open chrome", config);
    expect(route).toEqual({
      name: "open_app",
      tool: "android_app",
      args: { action: "launch", package: "com.android.chrome" },
    });
  });

  it("resolves open app route from package name", () => {
    const route = resolveRoutedTool("open com.example.app", config);
    expect(route).toEqual({
      name: "open_app",
      tool: "android_app",
      args: { action: "launch", package: "com.example.app" },
    });
  });

  it("falls back to single-tool detection", () => {
    const route = resolveRoutedTool("android_key KEYCODE_ENTER", { routes: [] });
    expect(route).toEqual({
      name: "single_tool",
      tool: "android_key",
      args: { key: "KEYCODE_ENTER" },
    });
  });

  it("skips malformed regex patterns safely", () => {
    const route = resolveRoutedTool("go home", {
      routes: [
        {
          patterns: ["("],
          tool: "android_key",
          args: { key: "KEYCODE_ENTER" },
        },
        {
          name: "home",
          patterns: ["go\\s+home"],
          tool: "android_key",
          args: { key: "KEYCODE_HOME" },
        },
      ],
    });
    expect(route).toEqual({
      name: "home",
      tool: "android_key",
      args: { key: "KEYCODE_HOME" },
    });
  });

  it("returns null when app package cannot be extracted", () => {
    const route = resolveRoutedTool("open an app please", config);
    expect(route).toBeNull();
  });
});

describe("executeRoutedTool()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes android_screenshot", async () => {
    const result = await executeRoutedTool({ name: "screenshot", tool: "android_screenshot", args: {} }, { serial: "ABC123" });
    expect(mockTakeScreenshot).toHaveBeenCalledWith({ serial: "ABC123" });
    expect(result).toEqual({
      routed_to: "android_screenshot",
      result: { path: "/tmp/screen.png", width: 1440, height: 2960 },
    });
  });

  it("executes android_key", async () => {
    const result = await executeRoutedTool({ name: "back", tool: "android_key", args: { key: "KEYCODE_BACK" } }, { serial: "SERIAL1" });
    expect(mockKeyEvent).toHaveBeenCalledWith("KEYCODE_BACK", { serial: "SERIAL1" });
    expect(result).toEqual({
      routed_to: "android_key",
      key: "KEYCODE_BACK",
    });
  });

  it("executes android_app launch", async () => {
    const result = await executeRoutedTool(
      { name: "open_app", tool: "android_app", args: { action: "launch", package: "com.android.chrome" } },
      { serial: "SERIAL2" },
    );
    expect(mockLaunchApp).toHaveBeenCalledWith("com.android.chrome", { serial: "SERIAL2" });
    expect(result).toEqual({
      routed_to: "android_app",
      launched: "com.android.chrome",
    });
  });
});

describe("createInputRouter()", () => {
  it("returns handled=false when routing is disabled", async () => {
    const router = createInputRouter("/home/runner/work/pi-droid/pi-droid");
    await router.configure({ enabled: false });
    const result = await router.handleRoutedInput("go home", {});
    expect(result).toEqual({ handled: false });
  });
});
