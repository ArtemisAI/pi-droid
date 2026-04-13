import { randomUUID } from "node:crypto";
import type { ApprovalRequest, ApprovalResult } from "./interface.js";

interface PendingApproval {
  request: ApprovalRequest;
  expiresAt: number;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();

  enqueue(request: ApprovalRequest, defaultTimeoutMinutes: number): string {
    const id = request.id ?? randomUUID();
    const timeoutMinutes = request.timeoutMinutes ?? defaultTimeoutMinutes;
    const expiresAt = Date.now() + timeoutMinutes * 60_000;
    this.pending.set(id, { request: { ...request, id }, expiresAt });
    return id;
  }

  resolve(id: string, decision: "approve" | "deny"): ApprovalResult | null {
    const item = this.pending.get(id);
    if (!item) return null;
    this.pending.delete(id);
    return {
      id,
      decision,
      source: "channel_callback",
      metadata: item.request.metadata,
    };
  }

  expire(now = Date.now()): ApprovalResult[] {
    const expired: ApprovalResult[] = [];
    for (const [id, item] of this.pending.entries()) {
      if (item.expiresAt > now) continue;
      this.pending.delete(id);
      expired.push({
        id,
        decision: "timeout",
        source: "timeout",
        metadata: item.request.metadata,
      });
    }
    return expired;
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}
