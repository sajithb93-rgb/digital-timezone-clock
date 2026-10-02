export type NewsImpact = "high" | "medium" | "low";

export type NewsEvent = { title: string; country: string; impact: NewsImpact; date: number; };
export type NewsRisk = { level: "HIGH" | "MEDIUM" | "LOW"; blocked: boolean; message: string; nextEvent?: NewsEvent; minutesToEvent?: number; minutesSinceEvent?: number; };

const DEFAULT_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const HIGH_KEYWORDS = /cpi|consumer price|pce|personal consumption|nonfarm|non-farm|nfp|payroll|fomc|fed interest|federal funds|fed rate|powell|rate decision|gdp|gross domestic|retail sales|ism manufacturing|ism services|unemployment rate|jobless claims|core inflation/i;
const MEDIUM_KEYWORDS = /ppi|producer price|pmi|durable goods|consumer confidence|jolts|industrial production|housing|existing home|new home|trade balance/i;

function toImpact(value: unknown, title: string): NewsImpact {
  const v = String(value ?? "").toLowerCase();
  if (v === "high" || v === "3" || v === "3.0") return "high";
  if (v === "medium" || v === "2" || v === "2.0") return "medium";
  if (HIGH_KEYWORDS.test(title)) return "high";
  if (MEDIUM_KEYWORDS.test(title)) return "medium";
  return "low";
}
function parseDate(value: unknown): number | null {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (value === null || value === undefined || value === "") return null;
  const textValue=String(value).trim();
  if (!textValue) return null;
  const numeric=Number(textValue);
  if (Number.isFinite(numeric) && numeric>0) return numeric>1e12 ? numeric : numeric*1000;
  const t = Date.parse(textValue);
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
export function getNewsRisk(events: NewsEvent[], effectiveNow = Date.effectiveNow(), bufferMinutes = 30): NewsRisk {
  // Invalid clock input must never silently turn an active news window into
  // LOW risk. Fall back to the real current clock value.
  const effectiveNow=Number.isFinite(effectiveNow)?effectiveNow:Date.effectiveNow();
  // Treat invalid/negative windows as the safe default instead of allowing a
  // caller to accidentally disable the news block through NaN/negative input.
  const safeBufferMinutes=Number.isFinite(bufferMinutes)?Math.max(0,bufferMinutes):30;
  const buffer = safeBufferMinutes * 60_000;
  const relevant = events.filter(e => e.impact === "high").sort((a,b) => a.date - b.date);
  // If an upcoming high-impact event and a recently completed one are both
  // inside the window, the upcoming event must take precedence. Otherwise an
  // older event can incorrectly mask the next release.
  const upcomingHigh = relevant.find(e => e.date >= effectiveNow && e.date - effectiveNow <= buffer);
  if (upcomingHigh) {
    const minutesToEvent = Math.ceil((upcomingHigh.date - effectiveNow) / 60_000);
    return {
      level: "HIGH", blocked: true,
      message: upcomingHigh.title + " in " + minutesToEvent + "m — high-impact news window",
      nextEvent: upcomingHigh, minutesToEvent
    };
  }
  const recentHigh = relevant
    .filter(e => e.date < effectiveNow && effectiveNow - e.date <= buffer)
    .sort((a,b) => b.date - a.date)[0];
  if (recentHigh) {
    const minutesSinceEvent = Math.ceil((effectiveNow - recentHigh.date) / 60_000);
    return {
      level: "HIGH", blocked: true,
      message: recentHigh.title + " was " + minutesSinceEvent + "m ago — post-news volatility window",
      nextEvent: recentHigh, minutesSinceEvent
    };
  }

  const mediumEvents = events.filter(e => e.impact === "medium");
  // Prefer an upcoming medium-impact release when several events share the
  // caution window; otherwise fall back to the most recent completed release.
  const upcomingMedium = mediumEvents
    .filter(e => e.date >= effectiveNow && e.date - effectiveNow <= buffer)
    .sort((a,b) => a.date-b.date)[0];
  const recentMedium = mediumEvents
    .filter(e => e.date < effectiveNow && effectiveNow-e.date <= buffer)
    .sort((a,b) => b.date-a.date)[0];
  const medium = upcomingMedium ?? recentMedium;
  if (medium && Math.abs(medium.date-effectiveNow) <= buffer) {
    const delta=medium.date-effectiveNow;
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
  // Browser callers use the same-origin Next.js proxy to avoid CORS failures
  // from the external calendar provider. Server/test callers can still fetch
  // the provider directly.
  const url = typeof window === "undefined"
    ? (process.env.NEWS_CALENDAR_URL || DEFAULT_CALENDAR_URL)
    : "/api/news";
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("News calendar returned " + response.status);
  return normalizeNews(await response.json());
}
