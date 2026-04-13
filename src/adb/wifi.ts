/**
 * WiFi ADB — connect, disconnect, and auto-detect wireless devices.
 *
 * Enables wireless device automation: switch a USB-connected device to
 * WiFi mode, discover its IP, and connect over the network.
 */

import { adb, adbShell, listDevices, type AdbExecOptions } from "./exec.js";

const DEFAULT_PORT = 5555;

export interface WifiConnectResult {
  success: boolean;
  /** The host:port serial string (e.g., "192.168.1.42:5555") */
  serial: string;
  message: string;
}

/**
 * Connect to a device over WiFi via `adb connect`.
 */
export async function connectWifi(
  host: string,
  port: number = DEFAULT_PORT,
  options: AdbExecOptions = {},
): Promise<WifiConnectResult> {
  const target = `${host}:${port}`;
  const output = await adb(["connect", target], options);

  const success = output.includes("connected to") || output.includes("already connected");
  return { success, serial: target, message: output };
}

/**
 * Disconnect a WiFi-connected device via `adb disconnect`.
 *
 * If host is omitted, disconnects all WiFi devices.
 */
export async function disconnectWifi(
  host?: string,
  port: number = DEFAULT_PORT,
  options: AdbExecOptions = {},
): Promise<string> {
  if (host) {
    return adb(["disconnect", `${host}:${port}`], options);
  }
  return adb(["disconnect"], options);
}

/**
 * Enable WiFi ADB on a USB-connected device by switching to TCP/IP mode.
 *
 * The device must already be connected via USB. After this call the device
 * will listen on the given port for wireless ADB connections.
 */
export async function enableWifiAdb(
  options: AdbExecOptions & { port?: number } = {},
): Promise<string> {
  const port = options.port ?? DEFAULT_PORT;
  return adb(["tcpip", String(port)], options);
}

/**
 * Get the device's WiFi IP address from `wlan0`.
 *
 * Parses `ip addr show wlan0` and returns the first IPv4 address, or null
 * if the device is not connected to WiFi.
 */
export async function getWifiIp(options: AdbExecOptions = {}): Promise<string | null> {
  try {
    const output = await adbShell("ip addr show wlan0", options);
    const match = output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if a WiFi device is currently connected.
 *
 * Looks for a `host:port` entry with state "device" in the device list.
 */
export async function isWifiConnected(
  host: string,
  port: number = DEFAULT_PORT,
): Promise<boolean> {
  const target = `${host}:${port}`;
  const devices = await listDevices();
  return devices.some((d) => d.serial === target && d.state === "device");
}

/**
 * Convenience: enable WiFi ADB on a USB device, detect its IP, and connect.
 *
 * Returns the WiFi serial string (e.g., "192.168.1.42:5555") on success,
 * or throws if the IP cannot be determined or the connection fails.
 */
export async function autoConnect(
  options: AdbExecOptions & { port?: number } = {},
): Promise<string> {
  const port = options.port ?? DEFAULT_PORT;

  // Step 1: switch the USB device to TCP/IP mode
  await enableWifiAdb({ ...options, port });

  // Brief pause to let the device restart its adbd in TCP mode
  await new Promise((r) => setTimeout(r, 2000));

  // Step 2: discover the device's WiFi IP
  const ip = await getWifiIp(options);
  if (!ip) {
    throw new Error("Could not determine device WiFi IP — is WiFi enabled on the device?");
  }

  // Step 3: connect
  const result = await connectWifi(ip, port, options);
  if (!result.success) {
    throw new Error(`WiFi connect failed: ${result.message}`);
  }

  return result.serial;
}
