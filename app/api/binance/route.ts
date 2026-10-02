import { NextRequest, NextResponse } from "next/server";

const BASES = {
  spot: "https://api.binance.com/api/v3",
  usdm: "https://fapi.binance.com/fapi/v1",
  coinm: "https://dapi.binance.com/dapi/v1",
} as const;

const ALLOWED_ENDPOINTS = new Set([
  "/klines",
  "/exchangeInfo",
  "/ticker/24hr",
  "/openInterest",
  "/premiumIndex",
  "/aggTrades",
]);

type Market = keyof typeof BASES;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market") as Market | null;
  const path = request.nextUrl.searchParams.get("path");
  if (!market || !(market in BASES) || !path || !ALLOWED_ENDPOINTS.has(path)) {
    return NextResponse.json({ error: "Invalid Binance proxy request" }, { status: 400 });
  }

  const query = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key !== "market" && key !== "path") query.append(key, value);
  }

  const target = BASES[market] + path + (query.size ? "?" + query.toString() : "");
  try {
    const upstream = await fetch(target, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json({ error: "Binance upstream unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
