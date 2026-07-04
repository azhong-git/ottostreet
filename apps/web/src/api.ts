export type Direction = "bullish" | "bearish" | "neutral";

export interface StoredSignal {
  id: number;
  skillId: string;
  ticker: string;
  direction: Direction;
  confidence: number;
  title: string;
  rationale: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  watchlist: () => request<string[]>("/api/watchlist"),
  addSymbol: (symbol: string) =>
    request<{ watchlist: string[] }>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),
  removeSymbol: (symbol: string) =>
    request<{ watchlist: string[] }>(`/api/watchlist/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),
  signals: (ticker?: string) =>
    request<StoredSignal[]>(`/api/signals${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`),
  runNow: () => request<{ skillsRun: number; signalsStored: number }>("/api/run", { method: "POST" }),
};
