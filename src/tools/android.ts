/**
 * Android tool registrations for pi-mono.
 *
 * These tools are registered via pi.registerTool() and become callable by the LLM.
 * Each tool wraps a plugin action, adding approval gates where needed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { PluginManager } from "../plugins/loader.js";

export function registerAndroidTools(pi: ExtensionAPI, plugins: PluginManager): void {
  // Generic plugin action executor
  pi.registerTool({
    name: "android_plugin_action",
    label: "Android Plugin Action",
    description:
      "Execute an action on a loaded Android automation plugin. " +
      "Use 'android_plugin_status' first to see available plugins and their capabilities.",
    parameters: Type.Object({
      plugin: Type.String({ description: "Plugin name (e.g., 'weather')" }),
      action: Type.String({ description: "Action name (e.g., 'weather.fetch', 'myapp.login')" }),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Action parameters as key-value pairs",
        }),
      ),
    }),
    async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
      const plugin = plugins.get(args.plugin);
      if (!plugin) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Plugin "${args.plugin}" not found. Available: ${plugins.getAll().map((p) => p.name).join(", ")}` }) }],
          details: {},
        };
      }

      // Check if action requires approval
      const capability = plugin.getCapabilities().find((c) => c.name === args.action);
      if (capability?.requiresApproval) {
        const approved = await ctx.ui.confirm(
          "Approval Required",
          `Plugin "${plugin.displayName}" wants to execute: ${args.action}\n\nParams: ${JSON.stringify(args.params ?? {}, null, 2)}`,
        );
        if (!approved) {
          return {
            content: [{ type: "text", text: JSON.stringify({ blocked: true, reason: "User denied approval" }) }],
            details: {},
          };
        }
      }

      const result = await plugin.execute(args.action, args.params ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: {},
      };
    },
  });

  // Plugin status tool
  pi.registerTool({
    name: "android_plugin_status",
    label: "Android Plugin Status",
    description:
      "Get status of all loaded Android automation plugins, including capabilities, rate limits, and device state.",
    parameters: Type.Object({}),
    async execute() {
      const statuses = await plugins.getStatuses();
      const capabilities: Record<string, unknown> = {};
      for (const plugin of plugins.getAll()) {
        capabilities[plugin.name] = {
          displayName: plugin.displayName,
          targetApps: plugin.targetApps,
          capabilities: plugin.getCapabilities(),
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ statuses, capabilities }, null, 2),
          },
        ],
        details: {},
      };
    },
  });

  // Run plugin autonomous cycle
  pi.registerTool({
    name: "android_plugin_cycle",
    label: "Plugin Cycle",
    description:
      "Run the autonomous cycle on a plugin — the plugin decides what to do " +
      "(e.g., scrape data → evaluate → act). Useful for scheduled automation.",
    parameters: Type.Object({
      plugin: Type.String({ description: "Plugin name (e.g., 'weather')" }),
    }),
    async execute(_id, args) {
      const plugin = plugins.get(args.plugin);
      if (!plugin) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Plugin "${args.plugin}" not found` }) }],
          details: {},
        };
      }
      const result = await plugin.onHeartbeat();
      return {
        content: [{ type: "text", text: JSON.stringify(result ?? { skipped: true }, null, 2) }],
        details: {},
      };
    },
  });
}
