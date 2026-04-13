/**
 * Input actions: tap, swipe, type text, key events.
 *
 * Supports both coordinate-based and selector-based interactions.
 * Text input uses ADBKeyboard broadcast for Unicode support.
 */

import { adbShell, type AdbExecOptions } from "./exec.js";
import type { TapOptions, SwipeOptions, TypeOptions } from "./types.js";
import { invalidateCache } from "./cache.js";

/** Validate and round a coordinate value for ADB input commands. */
function validCoord(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid coordinate ${name}: ${value} (must be a non-negative finite number)`);
  }
  return Math.round(value);
}

/** Escape a value for safe use in an adb shell command argument. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Tap at screen coordinates.
 */
export async function tap(
  x: number,
  y: number,
  options: TapOptions & AdbExecOptions = {},
): Promise<void> {
  const rx = validCoord(x, "x");
  const ry = validCoord(y, "y");
  invalidateCache();
  if (options.duration && options.duration > 0) {
    await adbShell(`input swipe ${rx} ${ry} ${rx} ${ry} ${options.duration}`, options);
  } else {
    await adbShell(`input tap ${rx} ${ry}`, options);
  }
}

/**
 * Swipe from one point to another.
 */
export async function swipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: SwipeOptions & AdbExecOptions = {},
): Promise<void> {
  const rx1 = validCoord(x1, "x1");
  const ry1 = validCoord(y1, "y1");
  const rx2 = validCoord(x2, "x2");
  const ry2 = validCoord(y2, "y2");
  invalidateCache();
  const duration = options.duration ?? 300;
  await adbShell(`input swipe ${rx1} ${ry1} ${rx2} ${ry2} ${duration}`, options);
}

/**
 * Type text using ADBKeyboard (supports Unicode, spaces, special chars).
 *
 * Requires ADBKeyboard APK installed and set as default IME.
 * Falls back to `input text` for ASCII-only strings if useAdbKeyboard is false.
 */
export async function typeText(
  text: string,
  options: TypeOptions & AdbExecOptions = {},
): Promise<void> {
  invalidateCache();
  if (options.clear) {
    // Select all + delete
    await adbShell("input keyevent KEYCODE_MOVE_HOME", options);
    await adbShell("input keyevent --longpress $(printf 'KEYCODE_SHIFT_LEFT KEYCODE_MOVE_END')", options);
    await adbShell("input keyevent KEYCODE_DEL", options);
  }

  if (options.useAdbKeyboard !== false) {
    // Base64 encode for ADBKeyboard broadcast
    const encoded = Buffer.from(text, "utf-8").toString("base64");
    await adbShell(`am broadcast -a ADB_INPUT_B64 --es msg '${encoded}'`, options);
  } else {
    // Fallback: single-quote escape for shell safety (ASCII only)
    const escaped = shellEscape(text);
    await adbShell(`input text ${escaped}`, options);
  }
}

/**
 * Send a key event.
 */
export async function keyEvent(
  keycode: string | number,
  options: AdbExecOptions = {},
): Promise<void> {
  invalidateCache();
  await adbShell(`input keyevent ${keycode}`, options);
}

/**
 * Press the back button.
 */
export async function pressBack(options: AdbExecOptions = {}): Promise<void> {
  await keyEvent("KEYCODE_BACK", options);
}

/**
 * Press the home button.
 */
export async function pressHome(options: AdbExecOptions = {}): Promise<void> {
  await keyEvent("KEYCODE_HOME", options);
}

/**
 * Press enter/return.
 */
export async function pressEnter(options: AdbExecOptions = {}): Promise<void> {
  await keyEvent("KEYCODE_ENTER", options);
}

/** Common scroll gesture — scroll down on center of screen */
export async function scrollDown(
  screenWidth: number,
  screenHeight: number,
  options: SwipeOptions & AdbExecOptions = {},
): Promise<void> {
  const cx = Math.round(screenWidth / 2);
  const fromY = Math.round(screenHeight * 0.7);
  const toY = Math.round(screenHeight * 0.3);
  await swipe(cx, fromY, cx, toY, { duration: 400, ...options });
}

/** Common scroll gesture — scroll up on center of screen */
export async function scrollUp(
  screenWidth: number,
  screenHeight: number,
  options: SwipeOptions & AdbExecOptions = {},
): Promise<void> {
  const cx = Math.round(screenWidth / 2);
  const fromY = Math.round(screenHeight * 0.3);
  const toY = Math.round(screenHeight * 0.7);
  await swipe(cx, fromY, cx, toY, { duration: 400, ...options });
}
