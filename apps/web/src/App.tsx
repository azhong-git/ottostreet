import { useCallback, useEffect, useState } from "react";
import { api, type StoredSignal } from "./api";

const REFRESH_MS = 15_000;

export default function App() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  const runNow = async () => {
    setRunning(true);
    try {
      await api.runNow();
      await refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>ottostreet</h1>
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

        <button className="run-now" onClick={() => void runNow()} disabled={running}>
          {running ? "Running…" : "Run skills now"}
        </button>
        {error && <p className="error">{error}</p>}
      </aside>

      <main className="feed">
        <h2>Signals {filter ? `— ${filter}` : ""}</h2>
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
