import type { Bar, BarInterval, OptionContract, Quote } from "./types.js";

/**
 * Data capabilities a skill can require. Providers implement one or more.
 *
 * "scrape" marks skills that fetch data by scraping websites without an
 * official API (e.g. Finviz, layoffs.fyi). Scraping skills are intended for
 * local, personal deployments; hosted deployments should disable them via
 * config (see server config `enableScrapeSkills`).
 */
export type DataCapability =
  | "quotes"
  | "options_chain"
  | "bars"
  | "news"
  | "filings"
  | "llm"
  | "scrape";

export interface QuoteProvider {
  getQuote(symbol: string): Promise<Quote>;
}

export interface OptionsChainProvider {
  /** Expiration dates (YYYY-MM-DD), soonest first. */
  getExpirations(symbol: string): Promise<string[]>;
  /** Full chain (calls and puts) for one expiration. */
  getChain(symbol: string, expiration: string): Promise<OptionContract[]>;
}

export interface BarsProvider {
  getBars(symbol: string, interval: BarInterval, from: string, to: string): Promise<Bar[]>;
}

/** The wiring between configured providers and the capabilities skills ask for. */
export interface ProviderRegistry {
  quotes?: QuoteProvider;
  optionsChain?: OptionsChainProvider;
  bars?: BarsProvider;
}

const capabilityKeys: Record<DataCapability, keyof ProviderRegistry | null> = {
  quotes: "quotes",
  options_chain: "optionsChain",
  bars: "bars",
  // Not backed by the registry yet; skills needing these are skipped until
  // the corresponding provider slots are added.
  news: null,
  filings: null,
  llm: null,
  scrape: null,
};

export function missingCapabilities(
  registry: ProviderRegistry,
  requires: DataCapability[],
): DataCapability[] {
  return requires.filter((cap) => {
    const key = capabilityKeys[cap];
    return key === null || registry[key] === undefined;
  });
}
