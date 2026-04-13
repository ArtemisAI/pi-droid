import { describe, it, expect, vi, beforeEach } from "vitest";

// Registry uses Device.connect() and listDevices() — mock those modules
vi.mock("../../src/adb/device.js", () => ({
  Device: {
    connect: vi.fn(),
  },
}));

vi.mock("../../src/adb/exec.js", () => ({
  listDevices: vi.fn(),
}));

import { Device } from "../../src/adb/device.js";
import { listDevices } from "../../src/adb/exec.js";
import { DeviceRegistry } from "../../src/adb/registry.js";

const mockDeviceConnect = vi.mocked(Device.connect);
const mockListDevices = vi.mocked(listDevices);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── register / unregister ─────────────────────────────────────────────

describe("register()", () => {
  it("adds a device and returns the entry", () => {
    const reg = new DeviceRegistry();
    const entry = reg.register("galaxy-s9", "45465050374a3098");
    expect(entry.alias).toBe("galaxy-s9");
    expect(entry.serial).toBe("45465050374a3098");
    expect(entry.device).toBeNull();
    expect(reg.size).toBe(1);
  });

  it("auto-sets first registered device as active", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    expect(reg.getActiveAlias()).toBe("phone-a");
  });

  it("does not change active when registering a second device", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    reg.register("phone-b", "BBB");
    expect(reg.getActiveAlias()).toBe("phone-a");
  });
});

describe("unregister()", () => {
  it("removes a device by alias", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    expect(reg.unregister("phone-a")).toBe(true);
    expect(reg.size).toBe(0);
  });

  it("returns false for unknown alias", () => {
    const reg = new DeviceRegistry();
    expect(reg.unregister("nope")).toBe(false);
  });

  it("switches active to next device when active is removed", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    reg.register("phone-b", "BBB");
    reg.unregister("phone-a");
    expect(reg.getActiveAlias()).toBe("phone-b");
  });

  it("sets active to null when last device is removed", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    reg.unregister("phone-a");
    expect(reg.getActiveAlias()).toBeNull();
  });
});

// ── setActive / getActive ─────────────────────────────────────────────

describe("setActive()", () => {
  it("switches the active device", () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    reg.register("phone-b", "BBB");
    reg.setActive("phone-b");
    expect(reg.getActiveAlias()).toBe("phone-b");
  });

  it("throws for unknown alias", () => {
    const reg = new DeviceRegistry();
    expect(() => reg.setActive("nope")).toThrow(/not registered/);
  });
});

describe("getActive()", () => {
  it("returns a Device instance for the active device", async () => {
    const fakeDevice = { serial: "AAA" } as any;
    mockDeviceConnect.mockResolvedValue(fakeDevice);

    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    const device = await reg.getActive();
    expect(device).toBe(fakeDevice);
    expect(mockDeviceConnect).toHaveBeenCalledWith("AAA");
  });

  it("throws when no device is registered", async () => {
    const reg = new DeviceRegistry();
    await expect(reg.getActive()).rejects.toThrow(/No active device/);
  });
});

// ── getByAlias ────────────────────────────────────────────────────────

describe("getByAlias()", () => {
  it("returns a Device instance by alias", async () => {
    const fakeDevice = { serial: "BBB" } as any;
    mockDeviceConnect.mockResolvedValue(fakeDevice);

    const reg = new DeviceRegistry();
    reg.register("phone-b", "BBB");
    const device = await reg.getByAlias("phone-b");
    expect(device).toBe(fakeDevice);
  });

  it("caches the Device instance on subsequent calls", async () => {
    const fakeDevice = { serial: "AAA" } as any;
    mockDeviceConnect.mockResolvedValue(fakeDevice);

    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    await reg.getByAlias("phone-a");
    await reg.getByAlias("phone-a");
    expect(mockDeviceConnect).toHaveBeenCalledTimes(1);
  });

  it("throws for unknown alias", async () => {
    const reg = new DeviceRegistry();
    await expect(reg.getByAlias("nope")).rejects.toThrow(/not registered/);
  });
});

// ── discover ──────────────────────────────────────────────────────────

