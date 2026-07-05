import { useCallback, useEffect, useState } from "react";
import { api, type RunSummary, type StoredSignal } from "./api";
import { TickerChart } from "./TickerChart";

const REFRESH_MS = 15_000;

type Status = { kind: "info" | "success" | "error"; text: string };

/** Turn a run result into a one-line, human-readable status. */
function summarizeRun(s: RunSummary): Status {
  if (s.tickers === 0) return { kind: "info", text: "Watchlist is empty — add a ticker first." };

  const errNote = summarizeErrors(s);
  if (s.stored > 0) {
    return {
      kind: "success",
      text: `Stored ${s.stored} new signal${s.stored === 1 ? "" : "s"} from ${s.skillsRun} skill${s.skillsRun === 1 ? "" : "s"} across ${s.tickers} ticker${s.tickers === 1 ? "" : "s"}.${errNote ? " " + errNote : ""}`,
    };
  }
  if (errNote) return { kind: "error", text: errNote };
  if (s.deduped > 0) {
    return {
      kind: "info",
      text: `No new signals — ${s.deduped} already recorded recently (deduped within the hour).`,
    };
  }
  return {
    kind: "info",
    text: `Ran ${s.skillsRun} skill${s.skillsRun === 1 ? "" : "s"} on ${s.tickers} ticker${s.tickers === 1 ? "" : "s"} — no signals fired this time.`,
  };
}

function summarizeErrors(s: RunSummary): string | null {
  if (s.errors.length === 0) return null;
  const authFail = s.errors.some((e) => /403|NOT_AUTHORIZED/i.test(e.message));
  const rateLimited = s.errors.some((e) => /429|exceeded the maximum/i.test(e.message));
  const n = s.errors.length;
  const who = `${n} ticker${n === 1 ? "" : "s"} failed`;
  if (authFail) return `${who}: Polygon plan not authorized for options data (upgrade to Options Starter).`;
  if (rateLimited) return `${who}: Polygon rate limit hit (free tier = 5 calls/min).`;
  return `${who}: ${s.errors[0]!.message.slice(0, 120)}`;
}

export default function App() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [wl, sig] = await Promise.all([api.watchlist(), api.signals(filter)]);
      setWatchlist(wl);
      setSignals(sig);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const addSymbol = async (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    try {
      await api.addSymbol(symbol);
      setInput("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeSymbol = async (symbol: string) => {
    await api.removeSymbol(symbol);
    if (filter === symbol) setFilter(undefined);
    await refresh();
  };

  const runNow = async (opts?: { ticker?: string; dedupe?: boolean }) => {
    setRunning(true);
    const scope = opts?.ticker ?? "all tickers";
    setStatus({
      kind: "info",
      text: `Running skills for ${scope}… (Polygon's free tier is rate-limited, so this can take a bit.)`,
    });
    try {
      const summary = await api.runNow(opts);
      await refresh();
      setStatus(summarizeRun(summary));
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>otterstreet</h1>
          <p className="tagline">open-source stock &amp; options signals</p>

          <form onSubmit={addSymbol} className="add-form">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add ticker (e.g. NVDA)"
              maxLength={10}
            />
            <button type="submit">Add</button>
          </form>

          <button className="run-now" onClick={() => void runNow()} disabled={running}>
            {running ? "Running…" : "Run skills now"}
          </button>
          <p className="hint">
            Runs every skill across all {watchlist.length} ticker{watchlist.length === 1 ? "" : "s"}.
            Repeat signals within 1h are hidden (deduped). To force a fresh run of one ticker, select
            it and use “Run … fresh”.
          </p>
          {status && <p className={`status ${status.kind}`}>{status.text}</p>}
          {error && <p className="status error">{error}</p>}
        </div>

        <ul className="watchlist">
          <li className={filter === undefined ? "active" : ""} onClick={() => setFilter(undefined)}>
            All tickers
          </li>
          {watchlist.map((symbol) => (
            <li
              key={symbol}
              className={filter === symbol ? "active" : ""}
              onClick={() => setFilter(symbol)}
            >
              <span>{symbol}</span>
              <button
                className="remove"
                title={`Remove ${symbol}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void removeSymbol(symbol);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="feed">
        <div className="feed-header">
          <h2>Signals {filter ? `— ${filter}` : ""}</h2>
          {filter && (
            <button
              className="run-symbol"
              onClick={() => void runNow({ ticker: filter, dedupe: false })}
              disabled={running}
              title={`Run all skills for ${filter} and store every signal, ignoring the 1h dedupe window`}
            >
              {running ? "Running…" : `Run ${filter} fresh`}
            </button>
          )}
        </div>
        {filter && <TickerChart symbol={filter} signals={signals} />}
        {signals.length === 0 && (
          <p className="empty">
            No signals yet. Add a ticker, then hit “Run skills now” (or wait for the next scheduled
            run).
          </p>
        )}
        {signals.map((s) => (
          <article key={s.id} className={`signal ${s.direction}`}>
            <header>
              <span className={`badge ${s.direction}`}>{s.direction}</span>
              <span className="ticker">{s.ticker}</span>
              <span className="skill">{s.skillId}</span>
              <span className="confidence">{Math.round(s.confidence * 100)}%</span>
              <time>{new Date(s.createdAt).toLocaleString()}</time>
            </header>
            <h3>{s.title}</h3>
            <p>{s.rationale}</p>
          </article>
        ))}
      </main>
    </div>
  );
}
