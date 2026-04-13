/**
 * APK installation and package management — install, uninstall, query.
 */

import { adb, adbShell, type AdbExecOptions } from "./exec.js";

export interface InstallResult {
  success: boolean;
  package?: string;
  message: string;
}

export interface UninstallResult {
  success: boolean;
  message: string;
}

export interface PackageVersion {
  versionName: string;
  versionCode: number;
}

/**
 * Install an APK file onto the device.
 *
 * Uses `adb install` (not shell) since install is a host-side command.
 */
export async function installApk(
  apkPath: string,
  options: AdbExecOptions & { replace?: boolean; downgrade?: boolean } = {},
): Promise<InstallResult> {
  const { replace = true, downgrade, ...execOpts } = options;

  const args: string[] = ["install"];
  if (replace) args.push("-r");
  if (downgrade) args.push("-d");
  args.push(apkPath);

  try {
    const output = await adb(args, execOpts);
    const success = output.includes("Success");
    // Try to extract package name from output (some adb versions include it)
    const pkgMatch = output.match(/pkg:\s*(\S+)/);
    return {
      success,
      package: pkgMatch?.[1],
      message: output,
    };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      message: error.message ?? "Install failed",
    };
  }
}

/**
 * Uninstall a package from the device.
 */
export async function uninstallPackage(
  packageName: string,
  options: AdbExecOptions & { keepData?: boolean } = {},
): Promise<UninstallResult> {
  const { keepData, ...execOpts } = options;

  const args: string[] = ["uninstall"];
  if (keepData) args.push("-k");
  args.push(packageName);

  try {
    const output = await adb(args, execOpts);
    const success = output.includes("Success");
    return { success, message: output };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      message: error.message ?? "Uninstall failed",
    };
  }
}

/**
 * Get the installed version of a package.
 *
 * Returns null if the package is not installed.
 */
export async function getPackageVersion(
  packageName: string,
  options: AdbExecOptions = {},
): Promise<PackageVersion | null> {
  try {
    const output = await adbShell(`dumpsys package ${packageName}`, options);

    const nameMatch = output.match(/versionName=(\S+)/);
    const codeMatch = output.match(/versionCode=(\d+)/);

    if (!nameMatch) return null;

    return {
      versionName: nameMatch[1],
      versionCode: codeMatch ? parseInt(codeMatch[1], 10) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Quick check whether a package is installed on the device.
 */
export async function isPackageInstalled(
  packageName: string,
  options: AdbExecOptions = {},
): Promise<boolean> {
  try {
    const output = await adbShell(`pm list packages ${packageName}`, options);
    // pm list packages may return partial matches; check for exact match
    return output
      .split("\n")
      .some((line) => line.trim() === `package:${packageName}`);
  } catch {
    return false;
  }
}

/**
 * Get the on-device path of an installed APK.
 *
 * Returns null if the package is not installed.
 */
export async function getApkPath(
  packageName: string,
  options: AdbExecOptions = {},
): Promise<string | null> {
  try {
    const output = await adbShell(`pm path ${packageName}`, options);
    const match = output.match(/^package:(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