describe("discover()", () => {
  it("auto-registers new devices from adb devices output", async () => {
    mockListDevices.mockResolvedValue([
      { serial: "ABC123", state: "device", model: "Pixel-7", transport: "usb" },
      { serial: "192.168.1.42:5555", state: "device", model: "Galaxy-S9", transport: "wifi" },
    ]);

    const reg = new DeviceRegistry();
    const newDevices = await reg.discover();
    expect(newDevices).toHaveLength(2);
    expect(reg.size).toBe(2);
    expect(reg.listAliases()).toContain("pixel-7");
    expect(reg.listAliases()).toContain("galaxy-s9");
  });

  it("skips devices not in 'device' state", async () => {
    mockListDevices.mockResolvedValue([
      { serial: "ABC123", state: "device", model: "Pixel-7", transport: "usb" },
      { serial: "DEF456", state: "offline", transport: "usb" },
    ]);

    const reg = new DeviceRegistry();
    const newDevices = await reg.discover();
    expect(newDevices).toHaveLength(1);
  });

  it("updates info for already-registered devices", async () => {
    mockListDevices.mockResolvedValue([
      { serial: "ABC123", state: "device", model: "Pixel-7", transport: "usb" },
    ]);

    const reg = new DeviceRegistry();
    reg.register("my-pixel", "ABC123");
    const newDevices = await reg.discover();
    expect(newDevices).toHaveLength(0); // No new devices
    expect(reg.get("my-pixel")?.info?.model).toBe("Pixel-7");
  });

  it("generates unique aliases for duplicate models", async () => {
    mockListDevices.mockResolvedValue([
      { serial: "AAA", state: "device", model: "Pixel-7", transport: "usb" },
      { serial: "BBB", state: "device", model: "Pixel-7", transport: "usb" },
    ]);

    const reg = new DeviceRegistry();
    await reg.discover();
    const aliases = reg.listAliases();
    expect(aliases).toContain("pixel-7");
    expect(aliases).toContain("pixel-7-2");
  });
});

// ── refresh ───────────────────────────────────────────────────────────

describe("refresh()", () => {
  it("marks reachable and unreachable devices", async () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");
    reg.register("phone-b", "BBB");

    mockListDevices.mockResolvedValue([
      { serial: "AAA", state: "device", model: "Phone-A", transport: "usb" },
      // BBB is missing — unreachable
    ]);

    const result = await reg.refresh();
    expect(result.reachable).toEqual(["phone-a"]);
    expect(result.unreachable).toEqual(["phone-b"]);
  });

  it("invalidates Device instance for unreachable devices", async () => {
    const fakeDevice = { serial: "BBB" } as any;
    mockDeviceConnect.mockResolvedValue(fakeDevice);

    const reg = new DeviceRegistry();
    reg.register("phone-b", "BBB");
    await reg.getByAlias("phone-b"); // Creates Device instance

    mockListDevices.mockResolvedValue([]); // No devices connected
    await reg.refresh();

    const entry = reg.get("phone-b");
    expect(entry?.device).toBeNull();
    expect(entry?.info).toBeNull();
  });

  it("updates info for reachable devices", async () => {
    const reg = new DeviceRegistry();
    reg.register("phone-a", "AAA");

    mockListDevices.mockResolvedValue([
      { serial: "AAA", state: "device", model: "Updated-Model", transport: "usb" },
    ]);

    await reg.refresh();
    expect(reg.get("phone-a")?.info?.model).toBe("Updated-Model");
  });
});

// ── listAliases / list / size ─────────────────────────────────────────

describe("list helpers", () => {
  it("listAliases returns all alias names", () => {
    const reg = new DeviceRegistry();
    reg.register("a", "AAA");
    reg.register("b", "BBB");
    expect(reg.listAliases()).toEqual(["a", "b"]);
  });

  it("list() returns all registered entries", () => {
    const reg = new DeviceRegistry();
    reg.register("a", "AAA");
    reg.register("b", "BBB");
    expect(reg.list()).toHaveLength(2);
  });

  it("size reflects the number of registered devices", () => {
    const reg = new DeviceRegistry();
    expect(reg.size).toBe(0);
    reg.register("a", "AAA");
    expect(reg.size).toBe(1);
  });
});
