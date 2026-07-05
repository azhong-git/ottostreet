import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Signal } from "@otterstreet/core";

export interface StoredSignal extends Signal {
  id: number;
  createdAt: string;
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        symbol TEXT PRIMARY KEY,
        added_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        direction TEXT NOT NULL,
        confidence REAL NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_signals_ticker_time ON signals (ticker, created_at DESC);
    `);
  }

  listSymbols(): string[] {
    return this.db
      .prepare("SELECT symbol FROM watchlist ORDER BY symbol")
      .all()
      .map((r: any) => r.symbol);
  }

  addSymbol(symbol: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO watchlist (symbol, added_at) VALUES (?, ?)")
      .run(symbol, new Date().toISOString());
  }

  removeSymbol(symbol: string): void {
    this.db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(symbol);
  }

  /**
   * Insert a signal unless an identical headline from the same skill/ticker
   * was stored within `dedupeMinutes` — keeps a 5-minute poll from flooding
   * the feed with repeats. Pass `dedupeMinutes <= 0` to always insert (used by
   * the manual per-symbol "run fresh" action).
   */
  insertSignal(signal: Signal, dedupeMinutes = 60): boolean {
    if (dedupeMinutes > 0) {
      const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
      const dupe = this.db
        .prepare(
          "SELECT id FROM signals WHERE skill_id = ? AND ticker = ? AND title = ? AND created_at >= ? LIMIT 1",
        )
        .get(signal.skillId, signal.ticker, signal.title, since);
      if (dupe) return false;
    }

    this.db
      .prepare(
        `INSERT INTO signals (skill_id, ticker, direction, confidence, title, rationale, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.skillId,
        signal.ticker,
        signal.direction,
        signal.confidence,
        signal.title,
        signal.rationale,
        signal.data ? JSON.stringify(signal.data) : null,
        new Date().toISOString(),
      );
    return true;
  }

  listSignals(opts: { ticker?: string; limit?: number } = {}): StoredSignal[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    const rows = opts.ticker
      ? this.db
          .prepare("SELECT * FROM signals WHERE ticker = ? ORDER BY id DESC LIMIT ?")
          .all(opts.ticker, limit)
      : this.db.prepare("SELECT * FROM signals ORDER BY id DESC LIMIT ?").all(limit);
    return rows.map((r: any) => ({
      id: r.id,
      skillId: r.skill_id,
      ticker: r.ticker,
      direction: r.direction,
      confidence: r.confidence,
      title: r.title,
      rationale: r.rationale,
      data: r.data ? JSON.parse(r.data) : undefined,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
