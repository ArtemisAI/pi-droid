/**
 * Device preflight / health check.
 *
 * Runs a series of checks to verify the device is ready for automation
 * and returns a structured result with pass/fail status and fix hints.
 */

import { adbShell, listDevices, type AdbExecOptions } from "./exec.js";
import { isScreenOn } from "./app.js";
import { getStorageInfo } from "./files.js";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  /** Hint on how to fix if the check failed. */
  fix?: string;
}

export interface PreflightResult {
  /** True when all critical checks passed. */
  ready: boolean;
  checks: PreflightCheck[];
  serial: string;
  timestamp: string;
}

const ADBKEYBOARD_PACKAGE = "com.android.adbkeyboard";
const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
const MIN_STORAGE_MB = 100;

/**
 * Run all preflight checks and return a structured result.
 */
export async function runPreflight(
  options?: { serial?: string },
): Promise<PreflightResult> {
  const serial = options?.serial ?? "";
  const execOpts: AdbExecOptions = serial ? { serial } : {};
  const checks: PreflightCheck[] = [];

  // 1. ADB connectivity
  const connectivity = await checkAdbConnectivity(serial);
  checks.push(connectivity);

  // 2. USB debugging authorized (derived from connectivity check's device list)
  const authorized = await checkUsbAuthorized(serial);
  checks.push(authorized);

  // If device is not reachable or unauthorized, remaining checks will fail.
  // Run them anyway to give a complete report, but wrap in try/catch.

  // 3. Screen state
  checks.push(await checkScreenOn(execOpts));

  // 4. ADBKeyboard installed
  checks.push(await checkAdbKeyboardInstalled(execOpts));

  // 5. ADBKeyboard active
  checks.push(await checkAdbKeyboardActive(execOpts));

  // 6. Storage available
  checks.push(await checkStorage(execOpts));

  const resolvedSerial = serial || (await resolveSerial());

  return {
    ready: checks.every((c) => c.passed),
    checks,
    serial: resolvedSerial,
    timestamp: new Date().toISOString(),
  };
}

// ── Individual checks ────────────────────────────────────────────────

async function checkAdbConnectivity(serial: string): Promise<PreflightCheck> {
  try {
    const devices = await listDevices();
    const found = serial
      ? devices.some((d) => d.serial === serial && d.state === "device")
      : devices.some((d) => d.state === "device");

    return {
      name: "adb-connectivity",
      passed: found,
      message: found ? "Device reachable via ADB" : "No reachable device found",
      ...(!found && {
        fix: "Connect device via USB, enable USB debugging, and run `adb devices` to verify.",
      }),
    };
  } catch {
    return {
      name: "adb-connectivity",
      passed: false,
      message: "ADB server not reachable",
      fix: "Ensure ADB is installed and run `adb start-server`.",
    };
  }
}

async function checkUsbAuthorized(serial: string): Promise<PreflightCheck> {
  try {
    const devices = await listDevices();
    const target = serial
      ? devices.find((d) => d.serial === serial)
      : devices[0];

    if (!target) {
      return {
        name: "usb-authorized",
        passed: false,
        message: "No device found to check authorization",
        fix: "Connect a device via USB.",
      };
    }

    const authorized = target.state === "device";
    return {
      name: "usb-authorized",
      passed: authorized,
      message: authorized
        ? "USB debugging authorized"
        : `Device state is "${target.state}"`,
      ...(!authorized && {
        fix: 'Accept the USB debugging prompt on the device, or run `adb kill-server && adb devices`.',
      }),
    };
  } catch {
    return {
      name: "usb-authorized",
      passed: false,
      message: "Could not check device authorization",
      fix: "Ensure ADB is running and device is connected.",
    };
  }
}

