import { NextResponse } from "next/server";

const DEFAULT_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export async function GET() {
  const url = process.env.NEWS_CALENDAR_URL || DEFAULT_CALENDAR_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "QuantStructure/1.0 news-calendar" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `News calendar returned ${response.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const data = await response.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "News calendar unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
