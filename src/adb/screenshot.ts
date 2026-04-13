/**
 * Screenshot capture — pull screenshots from device to local storage.
 */

import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { adb, adbShell, type AdbExecOptions } from "./exec.js";
import type { ScreenshotResult } from "./types.js";

const REMOTE_PATH = "/sdcard/pi-droid-screen.png";

let screenshotDir = "/tmp/pi-droid/screenshots";

export function setScreenshotDir(dir: string): void {
  screenshotDir = dir;
}

/**
 * Take a screenshot and pull it to local storage.
 */
export async function takeScreenshot(
  options: AdbExecOptions & { prefix?: string; includeBase64?: boolean } = {},
): Promise<ScreenshotResult> {
  if (!existsSync(screenshotDir)) {
    await mkdir(screenshotDir, { recursive: true });
  }

  // Capture on device
  await adbShell(`screencap -p ${REMOTE_PATH}`, options);

  // Pull to local
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = options.prefix ?? "screen";
  const localPath = join(screenshotDir, `${prefix}_${ts}.png`);
  await adb(["pull", REMOTE_PATH, localPath], options);

  // Get dimensions
  const sizeOutput = await adbShell("wm size", options);
  const match = sizeOutput.match(/(\d+)x(\d+)/);
  const width = match ? parseInt(match[1]) : 0;
  const height = match ? parseInt(match[2]) : 0;

  const result: ScreenshotResult = { path: localPath, width, height };

  if (options.includeBase64) {
    const data = await readFile(localPath);
    result.base64 = data.toString("base64");
  }

  return result;
}

/**
 * Take a screenshot and return base64 directly (no file save).
 */
export async function screenshotBase64(options: AdbExecOptions = {}): Promise<string> {
  await adbShell(`screencap -p ${REMOTE_PATH}`, options);

  // Pull to temp, read, return base64, then clean up
  const tmpPath = `/tmp/pi-droid-quick-${Date.now()}.png`;
  await adb(["pull", REMOTE_PATH, tmpPath], options);
  try {
    const data = await readFile(tmpPath);
    return data.toString("base64");
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
