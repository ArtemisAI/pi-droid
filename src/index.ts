/**
 * Pi-Droid — pi-agent extension entry point.
 *
 * Android automation extension for pi-agent. Registers ADB tools,
 * app-specific plugins, and input routing.
 * Extends pi-agent's capabilities for Android device control.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager, registerPluginType } from "./plugins/loader.js";
import { TelegramPlugin } from "./plugins/telegram.js";
import { createInputRouter } from "./tools/router.js";
import { registerAndroidTools } from "./tools/android.js";
import { registerDeviceTools } from "./tools/device.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register built-in plugin types (cross-cutting infrastructure only).
// App-specific plugins are loaded dynamically via config
// with "package" field pointing to their npm package or local path.
registerPluginType("telegram", () => new TelegramPlugin());

async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const configPath = join(__dirname, "..", "config", "default.json");
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default function piDroid(pi: ExtensionAPI) {
  const plugins = new PluginManager();
  const inputRouter = createInputRouter(join(__dirname, ".."));
  let adbConfig: Record<string, unknown> = {};

  // Skills are discovered automatically by pi-agent's package manager
  // via the "pi.skills" field in package.json. No resources_discover
  // handler is needed when installed as a package (pi install).

  pi.on("session_start", async (_event, ctx) => {
    const config = await loadConfig();
    adbConfig = (config.adb ?? {}) as Record<string, unknown>;
    const pluginConfigs = (config.plugins ?? {}) as Record<string, Record<string, unknown>>;
    await inputRouter.configure((config.routing ?? {}) as Record<string, unknown>);

    // Register core ADB/device tools (always available)
    registerDeviceTools(pi, adbConfig);

    // Register plugin action tools
    registerAndroidTools(pi, plugins);

    // Auto-load all enabled plugins from config
    const loaded = await plugins.loadFromConfig(pluginConfigs);

    // Register skills discovery tool
    pi.registerTool({
      name: "android_skills",
      label: "Android Skills",
      description:
        "Discover available Android automation capabilities. Returns all loaded plugins " +
        "with their actions, parameters, and approval requirements.",
      parameters: Type.Object({
        format: Type.Optional(
          Type.Union([Type.Literal("json"), Type.Literal("markdown")], {
            description: "Output format (default: json)",
          }),
        ),
      }),
      async execute(_id, args) {
        const format = args.format ?? "json";
        if (format === "markdown") {
          return { content: [{ type: "text", text: plugins.getSkillsMd() }], details: {} };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(plugins.getSkills(), null, 2) }],
          details: {},
        };
      },
    });

    const toolCount = 36; // Core ADB + plugin + skills tools
    const pluginMsg = loaded.length > 0
      ? `${loaded.length} app adaptor(s): ${loaded.join(", ")}`
      : "no app adaptors";
    ctx.ui.notify(`Pi-Droid ready — ${toolCount} tools registered, ${pluginMsg}`, "info");
    ctx.ui.setStatus("pi-droid", loaded.length > 0 ? loaded.join(", ") : "ready");
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const serial = (adbConfig.serial as string | undefined) || process.env.ANDROID_SERIAL || undefined;
    const routed = await inputRouter.handleRoutedInput(event.text, { serial });
    if (!routed.handled) {
      return { action: "continue" };
    }
    if (routed.message) {
      pi.sendMessage(routed.message);
    }
    if (ctx.hasUI && routed.notification) {
      ctx.ui.notify(routed.notification.text, routed.notification.level);
    }
    return { action: "handled" };
  });

  // Graceful plugin shutdown
  pi.on("session_shutdown", async () => {
    await plugins.destroyAll();
  });

  // Update status after each turn
  pi.on("turn_end", async (_event, ctx) => {
    const statuses = await plugins.getStatuses();
    const parts: string[] = [];
    for (const [name, status] of Object.entries(statuses)) {
      parts.push(`${name}: ${status.ready ? "ready" : "offline"}`);
    }
    ctx.ui.setStatus("pi-droid", parts.join(" | ") || "ready");
  });

  // Commands
  pi.registerCommand("pidroid-status", {
    description: "Show pi-droid plugin status and health",
    handler: async (_args, ctx) => {
      const statuses = await plugins.getStatuses();
      const unhealthy = await plugins.healthCheck();
      ctx.ui.notify(
        JSON.stringify({ statuses, unhealthy: unhealthy.length > 0 ? unhealthy : "all healthy" }, null, 2),
        "info",
      );
    },
  });

  pi.registerCommand("pidroid-skills", {
    description: "Show all available plugin skills (markdown format)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(plugins.getSkillsMd(), "info");
    },
  });
}

// Re-export for external use
export { PluginManager, registerPluginType } from "./plugins/loader.js";
export type { PiDroidPlugin, PluginCapability, PluginStatus, PluginActionResult } from "./plugins/interface.js";
export type { PluginManifest } from "./plugins/manifest.js";
export { CliPlugin, type CliPluginConfig, type CommandMapping } from "./plugins/cli-plugin.js";
export { TelegramPlugin } from "./plugins/telegram.js";
export { TelegramChannel, type TelegramChannelConfig } from "./notifications/telegram.js";
export { ApprovalQueue } from "./notifications/approval-queue.js";
export type {
  NotificationChannel,
  ApprovalRequest,
  ApprovalResult,
  ParsedCommand,
  ManualOverrideCommand,
} from "./notifications/interface.js";
// ADB primitives — full public API for external plugins
export {
  // Device abstraction
  Device,
  // Command execution
  adb, adbShell, AdbError, listDevices, isDeviceReady,
  // Input
  tap, swipe, typeText, keyEvent, pressBack, pressHome, pressEnter, scrollDown, scrollUp,
  // Screen state
  getScreenState, waitForActivity, getActivityStack, isKeyboardVisible, getOrientation,
  // Screenshots & perception
  takeScreenshot, screenshotBase64, annotatedScreenshot,
  dumpUiTree, findElements, findElement, waitForElement,
  // App management
  launchApp, stopApp, getAppInfo, listPackages, wakeScreen, isScreenOn,
  // Monitoring
  getBatteryInfo, getNetworkInfo, getDeviceInfo, isScreenLocked, getRunningApps,
  // Automation helpers
  ensureReady, findAndTap, scrollToFind,
  // Stuck detection & budget
  DefaultStuckDetector, createTaskBudget,
  // OCR
  runOcrOnImage, runOcrOnCurrentScreen,
} from "./adb/index.js";
export type { AdbExecOptions } from "./adb/index.js";
export type { StuckEvent, UIElement, Bounds, ElementSelector } from "./adb/index.js";
