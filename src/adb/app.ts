/**
 * App lifecycle management — launch, stop, check state.
 */

import { adbShell, getForegroundPackage, type AdbExecOptions } from "./exec.js";
import type { AppInfo } from "./types.js";

/**
 * Launch an app by package name.
 */
export async function launchApp(
  packageName: string,
  options: AdbExecOptions & { activity?: string } = {},
): Promise<void> {
  if (options.activity) {
    await adbShell(`am start -n ${packageName}/${options.activity}`, options);
  } else {
    // Launch via monkey (finds main activity automatically)
    await adbShell(
      `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`,
      options,
    );
  }
}

/**
 * Force stop an app.
 */
export async function stopApp(
  packageName: string,
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell(`am force-stop ${packageName}`, options);
}

/**
 * Check if an app is running and in foreground.
 */
export async function getAppInfo(
  packageName: string,
  options: AdbExecOptions = {},
): Promise<AppInfo> {
  // Check if process exists
  let running = false;
  try {
    const ps = await adbShell(`pidof ${packageName}`, options);
    running = ps.trim().length > 0;
  } catch {
    running = false;
  }

  // Check if in foreground
  const fg = await getForegroundPackage(options);
  const foreground = fg === packageName;

  return { packageName, running, foreground };
}

/**
 * List installed packages matching a filter.
 */
export async function listPackages(
  filter?: string,
  options: AdbExecOptions = {},
): Promise<string[]> {
  const cmd = filter
    ? `pm list packages | grep -i ${filter}`
    : "pm list packages";
  try {
    const output = await adbShell(cmd, options);
    return output
      .split("\n")
      .map((l) => l.replace("package:", "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Keep the screen on (disable auto-sleep).
 */
export async function keepScreenOn(
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell("svc power stayon true", options);
}

/**
 * Restore default screen timeout behavior.
 */
export async function restoreScreenTimeout(
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell("svc power stayon false", options);
}

/**
 * Wake up the device screen.
 */
export async function wakeScreen(
  options: AdbExecOptions = {},
): Promise<void> {
  await adbShell("input keyevent KEYCODE_WAKEUP", options);
}

/**
 * Check if screen is on.
 */
export async function isScreenOn(
  options: AdbExecOptions = {},
): Promise<boolean> {
  const output = await adbShell("dumpsys power | grep 'Display Power'", options);
  return output.includes("state=ON");
}
