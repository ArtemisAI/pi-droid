import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager } from "../../src/plugins/loader.js";
import { registerPluginType } from "../../src/plugins/loader.js";
import type { PiDroidPlugin, PluginCapability, PluginStatus, PluginActionResult } from "../../src/plugins/interface.js";

/** Minimal mock plugin for testing. */
function createMockPlugin(name: string, displayName?: string): PiDroidPlugin {
  return {
    name,
    displayName: displayName ?? name,
    targetApps: [`com.test.${name}`],
    initialize: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn<() => PluginCapability[]>().mockReturnValue([
      {
        name: `${name}.action`,
        description: `Test action for ${name}`,
        requiresApproval: false,
      },
    ]),
    getStatus: vi.fn<() => Promise<PluginStatus>>().mockResolvedValue({
      ready: true,
      message: "OK",
    }),
    execute: vi.fn<(action: string, params: Record<string, unknown>) => Promise<PluginActionResult>>().mockResolvedValue({
      success: true,
    }),
    onHeartbeat: vi.fn().mockResolvedValue(null),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PluginManager.register()", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it("registers a plugin and makes it retrievable", async () => {
    const plugin = createMockPlugin("alpha");
    await manager.register(plugin, {});

    expect(manager.has("alpha")).toBe(true);
    expect(manager.get("alpha")).toBe(plugin);
    expect(plugin.initialize).toHaveBeenCalledWith({});
  });

  it("throws on duplicate registration", async () => {
    const p1 = createMockPlugin("beta");
    const p2 = createMockPlugin("beta");
    await manager.register(p1, {});
    await expect(manager.register(p2, {})).rejects.toThrow('Plugin "beta" is already registered');
  });

  it("lists all registered plugins", async () => {
    await manager.register(createMockPlugin("a"), {});
    await manager.register(createMockPlugin("b"), {});
    expect(manager.getAll()).toHaveLength(2);
  });

  it("enforces capability namespace isolation", async () => {
    const plugin = createMockPlugin("bad");
    vi.mocked(plugin.getCapabilities).mockReturnValue([
      { name: "other.action", description: "bad", requiresApproval: false },
    ]);
    await expect(manager.register(plugin, {})).rejects.toThrow(
      'Plugin "bad" capability "other.action" must be namespaced as "bad.*"',
    );
  });

});

describe("PluginManager.loadByName()", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it("loads a registered plugin type by name", async () => {
    const mockPlugin = createMockPlugin("test-plugin", "Test Plugin");
    registerPluginType("test-plugin", () => mockPlugin);

    const loaded = await manager.loadByName("test-plugin", { key: "value" });
    expect(loaded).toBe(mockPlugin);
    expect(mockPlugin.initialize).toHaveBeenCalledWith({ key: "value" });
    expect(manager.has("test-plugin")).toBe(true);
  });

  it("throws for unregistered plugin type", async () => {
    await expect(manager.loadByName("nonexistent", {})).rejects.toThrow(
      'Unknown plugin type "nonexistent"',
    );
  });
});

describe("PluginManager.getSkills()", () => {
  it("returns skill definitions for all loaded plugins", async () => {
    const manager = new PluginManager();
    await manager.register(createMockPlugin("foo", "Foo Plugin"), {});
    await manager.register(createMockPlugin("bar", "Bar Plugin"), {});

    const skills = manager.getSkills();
    expect(skills).toHaveLength(2);

    expect(skills[0].name).toBe("foo");
    expect(skills[0].displayName).toBe("Foo Plugin");
    expect(skills[0].targetApps).toEqual(["com.test.foo"]);
    expect(skills[0].capabilities).toHaveLength(1);
    expect(skills[0].capabilities[0].name).toBe("foo.action");

    expect(skills[1].name).toBe("bar");
  });

  it("returns empty array when no plugins loaded", () => {
    const manager = new PluginManager();
    expect(manager.getSkills()).toEqual([]);
  });
});

describe("PluginManager.destroyAll()", () => {
  it("calls destroy on all plugins and clears the registry", async () => {
    const manager = new PluginManager();
    const p1 = createMockPlugin("x");
    const p2 = createMockPlugin("y");
    await manager.register(p1, {});
    await manager.register(p2, {});

    await manager.destroyAll();
    expect(p1.destroy).toHaveBeenCalled();
    expect(p2.destroy).toHaveBeenCalled();
    expect(manager.getAll()).toHaveLength(0);
  });
});
