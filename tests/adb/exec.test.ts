import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { adb, listDevices, getScreenSize, AdbError } from "../../src/adb/exec.js";

const mockExecFile = vi.mocked(execFile);

/**
 * Helper: make mockExecFile resolve with given stdout.
 */
function mockStdout(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    // promisify(execFile) calls execFile with a callback
    const cb = typeof _opts === "function" ? _opts : callback;
    if (cb) {
      cb(null, { stdout, stderr: "" });
    }
    return {} as any;
  });
}

function mockError(stderr: string, code: number) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    const err: any = new Error("command failed");
    err.stderr = stderr;
    err.code = code;
    if (cb) cb(err);
    return {} as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adb()", () => {
  it("builds correct argument array without serial", async () => {
    mockStdout("ok");
    await adb(["devices"]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["devices"],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it("prepends -s serial when serial is provided", async () => {
    mockStdout("ok");
    await adb(["shell", "wm size"], { serial: "ABC123" });
    expect(mockExecFile).toHaveBeenCalledWith(
      "adb",
      ["-s", "ABC123", "shell", "wm size"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("throws AdbError on failure", async () => {
    mockError("device not found", 1);
    await expect(adb(["shell", "ls"])).rejects.toThrow(AdbError);
  });
});

describe("listDevices()", () => {
  it("parses multi-device output from adb devices -l", async () => {
    mockStdout(
      [
        "List of devices attached",
        "ABC123           device usb:1-1 product:starqltechn model:SM_G9600 device:starqltechn transport_id:1",
        "192.168.1.50:5555 device product:sdk_phone transport_id:2",
      ].join("\n"),
    );

    const devices = await listDevices();
    expect(devices).toHaveLength(2);

    expect(devices[0].serial).toBe("ABC123");
    expect(devices[0].state).toBe("device");
    expect(devices[0].transport).toBe("usb");
    expect(devices[0].model).toBe("SM_G9600");

    expect(devices[1].serial).toBe("192.168.1.50:5555");
    expect(devices[1].transport).toBe("wifi");
  });

  it("returns empty array when no devices attached", async () => {
    mockStdout("List of devices attached");
    const devices = await listDevices();
    expect(devices).toHaveLength(0);
  });
});

describe("getScreenSize()", () => {
  it("parses Physical size output", async () => {
    mockStdout("Physical size: 1440x2960");
    const size = await getScreenSize({ serial: "ABC123" });
    expect(size).toEqual({ width: 1440, height: 2960 });
  });

  it("parses Override size when set", async () => {
    mockStdout("Physical size: 1440x2960\nOverride size: 1080x2220");
    const size = await getScreenSize();
    // Override size takes precedence — reflects what's actually displayed
    expect(size).toEqual({ width: 1080, height: 2220 });
  });

  it("throws when output is unparseable", async () => {
    mockStdout("no display");
    await expect(getScreenSize()).rejects.toThrow("Could not parse screen size");
  });
});
