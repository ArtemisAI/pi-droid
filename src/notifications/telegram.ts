import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ApprovalQueue } from "./approval-queue.js";
import type {
  ApprovalRequest,
  ApprovalResult,
  ManualOverrideCommand,
  NotificationChannel,
  ParsedCommand,
} from "./interface.js";

export interface TelegramChannelConfig {
  botToken: string;
  chatId: string;
  timeoutMinutes?: number;
  allowedCommands?: string[];
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
}

export class TelegramChannel implements NotificationChannel {
  private readonly token: string;
  private readonly chatId: string;
  private readonly defaultTimeoutMinutes: number;
  private readonly allowedCommands: Set<string>;
  private readonly approvals = new ApprovalQueue();
  private updateOffset = 0;

  constructor(config: TelegramChannelConfig) {
    this.token = config.botToken;
    this.chatId = config.chatId;
    this.defaultTimeoutMinutes = config.timeoutMinutes ?? 5;
    this.allowedCommands = new Set((config.allowedCommands ?? []).map((command) => command.toLowerCase()));
  }

  async sendMessage(text: string): Promise<void> {
    await this.callApi("sendMessage", { chat_id: this.chatId, text });
  }

  async sendSummary(summary: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(summary).map(([key, value]) => `${key}: ${String(value)}`);
    await this.sendMessage(
      [
        "📊 Daily summary",
        ...entries,
      ].join("\n"),
    );
  }

  async sendScreenshot(input: { photoPath: string; caption?: string }): Promise<void> {
    const bytes = await readFile(input.photoPath);
    const form = new FormData();
    form.set("chat_id", this.chatId);
    form.set("caption", input.caption ?? "Annotated screenshot");
    form.set("photo", new Blob([bytes]), basename(input.photoPath));
    await this.callApi("sendPhoto", form);
  }

  async requestApproval(request: ApprovalRequest): Promise<string> {
    const id = this.approvals.enqueue(request, this.defaultTimeoutMinutes);
    const scoreText = request.score !== undefined ? ` Score: ${request.score.toFixed(2)}` : "";
    await this.callApi("sendMessage", {
      chat_id: this.chatId,
      text: `${request.prompt}${scoreText}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${id}` },
            { text: "❌ Deny", callback_data: `deny:${id}` },
          ],
        ],
      },
    });
    return id;
  }

  async poll(): Promise<{ approvals: ApprovalResult[]; commands: ParsedCommand[] }> {
    const updates = await this.callApi("getUpdates", {
      offset: this.updateOffset,
      timeout: 0,
      allowed_updates: ["message", "callback_query"],
    });
    const rows = (updates.result ?? []) as TelegramUpdate[];
    const approvals: ApprovalResult[] = [];
    const commands: ParsedCommand[] = [];

    for (const row of rows) {
      this.updateOffset = Math.max(this.updateOffset, row.update_id + 1);
      const chatId = row.callback_query?.message?.chat?.id ?? row.message?.chat?.id;
      if (chatId === undefined || String(chatId) !== this.chatId) continue;

      const data = row.callback_query?.data;
      if (data) {
        const [action, id] = data.split(":");
        if ((action === "approve" || action === "deny") && id) {
          const result = this.approvals.resolve(id, action);
          if (result) {
            approvals.push(result);
            await this.callApi("answerCallbackQuery", {
              callback_query_id: row.callback_query?.id,
              text: `Marked as ${action}`,
            });
          }
        }
      }

      const text = row.message?.text?.trim();
      if (!text || !text.startsWith("/")) continue;
      const [rawCommand, ...args] = text.slice(1).split(/\s+/);
      const command = rawCommand.toLowerCase();
      if (this.allowedCommands.size > 0 && !this.allowedCommands.has(command)) continue;
      commands.push({
        command: command as ManualOverrideCommand,
        args,
        raw: text,
      });
    }

    const timedOut = this.approvals.expire();
    for (const item of timedOut) {
      approvals.push(item);
      await this.sendMessage(`⏱️ Approval ${item.id} timed out — auto-skip applied.`);
    }

    return { approvals, commands };
  }

  getPendingApprovals(): number {
    return this.approvals.getPendingCount();
  }

  private async callApi(method: string, payload: Record<string, unknown> | FormData): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
      headers: payload instanceof FormData ? undefined : { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
    }

    const data = await response.json() as { ok?: boolean; description?: string } & Record<string, unknown>;
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? "unknown error"}`);
    }
    return data;
  }
}
