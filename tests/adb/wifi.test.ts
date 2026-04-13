import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
  connectWifi,
  disconnectWifi,
  enableWifiAdb,
  getWifiIp,
  isWifiConnected,
} from "../../src/adb/wifi.js";

const mockExecFile = vi.mocked(execFile);

let callResponses: string[];
let callIndex: number;

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
});

// ── connectWifi ───────────────────────────────────────────────────────

describe("connectWifi()", () => {
  it("returns success when device connects", async () => {
    mockStdout("connected to 192.168.1.42:5555");
    const result = await connectWifi("192.168.1.42");
    expect(result.success).toBe(true);
    expect(result.serial).toBe("192.168.1.42:5555");
    expect(result.message).toContain("connected to");
  });

  it("returns success for already connected device", async () => {
    mockStdout("already connected to 192.168.1.42:5555");
    const result = await connectWifi("192.168.1.42");
    expect(result.success).toBe(true);
  });

  it("returns failure when connection fails", async () => {
    mockStdout("failed to connect to 192.168.1.42:5555");
    const result = await connectWifi("192.168.1.42");
    expect(result.success).toBe(false);
  });

  it("uses custom port", async () => {
    mockStdout("connected to 192.168.1.42:5556");
    const result = await connectWifi("192.168.1.42", 5556);
    expect(result.serial).toBe("192.168.1.42:5556");
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["connect", "192.168.1.42:5556"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ── disconnectWifi ────────────────────────────────────────────────────

describe("disconnectWifi()", () => {
  it("disconnects a specific host", async () => {
    mockStdout("disconnected 192.168.1.42:5555");
    await disconnectWifi("192.168.1.42");
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["disconnect", "192.168.1.42:5555"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("disconnects all when no host given", async () => {
    mockStdout("disconnected everything");
    await disconnectWifi();
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["disconnect"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ── enableWifiAdb ─────────────────────────────────────────────────────

describe("enableWifiAdb()", () => {
  it("switches device to tcpip mode on default port", async () => {
    mockStdout("restarting in TCP mode port: 5555");
    await enableWifiAdb();
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["tcpip", "5555"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("uses custom port", async () => {
    mockStdout("restarting in TCP mode port: 5556");
    await enableWifiAdb({ port: 5556 });
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["tcpip", "5556"],
      expect.anything(),
      expect.any(Function),
    );
  });
});

// ── getWifiIp ─────────────────────────────────────────────────────────

describe("getWifiIp()", () => {
  it("parses IP from ip addr show wlan0 output", async () => {
    mockStdout(
      [
        "4: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP>",
        "    link/ether aa:bb:cc:dd:ee:ff brd ff:ff:ff:ff:ff:ff",
        "    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0",
        "       valid_lft forever preferred_lft forever",
      ].join("\n"),
    );
    expect(await getWifiIp()).toBe("192.168.1.42");
  });

  it("returns null when no IP found", async () => {
    mockStdout("4: wlan0: <NO-CARRIER,BROADCAST,MULTICAST,UP>");
    expect(await getWifiIp()).toBeNull();
  });

  it("returns null on ADB error", async () => {
    mockError("device not found");
    expect(await getWifiIp()).toBeNull();
  });
});

// ── isWifiConnected ───────────────────────────────────────────────────

describe("isWifiConnected()", () => {
  it("returns true when the device is connected over wifi", async () => {
    // listDevices is called internally via adb(["devices", "-l"])
    // The output format: header line + device lines
    mockStdout(
      [
        "List of devices attached",
        "192.168.1.42:5555  device product:star2lte model:SM_G965F transport_id:3",
      ].join("\n"),
    );
    expect(await isWifiConnected("192.168.1.42")).toBe(true);
  });

  it("returns false when the device is not in the list", async () => {
    mockStdout(
      [
        "List of devices attached",
        "45465050374a3098  device product:starlte model:SM_G960F transport_id:1",
      ].join("\n"),
    );
    expect(await isWifiConnected("192.168.1.42")).toBe(false);
  });

  it("returns false when device is offline", async () => {
    mockStdout(
      [
        "List of devices attached",
        "192.168.1.42:5555  offline",
      ].join("\n"),
    );
    expect(await isWifiConnected("192.168.1.42")).toBe(false);
  });
});

// ── Error handling ────────────────────────────────────────────────────

describe("error handling", () => {
  it("connectWifi throws on ADB error", async () => {
    mockError("cannot resolve host");
    await expect(connectWifi("bad-host")).rejects.toThrow();
  });

  it("disconnectWifi throws on ADB error", async () => {
    mockError("adb server not running");
    await expect(disconnectWifi("192.168.1.42")).rejects.toThrow();
  });
});