async function checkScreenOn(execOpts: AdbExecOptions): Promise<PreflightCheck> {
  try {
    const on = await isScreenOn(execOpts);
    return {
      name: "screen-on",
      passed: on,
      message: on ? "Screen is on" : "Screen is off",
      ...(!on && {
        fix: "Wake the device with `adb shell input keyevent KEYCODE_WAKEUP`.",
      }),
    };
  } catch {
    return {
      name: "screen-on",
      passed: false,
      message: "Could not check screen state",
      fix: "Ensure device is connected and responsive.",
    };
  }
}

async function checkAdbKeyboardInstalled(
  execOpts: AdbExecOptions,
): Promise<PreflightCheck> {
  try {
    const output = await adbShell("pm list packages", execOpts);
    const installed = output.split("\n").some(
      (line) => line.replace("package:", "").trim() === ADBKEYBOARD_PACKAGE,
    );

    return {
      name: "adbkeyboard-installed",
      passed: installed,
      message: installed
        ? "ADBKeyboard package is installed"
        : "ADBKeyboard package not found",
      ...(!installed && {
        fix: "Install ADBKeyboard: `adb install ADBKeyboard.apk` (download from https://github.com/nicholasnadel/ADBKeyBoard).",
      }),
    };
  } catch {
    return {
      name: "adbkeyboard-installed",
      passed: false,
      message: "Could not query installed packages",
      fix: "Ensure device is connected and responsive.",
    };
  }
}

async function checkAdbKeyboardActive(
  execOpts: AdbExecOptions,
): Promise<PreflightCheck> {
  try {
    const output = await adbShell(
      "settings get secure default_input_method",
      execOpts,
    );
    const active = output.trim() === ADBKEYBOARD_IME;

    return {
      name: "adbkeyboard-active",
      passed: active,
      message: active
        ? "ADBKeyboard is the active IME"
        : `Active IME is "${output.trim()}", expected ADBKeyboard`,
      ...(!active && {
        fix: `Set ADBKeyboard as default: \`adb shell ime set ${ADBKEYBOARD_IME}\`.`,
      }),
    };
  } catch {
    return {
      name: "adbkeyboard-active",
      passed: false,
      message: "Could not check active IME",
      fix: "Ensure device is connected and responsive.",
    };
  }
}

async function checkStorage(execOpts: AdbExecOptions): Promise<PreflightCheck> {
  try {
    const storageEntries = await getStorageInfo(execOpts);
    // Check /data partition (internal storage)
    const dataPartition = storageEntries.find(
      (s) => s.mountedOn === "/data" || s.mountedOn === "/data/media",
    );
    const target = dataPartition ?? storageEntries.find((s) => s.mountedOn === "/");

    if (!target) {
      return {
        name: "storage-available",
        passed: false,
        message: "Could not find /data or root partition in storage info",
        fix: "Check device storage manually with `adb shell df -h`.",
      };
    }

    const availableMb = parseStorageToMb(target.available);
    const passed = availableMb >= MIN_STORAGE_MB;

    return {
      name: "storage-available",
      passed,
      message: passed
        ? `${target.available} available on ${target.mountedOn}`
        : `Only ${target.available} available on ${target.mountedOn} (need ${MIN_STORAGE_MB}MB)`,
      ...(!passed && {
        fix: "Free up device storage by removing unused apps or files.",
      }),
    };
  } catch {
    return {
      name: "storage-available",
      passed: false,
      message: "Could not check storage",
      fix: "Ensure device is connected and responsive.",
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse a human-readable storage string (e.g., "1.2G", "500M", "128K") to MB.
 */
function parseStorageToMb(value: string): number {
  const match = value.match(/^([\d.]+)([KMGT]?)$/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case "K":
      return num / 1024;
    case "M":
      return num;
    case "G":
      return num * 1024;
    case "T":
      return num * 1024 * 1024;
    default:
      // Assume bytes
      return num / (1024 * 1024);
  }
}

/**
 * Resolve the serial of the first connected device.
 */
async function resolveSerial(): Promise<string> {
  try {
    const devices = await listDevices();
    const active = devices.find((d) => d.state === "device");
    return active?.serial ?? "unknown";
  } catch {
    return "unknown";
  }
}
