import type { OptionContract } from "@otterstreet/core";

export interface StrikeGex {
  strike: number;
  /** Dollar gamma per 1% move, calls (positive). */
  callGex: number;
  /** Dollar gamma per 1% move, puts (negative). */
  putGex: number;
  netGex: number;
  callOi: number;
  putOi: number;
}

export interface GexProfile {
  spot: number;
  /** Sum of net GEX across all strikes (dollar gamma per 1% move). */
  totalNetGex: number;
  /** Per-strike breakdown, ascending by strike. */
  byStrike: StrikeGex[];
  /** Strike with the largest call GEX — typically acts as resistance / pin. */
  callWall: number | null;
  /** Strike with the largest put GEX magnitude — typically acts as support. */
  putWall: number | null;
  /**
   * Approximate gamma flip: the strike where cumulative net GEX (ascending)
   * crosses zero. Above the flip dealers dampen moves; below they amplify.
   * This is the simple OI-weighted approximation, not a spot-level re-pricing.
   */
  gammaFlip: number | null;
}

/**
 * Compute a dealer gamma exposure profile from an options chain.
 *
 * Convention (SqueezeMetrics-style): dealers are assumed long calls and short
 * puts, so call gamma contributes positively and put gamma negatively.
 * Per contract: GEX = gamma × OI × 100 shares × spot² × 0.01
 * (dollar gamma per 1% move in the underlying).
 */
export function computeGexProfile(spot: number, contracts: OptionContract[]): GexProfile {
  const byStrike = new Map<number, StrikeGex>();

  for (const c of contracts) {
    const gamma = c.greeks?.gamma;
    if (gamma === undefined || !Number.isFinite(gamma) || c.openInterest <= 0) continue;
    const gex = gamma * c.openInterest * 100 * spot * spot * 0.01;

    let row = byStrike.get(c.strike);
    if (!row) {
      row = { strike: c.strike, callGex: 0, putGex: 0, netGex: 0, callOi: 0, putOi: 0 };
      byStrike.set(c.strike, row);
    }
    if (c.type === "call") {
      row.callGex += gex;
      row.callOi += c.openInterest;
    } else {
      row.putGex -= gex;
      row.putOi += c.openInterest;
    }
    row.netGex = row.callGex + row.putGex;
  }

  const rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const totalNetGex = rows.reduce((sum, r) => sum + r.netGex, 0);

  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxCall = 0;
  let maxPut = 0;
  for (const r of rows) {
    if (r.callGex > maxCall) {
      maxCall = r.callGex;
      callWall = r.strike;
    }
    if (-r.putGex > maxPut) {
      maxPut = -r.putGex;
      putWall = r.strike;
    }
  }

  return { spot, totalNetGex, byStrike: rows, callWall, putWall, gammaFlip: findGammaFlip(rows) };
}

function findGammaFlip(rows: StrikeGex[]): number | null {
  let cumulative = 0;
  let prevCumulative = 0;
  let prevStrike: number | null = null;
  for (const r of rows) {
    cumulative += r.netGex;
    if (prevStrike !== null && prevCumulative < 0 && cumulative >= 0) {
      // Linear interpolation between the two strikes at the crossing.
      const t = -prevCumulative / (cumulative - prevCumulative);
      return prevStrike + t * (r.strike - prevStrike);
    }
    prevCumulative = cumulative;
    prevStrike = r.strike;
  }
  return null;
}
