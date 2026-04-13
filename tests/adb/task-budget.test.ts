import { describe, it, expect, vi } from "vitest";
import { createTaskBudget, DEFAULT_TASK_BUDGET } from "../../src/adb/task-budget.js";

describe("TaskBudgetTracker", () => {
  it("uses default limits", () => {
    const budget = createTaskBudget();
    const report = budget.report();

    expect(report.stepLimit).toBe(DEFAULT_TASK_BUDGET.stepLimit);
    expect(report.timeLimit).toBe(DEFAULT_TASK_BUDGET.timeLimitMs);
  });

  it("tracks steps and marks exceeded at limit", () => {
    const budget = createTaskBudget({ stepLimit: 2, timeLimitMs: 60_000 });
    expect(budget.exceeded()).toBe(false);

    budget.tick();
    expect(budget.exceeded()).toBe(false);

    budget.tick();
    expect(budget.exceeded()).toBe(true);
    expect(budget.report().stepsUsed).toBe(2);
  });

  it("marks exceeded when time limit is reached", () => {
    vi.useFakeTimers();
    try {
      const budget = createTaskBudget({ stepLimit: 50, timeLimitMs: 1000 });
      vi.advanceTimersByTime(1000);
      expect(budget.exceeded()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

