import { NextRequest, NextResponse } from "next/server";

const BASES = {
  spot: ["https://api.binance.com/api/v3"],
  // Binance documents multiple Futures REST entry points. Try the primary
  // endpoint first, then the numbered official endpoints if the upstream
  // edge is unavailable/geo-blocked. No third-party market-data source is used.
  usdm: [
    "https://fapi.binance.com/fapi/v1",
    "https://fapi1.binance.com/fapi/v1",
    "https://fapi2.binance.com/fapi/v1",
    "https://fapi3.binance.com/fapi/v1",
    "https://fapi4.binance.com/fapi/v1",
  ],
  coinm: [
    "https://dapi.binance.com/dapi/v1",
    "https://dapi1.binance.com/dapi/v1",
    "https://dapi2.binance.com/dapi/v1",
    "https://dapi3.binance.com/dapi/v1",
    "https://dapi4.binance.com/dapi/v1",
  ],
} as const;

const ALLOWED_ENDPOINTS = new Set([
  "/klines",
  "/exchangeInfo",
  "/ticker/24hr",
  "/openInterest",
  "/premiumIndex",
  "/aggTrades",
]);
const ALLOWED_QUERY_KEYS = new Set([
  "symbol",
  "interval",
  "limit",
  "startTime",
  "endTime",
  "fromId",
]);

type Market = keyof typeof BASES;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market") as Market | null;
  const path = request.nextUrl.searchParams.get("path");
  if (!market || !(market in BASES) || !path || !ALLOWED_ENDPOINTS.has(path)) {
    return NextResponse.json({ error: "Invalid Binance proxy request" }, { status: 400 });
  }

  const query = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key === "market" || key === "path") continue;
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      return NextResponse.json({ error: "Invalid Binance query parameter" }, { status: 400 });
    }
    query.append(key, value);
  }

  const limit = query.get("limit");
  if (limit !== null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return NextResponse.json({ error: "Binance limit must be an integer from 1 to 1000" }, { status: 400 });
    }
  }
  const symbol = query.get("symbol");
  if (symbol !== null) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol || !/^[A-Z0-9._-]{1,40}$/.test(normalizedSymbol)) {
      return NextResponse.json({ error: "Invalid Binance symbol" }, { status: 400 });
    }
    query.set("symbol", normalizedSymbol);
  }
  const interval = query.get("interval");
  if (interval !== null && !/^([1-9]\d*)(s|m|h|d|w|M)$/.test(interval)) {
    return NextResponse.json({ error: "Invalid Binance interval" }, { status: 400 });
  }

  const suffix = path + (query.size ? "?" + query.toString() : "");
  const targets = BASES[market].map((base) => base + suffix);
  try {
    let lastStatus: number | null = null;
    let lastBody = "";

    for (const target of targets) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const upstream = await fetch(target, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await upstream.text();
        lastStatus = upstream.status;
        lastBody = body;

        // Edge-specific geo blocks and transient upstream failures can differ
        // between Binance's official endpoints. Keep deterministic 4xx
        // validation errors on the first response, but fail over on 451,
        // rate-limit, and server-error responses.
        // Do not fan a single 429 into five more Binance requests. The caller
        // has bounded retry/backoff logic and can safely retry this response.
        if (upstream.status === 429) {
          const retryAfter = upstream.headers.get("retry-after") ?? "1";
          return new NextResponse(body, {
            status: 429,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store, max-age=0",
              "retry-after": retryAfter,
            },
          });
        }
        if (upstream.status === 451 || upstream.status >= 500) continue;

        return new NextResponse(body, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
            "cache-control": "no-store, max-age=0",
          },
        });
      } catch {
        // Try the next official Binance endpoint.
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastStatus === 451) {
      return NextResponse.json(
        {
          error: "Binance blocked all official Futures endpoints from this server region (HTTP 451)",
          region: process.env.VERCEL_REGION ?? "unknown",
        },
        { status: 451, headers: { "cache-control": "no-store, max-age=0" } },
      );
    }

    if (lastStatus !== null) {
      return new NextResponse(lastBody, {
        status: lastStatus,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store, max-age=0",
        },
      });
    }

    return NextResponse.json(
      { error: "Binance upstream unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Binance upstream unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
