import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Binance proxy route", () => {
  it("forwards an allowed kline request to the correct upstream", async () => {
    const upstream = [
      [1700000000000, "100", "101", "99", "100.5", "10", 1700000299999, "0", "100", "5"]
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(upstream), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const request = new NextRequest(
      "https://example.test/api/binance?market=usdm&path=%2Fklines&symbol=BTCUSDT&interval=5m&limit=350",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upstream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toBe(
      "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=350",
    );
  });

  it("rejects unsupported paths and query parameters before reaching Binance", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    const badPath = await GET(
      new NextRequest("https://example.test/api/binance?market=usdm&path=%2Faccount"),
    );
    expect(badPath.status).toBe(400);

    const badQuery = await GET(
      new NextRequest("https://example.test/api/binance?market=usdm&path=%2Fklines&symbol=BTCUSDT&evil=1"),
    );
    expect(badQuery.status).toBe(400);

    const badLimit = await GET(
      new NextRequest("https://example.test/api/binance?market=usdm&path=%2Fklines&limit=5000"),
    );
    expect(badLimit.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
