import cron, { type ScheduledTask } from "node-cron";
import {
  missingCapabilities,
  type ProviderRegistry,
  type SignalSkill,
  type SkillContext,
} from "@otterstreet/core";
import type { Store } from "./db.js";

export interface RunError {
  skill: string;
  ticker: string;
  message: string;
}

export interface RunSummary {
  /** Skills that were runnable (had their required capabilities). */
  skillsRun: number;
  /** Tickers on the watchlist at run time. */
  tickers: number;
  /** Signals produced by skills before dedupe. */
  generated: number;
  /** New signals actually stored. */
  stored: number;
  /** Signals dropped as duplicates of a recent identical signal. */
  deduped: number;
  errors: RunError[];
}

interface SkillRunResult {
  generated: number;
  stored: number;
  errors: RunError[];
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private running = new Set<string>();

  constructor(
    private readonly skills: SignalSkill[],
    private readonly providers: ProviderRegistry,
    private readonly store: Store,
  ) {}

  start(): void {
    for (const skill of this.skills) {
      const missing = missingCapabilities(this.providers, skill.requires);
      if (missing.length > 0) {
        console.warn(`[scheduler] skill "${skill.id}" disabled — missing capabilities: ${missing.join(", ")}`);
        continue;
      }
      this.tasks.push(cron.schedule(skill.schedule, () => void this.runScheduled(skill)));
      console.log(`[scheduler] skill "${skill.id}" scheduled (${skill.schedule})`);
    }
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }

  /**
   * Manually run runnable skills once.
   * @param opts.ticker  Limit to one ticker; omit to run the whole watchlist.
   * @param opts.dedupe  Default true. When false, every generated signal is
   *                     stored even if identical to a recent one — used by the
   *                     per-symbol "run fresh" action.
   */
  async runOnce(opts: { ticker?: string; dedupe?: boolean } = {}): Promise<RunSummary> {
    const dedupe = opts.dedupe ?? true;
    const symbols = opts.ticker ? [opts.ticker] : this.store.listSymbols();
    const summary: RunSummary = {
      skillsRun: 0,
      tickers: symbols.length,
      generated: 0,
      stored: 0,
      deduped: 0,
      errors: [],
    };
    for (const skill of this.skills) {
      if (missingCapabilities(this.providers, skill.requires).length > 0) continue;
      summary.skillsRun += 1;
      const result = await this.runSkill(skill, symbols, dedupe);
      summary.generated += result.generated;
      summary.stored += result.stored;
      summary.errors.push(...result.errors);
    }
    summary.deduped = summary.generated - summary.stored;
    return summary;
  }

  /** Cron entry point: run one skill across the watchlist, guarding overlap. */
  private async runScheduled(skill: SignalSkill): Promise<void> {
    // Skip if a previous (slow) run of this skill is still going.
    if (this.running.has(skill.id)) return;
    this.running.add(skill.id);
    try {
      await this.runSkill(skill, this.store.listSymbols(), true);
    } finally {
      this.running.delete(skill.id);
    }
  }

  private async runSkill(
    skill: SignalSkill,
    symbols: string[],
    dedupe: boolean,
  ): Promise<SkillRunResult> {
    const result: SkillRunResult = { generated: 0, stored: 0, errors: [] };
    const ctx: SkillContext = {
      providers: this.providers,
      log: (msg) => console.log(`[${skill.id}] ${msg}`),
      now: () => new Date(),
    };
    for (const ticker of symbols) {
      try {
        const signals = await skill.run(ctx, ticker);
        result.generated += signals.length;
        for (const signal of signals) {
          if (this.store.insertSignal(signal, dedupe ? 60 : 0)) result.stored += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${skill.id}] ${ticker} failed:`, message);
        result.errors.push({ skill: skill.id, ticker, message });
      }
    }
    if (result.stored > 0) console.log(`[${skill.id}] stored ${result.stored} new signal(s)`);
    return result;
  }
}
