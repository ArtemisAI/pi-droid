import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
  getScreenState,
  getActivityStack,
  isKeyboardVisible,
  getOrientation,
  waitForActivity,
} from "../../src/adb/screen-state.js";

const mockExecFile = vi.mocked(execFile);

/** Track call index to return different responses per sequential adbShell call. */
let callResponses: string[];
let callIndex: number;

/**
 * Set up sequential mock responses. Each adb shell call returns the next response.
 */
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

/**
 * Simple mock that always returns the same stdout.
 */
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
  vi.useRealTimers();
});

// ── getScreenState ──────────────────────────────────────────────────

describe("getScreenState()", () => {
  it("returns a full screen state snapshot", async () => {
    // getScreenState fires 5 parallel adbShell calls via Promise.all:
    // 1. dumpsys window
    // 2. dumpsys input_method | grep mInputShown
    // 3. dumpsys display | grep mCurrentOrientation
    // 4. dumpsys power | grep 'Display Power'
    // 5. dumpsys window | grep lock stuff
    mockSequential(
      // 1: dumpsys window (full)
      [
        "  mCurrentFocus=Window{abc123 u0 com.example.testapp/.MainActivity}",
        "  mFocusedApp=AppWindowToken{def456 token=Token{ghi789 ActivityRecord{jkl com.example.testapp/.MainActivity t42}}}",
        "  mBaseDisplayDensity=560",
      ].join("\n"),
      // 2: input method
      "  mInputShown=false",
      // 3: display orientation
      "  mCurrentOrientation=0",
      // 4: power display
      "  Display Power: state=ON",
      // 5: lock screen
      "  mDreamingLockscreen=false isStatusBarKeyguard=false",
    );

    const state = await getScreenState();

    expect(state.screenOn).toBe(true);
    expect(state.locked).toBe(false);
    expect(state.foregroundPackage).toBe("com.example.testapp");
    expect(state.foregroundActivity).toBe(".MainActivity");
    expect(state.hasOverlay).toBe(false);
    expect(state.keyboardVisible).toBe(false);
    expect(state.orientation).toBe("portrait");
    expect(state.density).toBe(560);
  });

  it("detects locked screen", async () => {
    mockSequential(
      "  mCurrentFocus=Window{abc u0 StatusBar}",
      "  mInputShown=false",
      "  mCurrentOrientation=0",
      "  Display Power: state=ON",
      "  mDreamingLockscreen=true isStatusBarKeyguard=true",
    );

    const state = await getScreenState();
    expect(state.locked).toBe(true);
  });

  it("detects keyboard visible", async () => {
    mockSequential(
      "  mCurrentFocus=Window{abc u0 com.app/.Edit}",
      "  mInputShown=true",
      "  mCurrentOrientation=0",
      "  Display Power: state=ON",
      "  mDreamingLockscreen=false",
    );

    const state = await getScreenState();
    expect(state.keyboardVisible).toBe(true);
  });

  it("detects landscape orientation", async () => {
    mockSequential(
      "  mCurrentFocus=Window{abc u0 com.app/.View}",
      "  mInputShown=false",
      "  mCurrentOrientation=1",
      "  Display Power: state=ON",
      "  mDreamingLockscreen=false",
    );

    const state = await getScreenState();
    expect(state.orientation).toBe("landscape");
  });

  it("detects overlay when mCurrentFocus differs from mFocusedApp", async () => {
    mockSequential(
      [
        "  mCurrentFocus=Window{abc u0 com.android.systemui/.PermissionDialog}",
        "  mFocusedApp=AppWindowToken{def token=Token{ghi ActivityRecord{jkl com.example.testapp/.MainActivity t42}}}",
      ].join("\n"),
      "  mInputShown=false",
      "  mCurrentOrientation=0",
      "  Display Power: state=ON",
      "  mDreamingLockscreen=false",
    );

    const state = await getScreenState();
    expect(state.hasOverlay).toBe(true);
    expect(state.foregroundPackage).toBe("com.android.systemui");
  });

  it("detects screen off", async () => {
    mockSequential(
      "  mCurrentFocus=Window{abc u0 com.app/.View}",
      "  mInputShown=false",
      "  mCurrentOrientation=0",
      "  Display Power: state=OFF",
      "  mDreamingLockscreen=false",
    );

    const state = await getScreenState();
    expect(state.screenOn).toBe(false);
  });
});

// ── getActivityStack ────────────────────────────────────────────────

