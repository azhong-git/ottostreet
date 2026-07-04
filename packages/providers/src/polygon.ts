import type {
  Bar,
  BarInterval,
  BarsProvider,
  OptionContract,
  OptionsChainProvider,
  Quote,
  QuoteProvider,
} from "@ottostreet/core";

export interface PolygonConfig {
  apiKey: string;
  /**
   * Max retries when throttled (HTTP 429). The free "Basic" plan allows only
   * 5 calls/minute, so backoff keeps a multi-ticker watchlist working (slowly)
   * instead of erroring.
   */
  maxRetries?: number;
}

const AGG_TIMESPAN: Record<BarInterval, { multiplier: number; timespan: string }> = {
  "1m": { multiplier: 1, timespan: "minute" },
  "5m": { multiplier: 5, timespan: "minute" },
  "15m": { multiplier: 15, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
  "1d": { multiplier: 1, timespan: "day" },
};

/**
 * Polygon.io market data provider (stocks + options).
 *
 * Works on the free "Basic" plan: one key covers both stocks and options with
 * delayed/end-of-day data at 5 calls/minute. Options data (open interest,
 * greeks) comes from the v3 options snapshot, which is fine for OI-based
 * positioning skills since OCC publishes open interest only once per day.
 * Real-time data requires paid Stocks/Options plans (separate subscriptions),
 * but this provider does not depend on real-time.
 * Docs: https://polygon.io/docs
 */
export class PolygonProvider implements QuoteProvider, OptionsChainProvider, BarsProvider {
  private readonly baseUrl = "https://api.polygon.io";
  private readonly apiKey: string;
  private readonly maxRetries: number;

  constructor(config: PolygonConfig) {
    if (!config.apiKey) throw new Error("PolygonProvider requires an API key");
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /** GET an absolute-or-relative Polygon URL, injecting the API key and retrying on 429. */
  private async get(pathOrUrl: string): Promise<any> {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`);
    url.searchParams.set("apiKey", this.apiKey);

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url);
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000 + 500;
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Polygon ${url.pathname} failed: ${res.status} ${body.slice(0, 200)}`);
      }
      return res.json();
    }
  }

  /** Previous-day close — available on the free tier and adequate for a non-HFT tool. */
  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.get(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`);
    const r = data?.results?.[0];
    if (!r) throw new Error(`Polygon returned no quote for ${symbol}`);
    return {
      symbol,
      last: r.c,
      volume: r.v ?? undefined,
      timestamp: new Date(r.t ?? Date.now()).toISOString(),
    };
  }

  async getExpirations(symbol: string): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    let next: string | null =
      `/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(symbol)}` +
      `&expiration_date.gte=${today}&expired=false&limit=1000&sort=expiration_date&order=asc`;

    // Contracts are paginated; a few pages cover all live expirations.
    for (let page = 0; next && page < 5; page++) {
      const data: any = await this.get(next);
      for (const c of data?.results ?? []) {
        if (c.expiration_date) seen.add(c.expiration_date);
      }
      next = data?.next_url ?? null;
    }
    return [...seen].sort();
  }

  async getChain(symbol: string, expiration: string): Promise<OptionContract[]> {
    const contracts: OptionContract[] = [];
    let next: string | null =
      `/v3/snapshot/options/${encodeURIComponent(symbol)}` +
      `?expiration_date=${expiration}&limit=250`;

    for (let page = 0; next && page < 10; page++) {
      const data: any = await this.get(next);
      for (const o of data?.results ?? []) {
        const d = o.details ?? {};
        contracts.push({
          symbol: d.ticker ?? "",
          underlying: o.underlying_asset?.ticker ?? symbol,
          type: (d.contract_type === "put" ? "put" : "call") as "call" | "put",
          strike: d.strike_price,
          expiration: d.expiration_date ?? expiration,
          bid: o.last_quote?.bid ?? undefined,
          ask: o.last_quote?.ask ?? undefined,
          last: o.last_trade?.price ?? undefined,
          volume: o.day?.volume ?? undefined,
          openInterest: o.open_interest ?? 0,
          greeks: o.greeks
            ? {
                delta: o.greeks.delta,
                gamma: o.greeks.gamma,
                theta: o.greeks.theta,
                vega: o.greeks.vega,
                iv: o.implied_volatility,
              }
            : undefined,
        });
      }
      next = data?.next_url ?? null;
    }
    return contracts;
  }

  async getBars(symbol: string, interval: BarInterval, from: string, to: string): Promise<Bar[]> {
    const { multiplier, timespan } = AGG_TIMESPAN[interval];
    const start = from.slice(0, 10);
    const end = to.slice(0, 10);
    const data = await this.get(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${multiplier}/${timespan}/${start}/${end}` +
        `?adjusted=true&sort=asc&limit=50000`,
    );
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return (data?.results ?? [])
      .filter((r: any) => r.t >= fromMs && r.t <= toMs)
      .map((r: any) => ({
        time: new Date(r.t).toISOString(),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
