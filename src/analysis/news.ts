export type NewsImpact = "high" | "medium" | "low";

export type NewsEvent = { title: string; country: string; impact: NewsImpact; date: number; };
export type NewsRisk = { level: "HIGH" | "MEDIUM" | "LOW"; blocked: boolean; message: string; nextEvent?: NewsEvent; minutesToEvent?: number; minutesSinceEvent?: number; };

const DEFAULT_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const HIGH_KEYWORDS = /cpi|consumer price|pce|personal consumption|nonfarm|non-farm|nfp|payroll|fomc|fed interest|federal funds|fed rate|powell|rate decision|gdp|gross domestic|retail sales|ism manufacturing|ism services|unemployment rate|jobless claims|core inflation/i;
const MEDIUM_KEYWORDS = /ppi|producer price|pmi|durable goods|consumer confidence|jolts|industrial production|housing|existing home|new home|trade balance/i;

function toImpact(value: unknown, title: string): NewsImpact {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("high") || v.includes("3")) return "high";
  if (v.includes("medium") || v.includes("2")) return "medium";
  if (HIGH_KEYWORDS.test(title)) return "high";
  if (MEDIUM_KEYWORDS.test(title)) return "medium";
  return "low";
}
function parseDate(value: unknown): number | null {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (!value) return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}
export function normalizeNews(raw: any): NewsEvent[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : Array.isArray(raw?.data) ? raw.data : [];
  return rows.map((x: any) => {
    const title = String(x.title ?? x.event ?? x.name ?? "").trim();
    const date = parseDate(x.date ?? x.datetime ?? x.timestamp ?? x.time ?? x.releaseDate);
    const country = String(x.country ?? x.currency ?? x.currencyCode ?? "").toUpperCase();
    return { title, country, impact: toImpact(x.impact ?? x.importance ?? x.volatility, title), date: date ?? 0 };
  }).filter((x: NewsEvent) => x.title && x.date > 0 && x.country === "USD");
}
export function getNewsRisk(events: NewsEvent[], now = Date.now(), bufferMinutes = 30): NewsRisk {
  const buffer = bufferMinutes * 60_000;
  const relevant = events.filter(e => e.impact === "high").sort((a,b) => a.date - b.date);
  let nextEvent: NewsEvent | undefined, minutesToEvent: number | undefined, minutesSinceEvent: number | undefined;
  for (const event of relevant) {
    const delta = event.date - now;
    if (delta >= 0 && delta <= buffer) { nextEvent = event; minutesToEvent = Math.ceil(delta / 60_000); break; }
    if (delta < 0 && Math.abs(delta) <= buffer) { nextEvent = event; minutesSinceEvent = Math.ceil(Math.abs(delta) / 60_000); break; }
  }
  if (nextEvent) return {
    level: "HIGH", blocked: true,
    message: minutesToEvent != null ? nextEvent.title + " in " + minutesToEvent + "m — high-impact news window" : nextEvent.title + " was " + minutesSinceEvent + "m ago — post-news volatility window",
    nextEvent, minutesToEvent, minutesSinceEvent
  };
  const medium = events.filter(e => e.impact === "medium").sort((a,b) => Math.abs(a.date-now) - Math.abs(b.date-now))[0];
  if (medium && Math.abs(medium.date - now) <= buffer) {
    const delta=medium.date-now;
    return {
      level: "MEDIUM", blocked: false,
      message: delta>=0 ? medium.title + " in " + Math.ceil(delta/60_000) + "m — use caution" : medium.title + " was " + Math.ceil(Math.abs(delta)/60_000) + "m ago — use caution",
      nextEvent: medium,
      minutesToEvent: delta>=0 ? Math.ceil(delta/60_000) : undefined,
      minutesSinceEvent: delta<0 ? Math.ceil(Math.abs(delta)/60_000) : undefined
    };
  }
  return { level: "LOW", blocked: false, message: "No high-impact USD news in the configured window" };
}
export async function fetchNewsEvents(signal?: AbortSignal): Promise<NewsEvent[]> {
  const url = process.env.NEXT_PUBLIC_NEWS_CALENDAR_URL || DEFAULT_CALENDAR_URL;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("News calendar returned " + response.status);
  return normalizeNews(await response.json());
}
