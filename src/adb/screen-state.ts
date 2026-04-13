/**
 * Screen state detection — foreground activity, keyboard, orientation,
 * overlay detection, and activity stack inspection.
 *
 * Provides a comprehensive snapshot of what the device is currently
 * displaying, essential for reliable automation navigation.
 */

import { adbShell, getForegroundPackage, type AdbExecOptions } from "./exec.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ScreenState {
  /** Is the physical screen on? */
  screenOn: boolean;
  /** Is the lock screen showing? */
  locked: boolean;
  /** Foreground app package name */
  foregroundPackage: string;
  /** Foreground activity class name */
  foregroundActivity: string;
  /** Is a dialog/popup/overlay visible? */
  hasOverlay: boolean;
  /** Is the keyboard visible? */
  keyboardVisible: boolean;
  /** Screen orientation: portrait, landscape */
  orientation: "portrait" | "landscape";
  /** Current display density */
  density: number;
}

export interface ActivityInfo {
  packageName: string;
  activityName: string;
  taskId: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse package/activity from a dumpsys window line.
 * Handles both mCurrentFocus and mFocusedApp formats:
 *   mCurrentFocus=Window{abc u0 com.example/.MainActivity}
 *   mFocusedApp=AppWindowToken{... ActivityRecord{abc com.example/.MainActivity t42}}
 */
function parseFocusLine(line: string): { packageName: string; activityName: string } {
  // Match "package/activity" pattern anywhere in the line
  const match = line.match(/([a-zA-Z0-9_.]+)\/(\.?[a-zA-Z0-9_.$]+)/);
  if (match) {
    return { packageName: match[1], activityName: match[2] };
  }
  return { packageName: "unknown", activityName: "unknown" };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get a comprehensive snapshot of the current screen state.
 */
export async function getScreenState(options: AdbExecOptions = {}): Promise<ScreenState> {
  // Run multiple dumpsys commands in parallel for speed
  const [windowDump, inputMethodDump, displayDump, screenOnOutput, lockOutput] =
    await Promise.all([
      adbShell("dumpsys window", options),
      adbShell("dumpsys input_method | grep mInputShown", options).catch(() => ""),
      adbShell("dumpsys display | grep mCurrentOrientation", options).catch(() => ""),
      adbShell("dumpsys power | grep 'Display Power'", options).catch(() => ""),
      adbShell(
        "dumpsys window | grep 'mDreamingLockscreen\\|isStatusBarKeyguard\\|showing='",
        options,
      ).catch(() => ""),
    ]);

  // Screen on/off
  const screenOn = screenOnOutput.includes("state=ON");

  // Lock screen
  const locked =
    lockOutput.includes("mDreamingLockscreen=true") ||
    lockOutput.includes("isStatusBarKeyguard=true") ||
    lockOutput.includes("showing=true");

  // Foreground activity from mCurrentFocus
  let foregroundPackage = "unknown";
  let foregroundActivity = "unknown";
  const focusLine = windowDump
    .split("\n")
    .find((l) => l.includes("mCurrentFocus"));
  if (focusLine) {
    const parsed = parseFocusLine(focusLine);
    foregroundPackage = parsed.packageName;
    foregroundActivity = parsed.activityName;
  }

  // Overlay / popup detection — mCurrentFocus differs from mFocusedApp
  let hasOverlay = false;
  const focusedAppLine = windowDump
    .split("\n")
    .find((l) => l.includes("mFocusedApp"));
  if (focusLine && focusedAppLine) {
    const currentParsed = parseFocusLine(focusLine);
    const focusedParsed = parseFocusLine(focusedAppLine);
    // If current focus window doesn't match the focused app, there's an overlay
    hasOverlay = currentParsed.packageName !== focusedParsed.packageName;
  }

  // Keyboard visibility
  const keyboardVisible = inputMethodDump.includes("mInputShown=true");

  // Orientation
  let orientation: "portrait" | "landscape" = "portrait";
  const orientMatch = displayDump.match(/mCurrentOrientation=(\d)/);
  if (orientMatch) {
    const val = parseInt(orientMatch[1]);
    orientation = val === 1 || val === 3 ? "landscape" : "portrait";
  }

  // Density
  let density = 0;
  const densityLine = windowDump
    .split("\n")
    .find((l) => l.includes("mBaseDisplayDensity") || l.includes("DisplayInfo{"));
  if (densityLine) {
    const densityMatch = densityLine.match(/density\s*(\d+)|mBaseDisplayDensity=(\d+)/);
    if (densityMatch) {
      density = parseInt(densityMatch[1] ?? densityMatch[2]);
    }
  }

  return {
    screenOn,
    locked,
    foregroundPackage,
    foregroundActivity,
    hasOverlay,
    keyboardVisible,
    orientation,
    density,
  };
}

/**
 * Get the current activity stack (back stack).
 */
export async function getActivityStack(options: AdbExecOptions = {}): Promise<ActivityInfo[]> {
  const output = await adbShell("dumpsys activity activities", options);
  const activities: ActivityInfo[] = [];

  // Parse lines like: "* TaskRecord{abc123 #42 A=com.example U=0 StackId=1 sz=2}"
  // Followed by: "* Hist #0: ActivityRecord{abc com.example/.MainActivity t42}"
  let currentTaskId = 0;

  for (const line of output.split("\n")) {
    // Extract task ID
    const taskMatch = line.match(/TaskRecord\{[^\s]+\s+#(\d+)/);
    if (taskMatch) {
      currentTaskId = parseInt(taskMatch[1]);
    }

    // Extract activity record
    const actMatch = line.match(
      /ActivityRecord\{[^\s]+\s+([a-zA-Z0-9_.]+)\/(\.?[a-zA-Z0-9_.]+)\s+t(\d+)/,
    );
    if (actMatch) {
      activities.push({
        packageName: actMatch[1],
        activityName: actMatch[2],
        taskId: parseInt(actMatch[3]),
      });
    }
  }

  return activities;
}

/**
 * Check if the soft keyboard is currently shown.
 */
export async function isKeyboardVisible(options: AdbExecOptions = {}): Promise<boolean> {
  try {
    const output = await adbShell("dumpsys input_method | grep mInputShown", options);
    return output.includes("mInputShown=true");
  } catch {
    return false;
  }
}

/**
 * Get screen orientation.
 */
export async function getOrientation(
  options: AdbExecOptions = {},
): Promise<"portrait" | "landscape"> {
  try {
    const output = await adbShell("dumpsys display | grep mCurrentOrientation", options);
    const match = output.match(/mCurrentOrientation=(\d)/);
    if (match) {
      const val = parseInt(match[1]);
      return val === 1 || val === 3 ? "landscape" : "portrait";
    }
  } catch {
    // fallback
  }

  // Fallback: use wm rotation
  try {
    const output = await adbShell("settings get system user_rotation", options);
    const val = parseInt(output.trim());
    return val === 1 || val === 3 ? "landscape" : "portrait";
  } catch {
    return "portrait";
  }
}

/**
 * Wait until a specific app/activity is in the foreground.
 *
 * @returns true if the target was found before timeout, false otherwise
 */
export async function waitForActivity(
  packageName: string,
  activityName?: string,
  options: AdbExecOptions & { timeout?: number; interval?: number } = {},
): Promise<boolean> {
  const timeout = options.timeout ?? 10_000;
  const interval = options.interval ?? 500;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const output = await adbShell("dumpsys window | grep mCurrentFocus", options);
      const match = output.match(/\{[^}]*\s+([a-zA-Z0-9_.]+)\/(\.?[a-zA-Z0-9_.$]+)\}/);

      if (match) {
        const currentPkg = match[1];
        const currentActivity = match[2];

        if (currentPkg === packageName) {
          if (!activityName || currentActivity === activityName
              || currentActivity.endsWith(`.${activityName}`)
              || currentActivity.endsWith(`$${activityName}`)) {
            return true;
          }
        }
      }
    } catch {
      // ADB call failed, retry
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}
