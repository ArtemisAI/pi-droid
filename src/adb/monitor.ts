/**
 * Device state monitoring — battery, network, storage, screen lock, running apps.
 *
 * Parses ADB dumpsys / getprop output into structured data for
 * autonomous health checks and decision-making.
 */

import { adbShell, type AdbExecOptions } from "./exec.js";
import type { BatteryInfo, NetworkInfo, FullDeviceInfo } from "./types.js";

/**
 * Get battery level, charging status, and temperature.
 */
export async function getBatteryInfo(
  options: AdbExecOptions = {},
): Promise<BatteryInfo> {
  const output = await adbShell("dumpsys battery", options);

  const getInt = (key: string): number => {
    const match = output.match(new RegExp(`${key}:\\s*(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  };

  const getString = (key: string): string => {
    const match = output.match(new RegExp(`${key}:\\s*(\\S+)`));
    return match ? match[1] : "unknown";
  };

  const statusCode = getInt("status");
  const statusMap: Record<number, string> = {
    1: "unknown",
    2: "charging",
    3: "discharging",
    4: "not charging",
    5: "full",
  };

  return {
    level: getInt("level"),
    status: statusMap[statusCode] ?? "unknown",
    charging: statusCode === 2 || statusCode === 5,
    temperature: getInt("temperature") / 10, // reported in tenths of °C
  };
}

/**
 * Get network connectivity state (WiFi, cellular, airplane mode).
 */
export async function getNetworkInfo(
  options: AdbExecOptions = {},
): Promise<NetworkInfo> {
  // Check airplane mode
  let airplaneMode = false;
  try {
    const airplane = await adbShell(
      "settings get global airplane_mode_on",
      options,
    );
    airplaneMode = airplane.trim() === "1";
  } catch {
    airplaneMode = false;
  }

  // Check WiFi state and SSID
  let wifi = false;
  let wifiSsid: string | undefined;
  try {
    const wifiOutput = await adbShell("dumpsys wifi | grep 'Wi-Fi is'", options);
    wifi = wifiOutput.includes("enabled");

    if (wifi) {
      const ssidOutput = await adbShell(
        "dumpsys wifi | grep 'mWifiInfo'",
        options,
      );
      const ssidMatch = ssidOutput.match(/SSID:\s*"?([^",]+)"?/);
      if (ssidMatch && ssidMatch[1] !== "<none>") {
        wifiSsid = ssidMatch[1];
      }
    }
  } catch {
    wifi = false;
  }

  // Check cellular connectivity
  let cellular = false;
  try {
    const cellOutput = await adbShell(
      "dumpsys telephony.registry | grep -i 'mDataConnectionState'",
      options,
    );
    // State 2 = connected
    cellular = cellOutput.includes("2");
  } catch {
    cellular = false;
  }

  return { wifi, wifiSsid, cellular, airplaneMode };
}

/**
 * Get device hardware and software info.
 */
export async function getDeviceInfo(
  options: AdbExecOptions = {},
): Promise<FullDeviceInfo> {
  const getProp = async (prop: string): Promise<string> => {
    try {
      const val = await adbShell(`getprop ${prop}`, options);
      return val.trim();
    } catch {
      return "unknown";
    }
  };

  const [model, manufacturer, androidVersion, sdkVersion, serial] =
    await Promise.all([
      getProp("ro.product.model"),
      getProp("ro.product.manufacturer"),
      getProp("ro.build.version.release"),
      getProp("ro.build.version.sdk"),
      getProp("ro.serialno"),
    ]);

  return {
    model,
    manufacturer,
    androidVersion,
    sdkVersion: parseInt(sdkVersion) || 0,
    serial,
  };
}

/**
 * Check if the device screen is locked.
 */
export async function isScreenLocked(
  options: AdbExecOptions = {},
): Promise<boolean> {
  const output = await adbShell(
    "dumpsys window | grep 'mDreamingLockscreen\\|isStatusBarKeyguard\\|showing='",
    options,
  );
  // mDreamingLockscreen=true or showing=true indicates lock screen
  return (
    output.includes("mDreamingLockscreen=true") ||
    output.includes("isStatusBarKeyguard=true") ||
    output.includes("showing=true")
  );
}

/**
 * List running app processes (user-facing apps, not system daemons).
 */
export async function getRunningApps(
  options: AdbExecOptions = {},
): Promise<string[]> {
  try {
    const output = await adbShell(
      "ps -A -o NAME | grep -E '^com\\.' ",
      options,
    );
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // Fallback: some Android versions need different ps flags
    try {
      const output = await adbShell(
        "ps | grep -E 'com\\.' | awk '{print $NF}'",
        options,
      );
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
