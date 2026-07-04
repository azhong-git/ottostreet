import "dotenv/config";

export type ProviderName = "mock" | "polygon" | "tradier";

export interface ServerConfig {
  port: number;
  /** Default provider for all capabilities. */
  provider: ProviderName;
  /** Per-capability overrides so providers can be mixed as more are added. */
  quotesProvider: ProviderName;
  barsProvider: ProviderName;
  optionsProvider: ProviderName;
  polygonApiKey: string;
  tradierToken: string;
  tradierEnv: "sandbox" | "production";
  dbPath: string;
  /**
   * Whether skills requiring the "scrape" capability may run. Keep true for
   * local personal deployments; set false when hosting for others.
   */
  enableScrapeSkills: boolean;
}

function providerName(value: string | undefined, fallback: ProviderName): ProviderName {
  if (value === "mock" || value === "polygon" || value === "tradier") return value;
  return fallback;
}

export function loadConfig(): ServerConfig {
  const provider = providerName(process.env.PROVIDER, "polygon");
  return {
    port: Number(process.env.PORT) || 8420,
    provider,
    quotesProvider: providerName(process.env.QUOTES_PROVIDER, provider),
    barsProvider: providerName(process.env.BARS_PROVIDER, provider),
    optionsProvider: providerName(process.env.OPTIONS_PROVIDER, provider),
    polygonApiKey: process.env.POLYGON_API_KEY ?? "",
    tradierToken: process.env.TRADIER_TOKEN ?? "",
    tradierEnv: process.env.TRADIER_ENV === "production" ? "production" : "sandbox",
    dbPath: process.env.DB_PATH ?? "data/ottostreet.db",
    enableScrapeSkills: process.env.ENABLE_SCRAPE_SKILLS !== "false",
  };
}
