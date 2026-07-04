import type { DataCapability, ProviderRegistry } from "./providers.js";

export type Direction = "bullish" | "bearish" | "neutral";

/** A generated signal. Persistence fields (id, createdAt) are added by the server. */
export interface Signal {
  skillId: string;
  ticker: string;
  direction: Direction;
  /** 0..1 — how strongly the evidence supports the direction. */
  confidence: number;
  /** One-line headline, e.g. "Spot 2.1% below call wall at 150". */
  title: string;
  /** Plain-language explanation an investor can act on. */
  rationale: string;
  /** Skill-specific structured payload (e.g. the full GEX profile). */
  data?: Record<string, unknown>;
}

export interface SkillContext {
  providers: ProviderRegistry;
  log: (message: string) => void;
  now: () => Date;
}

/**
 * A signal source ("skill"). Each skill is self-contained: it declares the
 * data capabilities it needs and a cron schedule, and produces zero or more
 * signals per ticker per run. Skills must be side-effect free apart from
 * provider calls — persistence and dedupe are the scheduler's job.
 */
export interface SignalSkill {
  id: string;
  name: string;
  description: string;
  /** Standard 5-field cron expression evaluated in server-local time. */
  schedule: string;
  requires: DataCapability[];
  run(ctx: SkillContext, ticker: string): Promise<Signal[]>;
}