describe("getActivityStack()", () => {
  it("parses activity records from dumpsys output", async () => {
    mockStdout(
      [
        "  * TaskRecord{abc123 #42 A=com.example.testapp U=0 StackId=1 sz=2}",
        "    * Hist #1: ActivityRecord{def456 com.example.testapp/.ProfileActivity t42}",
        "    * Hist #0: ActivityRecord{ghi789 com.example.testapp/.MainActivity t42}",
        "  * TaskRecord{jkl012 #41 A=com.android.launcher U=0 StackId=0 sz=1}",
        "    * Hist #0: ActivityRecord{mno345 com.android.launcher/.Launcher t41}",
      ].join("\n"),
    );

    const stack = await getActivityStack();

    expect(stack).toHaveLength(3);
    expect(stack[0]).toEqual({
      packageName: "com.example.testapp",
      activityName: ".ProfileActivity",
      taskId: 42,
    });
    expect(stack[1]).toEqual({
      packageName: "com.example.testapp",
      activityName: ".MainActivity",
      taskId: 42,
    });
    expect(stack[2]).toEqual({
      packageName: "com.android.launcher",
      activityName: ".Launcher",
      taskId: 41,
    });
  });

  it("returns empty array when no activities", async () => {
    mockStdout("  No activities found.");
    const stack = await getActivityStack();
    expect(stack).toEqual([]);
  });
});

// ── isKeyboardVisible ───────────────────────────────────────────────

describe("isKeyboardVisible()", () => {
  it("returns true when keyboard is shown", async () => {
    mockStdout("  mInputShown=true");
    expect(await isKeyboardVisible()).toBe(true);
  });

  it("returns false when keyboard is hidden", async () => {
    mockStdout("  mInputShown=false");
    expect(await isKeyboardVisible()).toBe(false);
  });

  it("returns false on ADB error", async () => {
    mockError();
    expect(await isKeyboardVisible()).toBe(false);
  });
});

// ── getOrientation ──────────────────────────────────────────────────

describe("getOrientation()", () => {
  it("returns portrait for orientation 0", async () => {
    mockStdout("  mCurrentOrientation=0");
    expect(await getOrientation()).toBe("portrait");
  });

  it("returns landscape for orientation 1", async () => {
    mockStdout("  mCurrentOrientation=1");
    expect(await getOrientation()).toBe("landscape");
  });

  it("returns landscape for orientation 3", async () => {
    mockStdout("  mCurrentOrientation=3");
    expect(await getOrientation()).toBe("landscape");
  });

  it("returns portrait for orientation 2", async () => {
    mockStdout("  mCurrentOrientation=2");
    expect(await getOrientation()).toBe("portrait");
  });

  it("falls back to user_rotation when dumpsys fails", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      callCount++;
      if (callCount === 1) {
        // First call (dumpsys display) fails
        const err: any = new Error("fail");
        err.stderr = "error";
        err.code = 1;
        if (cb) cb(err);
      } else {
        // Second call (settings get) returns landscape
        if (cb) cb(null, { stdout: "1", stderr: "" });
      }
      return {} as any;
    });

    expect(await getOrientation()).toBe("landscape");
  });
});

// ── waitForActivity ─────────────────────────────────────────────────

describe("waitForActivity()", () => {
  it("returns true immediately when activity is already in foreground", async () => {
    mockStdout(
      "  mCurrentFocus=Window{abc u0 com.example.testapp/.MainActivity}",
    );

    const result = await waitForActivity("com.example.testapp", ".MainActivity", {
      timeout: 2000,
      interval: 100,
    });
    expect(result).toBe(true);
  });

  it("returns true when matching package only (no activity filter)", async () => {
    mockStdout(
      "  mCurrentFocus=Window{abc u0 com.example.testapp/.SomeOtherActivity}",
    );

    const result = await waitForActivity("com.example.testapp", undefined, {
      timeout: 2000,
      interval: 100,
    });
    expect(result).toBe(true);
  });

  it("returns false on timeout when activity never appears", async () => {
    mockStdout(
      "  mCurrentFocus=Window{abc u0 com.other.app/.MainActivity}",
    );

    const result = await waitForActivity("com.example.testapp", ".MainActivity", {
      timeout: 600,
      interval: 100,
    });
    expect(result).toBe(false);
  });

  it("returns true when activity appears after a few polls", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      callCount++;
      const stdout =
        callCount < 3
          ? "  mCurrentFocus=Window{abc u0 com.other/.X}"
          : "  mCurrentFocus=Window{abc u0 com.example.testapp/.MainActivity}";
      if (cb) cb(null, { stdout, stderr: "" });
      return {} as any;
    });

    const result = await waitForActivity("com.example.testapp", ".MainActivity", {
      timeout: 5000,
      interval: 50,
    });
    expect(result).toBe(true);
  });

  it("handles ADB errors gracefully and keeps retrying", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      callCount++;
      if (callCount < 3) {
        const err: any = new Error("fail");
        err.stderr = "error";
        err.code = 1;
        if (cb) cb(err);
      } else {
        if (cb) cb(null, { stdout: "  mCurrentFocus=Window{abc u0 com.example.testapp/.Main}", stderr: "" });
      }
      return {} as any;
    });

    const result = await waitForActivity("com.example.testapp", ".Main", {
      timeout: 5000,
      interval: 50,
    });
    expect(result).toBe(true);
  });
});
