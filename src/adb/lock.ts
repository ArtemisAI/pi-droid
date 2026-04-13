/**
 * Device lock pattern/PIN management.
 *
 * Wraps Android's `locksettings` CLI for clearing and setting
 * lock patterns and PINs. App-agnostic — works on any Android device.
 */

import { adbShell, type AdbExecOptions } from "./exec.js";

/** Escape a value for safe use in an adb shell command argument. */
function shellEscape(value: string): string {
  // Single-quote the value; escape any existing single quotes
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface LockStatus {
  hasPattern: boolean;
  hasPin: boolean;
  hasPassword: boolean;
  isSecure: boolean;
}

/**
 * Check current device lock status.
 */
export async function getLockStatus(options: AdbExecOptions = {}): Promise<LockStatus> {
  const disabled = await adbShell("locksettings get-disabled", options).catch(() => "");
  // locksettings get-disabled returns "true" if screen lock is disabled
  const isDisabled = disabled.trim().toLowerCase() === "true";

  if (isDisabled) {
    return { hasPattern: false, hasPin: false, hasPassword: false, isSecure: false };
  }

  // Check if a credential is set by trying to verify with empty — if the command
  // throws or returns error, a credential is set (empty not accepted).
  const verify = await adbShell("locksettings verify --old ''", options)
    .then((v) => v.includes("Lock credential verified successfully"))
    .catch(() => false);

  return {
    hasPattern: !verify,
    hasPin: false, // can't distinguish type without more info
    hasPassword: false,
    isSecure: !verify,
  };
}

/**
 * Clear the device lock pattern/PIN.
 * Requires the current pattern/PIN to clear it.
 */
export async function clearLock(
  currentCredential: string,
  options: AdbExecOptions = {},
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await adbShell(`locksettings clear --old ${shellEscape(currentCredential)}`, options);
    const success = !result.toLowerCase().includes("error") && !result.toLowerCase().includes("failed");
    return {
      success,
      message: success ? "Lock cleared" : `Failed: ${result.trim()}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Set a pattern lock on the device.
 * Pattern is a comma-separated string of dot indices (e.g., "1,2,5,8,9").
 * Dot layout: 0=top-left, 1=top-center, 2=top-right, ..., 8=bottom-right.
 */
export async function setPattern(
  pattern: string,
  options: AdbExecOptions = {},
): Promise<{ success: boolean; message: string }> {
  // Validate pattern: must be digits 0-8 separated by commas, at least 4 dots
  const dots = pattern.split(",");
  if (dots.length < 4 || !dots.every((d) => /^[0-8]$/.test(d.trim()))) {
    return {
      success: false,
      message: "Invalid pattern: must be at least 4 comma-separated digits (0-8)",
    };
  }
  try {
    const result = await adbShell(`locksettings set-pattern ${shellEscape(pattern)}`, options);
    const success = !result.toLowerCase().includes("error") && !result.toLowerCase().includes("failed");
    return {
      success,
      message: success ? "Pattern set" : `Failed: ${result.trim()}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Set a PIN lock on the device.
 */
export async function setPin(
  pin: string,
  options: AdbExecOptions = {},
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await adbShell(`locksettings set-pin ${shellEscape(pin)}`, options);
    const success = !result.toLowerCase().includes("error") && !result.toLowerCase().includes("failed");
    return {
      success,
      message: success ? "PIN set" : `Failed: ${result.trim()}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
