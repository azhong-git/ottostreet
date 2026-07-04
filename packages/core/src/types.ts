/** A real-time (or delayed) quote for an underlying. */
export interface Quote {
  symbol: string;
  last: number;
  bid?: number;
  ask?: number;
  volume?: number;
  /** ISO 8601 timestamp of the quote. */
  timestamp: string;
}

export interface Greeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  /** Implied volatility as a decimal, e.g. 0.35. */
  iv?: number;
}

export type OptionType = "call" | "put";

export interface OptionContract {
  /** OCC option symbol, e.g. AAPL250117C00150000. */
  symbol: string;
  underlying: string;
  type: OptionType;
  strike: number;
  /** Expiration date, YYYY-MM-DD. */
  expiration: string;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
  openInterest: number;
  greeks?: Greeks;
}

/** An OHLCV bar. `time` is the bar start, ISO 8601. */
export interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type BarInterval = "1m" | "5m" | "15m" | "1h" | "1d";
