/**
 * SKILL.md auto-generation for plugins.
 *
 * Inspired by CLI-Anything's SKILL.md pattern. Each plugin can generate
 * a machine-readable skill definition that agents use to discover
 * capabilities without hardcoding knowledge.
 */

import type { PiDroidPlugin, PluginCapability } from "./interface.js";

export interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  targetApps: string[];
  capabilities: PluginCapability[];
  examples: SkillExample[];
}

export interface SkillExample {
  description: string;
  action: string;
  params: Record<string, unknown>;
  expectedOutcome: string;
}

/**
 * Generate a SKILL.md string from a plugin's capabilities.
 */
export function generateSkillMd(plugin: PiDroidPlugin, examples?: SkillExample[]): string {
  const caps = plugin.getCapabilities();
  const lines: string[] = [
    `# ${plugin.displayName}`,
    "",
    `Plugin: \`${plugin.name}\``,
    `Target apps: ${plugin.targetApps.join(", ")}`,
    "",
    "## Capabilities",
    "",
  ];

  for (const cap of caps) {
    const approval = cap.requiresApproval ? " ⚠️ requires approval" : "";
    lines.push(`### ${cap.name}${approval}`);
    lines.push("");
    lines.push(cap.description);
    if (cap.parameters && Object.keys(cap.parameters).length > 0) {
      lines.push("");
      lines.push("**Parameters:**");
      for (const [key, type] of Object.entries(cap.parameters)) {
        lines.push(`- \`${key}\`: ${type}`);
      }
    }
    lines.push("");
  }

  if (examples && examples.length > 0) {
    lines.push("## Examples");
    lines.push("");
    for (const ex of examples) {
      lines.push(`### ${ex.description}`);
      lines.push("```json");
      lines.push(JSON.stringify({ action: ex.action, params: ex.params }, null, 2));
      lines.push("```");
      lines.push(`Expected: ${ex.expectedOutcome}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate a structured JSON skill definition (for programmatic consumption).
 */
export function generateSkillJson(plugin: PiDroidPlugin, examples?: SkillExample[]): SkillDefinition {
  return {
    name: plugin.name,
    displayName: plugin.displayName,
    description: `${plugin.displayName} automation plugin targeting ${plugin.targetApps.join(", ")}`,
    targetApps: plugin.targetApps,
    capabilities: plugin.getCapabilities(),
    examples: examples ?? [],
  };
}

/**
 * Generate a combined skill document for all loaded plugins.
 */
export function generateAllSkills(
  plugins: PiDroidPlugin[],
  examplesMap?: Map<string, SkillExample[]>,
): string {
  const sections = plugins.map((p) => {
    const examples = examplesMap?.get(p.name);
    return generateSkillMd(p, examples);
  });

  return [
    "# Pi-Droid Skills",
    "",
    `${plugins.length} plugin(s) loaded.`,
    "",
    "---",
    "",
    sections.join("\n---\n\n"),
  ].join("\n");
}
