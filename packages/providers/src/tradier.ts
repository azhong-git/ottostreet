import type {
  Bar,
  BarInterval,
  BarsProvider,
  OptionContract,
  OptionsChainProvider,
  Quote,
  QuoteProvider,
} from "@ottostreet/core";

export interface TradierConfig {
  token: string;
  /** "sandbox" (delayed data, free) or "production". */
  env?: "sandbox" | "production";
}

/**
 * Tradier market data provider. Free with a Tradier brokerage account;
 * sandbox tokens serve 15-minute-delayed data, which is fine for
 * minute-cadence (non-HFT) signal generation. Greeks are supplied by ORATS
 * and refreshed roughly hourly.
 * Docs: https://documentation.tradier.com/brokerage-api/markets/get-options-chains
 */
export class TradierProvider implements QuoteProvider, OptionsChainProvider, BarsProvider {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: TradierConfig) {
    if (!config.token) throw new Error("TradierProvider requires an API token");
    this.token = config.token;
    this.baseUrl =
      config.env === "production"
        ? "https://api.tradier.com/v1"
        : "https://sandbox.tradier.com/v1";
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tradier ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.get("/markets/quotes", { symbols: symbol });
    const raw = data?.quotes?.quote;
    const q = Array.isArray(raw) ? raw[0] : raw;
    if (!q) throw new Error(`Tradier returned no quote for ${symbol}`);
    return {
      symbol: q.symbol,
      last: q.last ?? q.close ?? q.prevclose,
      bid: q.bid ?? undefined,
      ask: q.ask ?? undefined,
      volume: q.volume ?? undefined,
      timestamp: new Date(q.trade_date || Date.now()).toISOString(),
    };
  }

  async getExpirations(symbol: string): Promise<string[]> {
    const data = await this.get("/markets/options/expirations", { symbol });
    const raw = data?.expirations?.date;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  /**
   * Daily bars come from /markets/history; intraday from /markets/timesales
   * (regular session only). Tradier's finest intraday granularity retention is
   * limited (e.g. ~20 days for 1min), which is fine for minute-cadence
   * signals. 1h bars are aggregated client-side from 15min data.
   */
  async getBars(symbol: string, interval: BarInterval, from: string, to: string): Promise<Bar[]> {
    if (interval === "1d") {
      const data = await this.get("/markets/history", {
        symbol,
        interval: "daily",
        start: from.slice(0, 10),
        end: to.slice(0, 10),
      });
      const raw = data?.history?.day;
      if (!raw) return [];
      const days: any[] = Array.isArray(raw) ? raw : [raw];
      return days.map((d) => ({
        time: new Date(d.date).toISOString(),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));
    }

    const tradierInterval = interval === "1m" ? "1min" : interval === "5m" ? "5min" : "15min";
    const data = await this.get("/markets/timesales", {
      symbol,
      interval: tradierInterval,
      start: from.slice(0, 10),
      end: to.slice(0, 10),
      session_filter: "open",
    });
    const raw = data?.series?.data;
    if (!raw) return [];
    const points: any[] = Array.isArray(raw) ? raw : [raw];
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const bars: Bar[] = points
      .filter((p) => p.timestamp * 1000 >= fromMs && p.timestamp * 1000 <= toMs)
      .map((p) => ({
        time: new Date(p.timestamp * 1000).toISOString(),
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
      }));
    return interval === "1h" ? aggregateHourly(bars) : bars;
  }

  async getChain(symbol: string, expiration: string): Promise<OptionContract[]> {
    const data = await this.get("/markets/options/chains", {
      symbol,
      expiration,
      greeks: "true",
    });
    const raw = data?.options?.option;
    if (!raw) return [];
    const options: any[] = Array.isArray(raw) ? raw : [raw];
    return mapChain(options, symbol, expiration);
  }
}

/** Merge intraday bars into hourly buckets. */
function aggregateHourly(bars: Bar[]): Bar[] {
  const buckets = new Map<number, Bar>();
  for (const bar of bars) {
    const hour = Math.floor(new Date(bar.time).getTime() / 3_600_000);
    const existing = buckets.get(hour);
    if (!existing) {
      buckets.set(hour, { ...bar, time: new Date(hour * 3_600_000).toISOString() });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function mapChain(options: any[], symbol: string, expiration: string): OptionContract[] {
  return options.map((o) => ({
      symbol: o.symbol,
      underlying: o.underlying ?? symbol,
      type: o.option_type as "call" | "put",
      strike: o.strike,
      expiration: o.expiration_date ?? expiration,
      bid: o.bid ?? undefined,
      ask: o.ask ?? undefined,
      last: o.last ?? undefined,
      volume: o.volume ?? undefined,
      openInterest: o.open_interest ?? 0,
      greeks: o.greeks
        ? {
            delta: o.greeks.delta,
            gamma: o.greeks.gamma,
            theta: o.greeks.theta,
            vega: o.greeks.vega,
            iv: o.greeks.mid_iv ?? o.greeks.smv_vol,
          }
        : undefined,
  }));
}
