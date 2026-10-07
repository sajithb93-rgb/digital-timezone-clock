import { chromium } from "playwright";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
const badResponses = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "failed"}`));
page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".chartarea canvas", { state: "visible", timeout: 30_000 });

  // CI runners can be geographically blocked by Binance (HTTP 451). The smoke
  // test must distinguish that legitimate upstream condition from an app/chart
  // failure; production still requires real Binance data and never uses mocks.
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    const status = document.querySelector(".data-status")?.textContent ?? "";
    const alert = document.querySelector(".alert")?.textContent ?? "";
    return /[1-9]\d* candles/.test(text)
      || status.includes("WAITING FOR DATA")
      || /Binance blocked|HTTP 451|server region/i.test(alert);
  }, { timeout: 60_000 });

  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const chart = document.querySelector(".chartarea");
    const canvas = chart?.querySelector("canvas");
    const overlay = document.querySelector("svg.chart-overlay");
    const overlayWrap = document.querySelector(".chart-overlay-wrap");
    const debug = document.querySelector(".analysis-debug");
    const candleText = document.body.innerText.match(/(\d+) candles/);
    const canvasRect = canvas?.getBoundingClientRect();
    const chartRect = chart?.getBoundingClientRect();
    const wrapRect = overlayWrap?.getBoundingClientRect();
    const status = document.querySelector(".data-status")?.textContent ?? "";
    return {
      chartPresent: !!chart,
      canvasPresent: !!canvas,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      canvasRect: canvasRect ? { width: canvasRect.width, height: canvasRect.height } : null,
      chartSize: chartRect ? { width: chartRect.width, height: chartRect.height } : null,
      overlayPresent: !!overlay,
      overlayWrapPresent: !!overlayWrap,
      overlayWrapSize: wrapRect ? { width: wrapRect.width, height: wrapRect.height } : null,
      overlayContentNodes: overlay ? overlay.childElementCount : 0,
      analysisDebugPresent: !!debug,
      debugText: debug?.textContent ?? "",
      candleCount: candleText ? Number(candleText[1]) : 0,
      status,
      errorAlert: !!document.querySelector(".alert"),
      errorAlertText: document.querySelector(".alert")?.textContent ?? "",
      timeframeButtons: [...document.querySelectorAll(".timeframes button")].map((b) => b.textContent?.trim()).filter(Boolean)
    };
  });

  console.log(JSON.stringify({ snapshot: result, consoleErrors, pageErrors, requestFailures, badResponses }, null, 2));

  if (!result.chartPresent || !result.canvasPresent) throw new Error("Chart canvas did not render");
  if (!result.canvasSize || result.canvasSize.width < 300 || result.canvasSize.height < 200) throw new Error("Rendered chart canvas has invalid dimensions");
  if (!result.chartSize || result.chartSize.width < 300 || result.chartSize.height < 300) throw new Error("Chart container has invalid dimensions");
  // No analysis SVG is expected until closed Binance candles exist. Once real
  // market data is present, the overlay is mandatory.
  if (result.candleCount >= 2 && !result.overlayPresent) throw new Error("Analysis SVG overlay did not mount with real candle data");
  if (result.timeframeButtons.join(",") !== "1m,5m,15m,1h,4h,1d") throw new Error("Timeframe controls are incomplete or out of order");
  const upstreamBlocked = /Binance blocked|HTTP 451|server region/i.test(result.errorAlertText);
  if (result.candleCount < 2 && !upstreamBlocked && !result.status.includes("WAITING FOR DATA")) {
    throw new Error(`Expected real Binance candles or an explicit upstream-data state, got ${result.candleCount} candles / ${result.status}`);
  }
  if (result.errorAlert && !upstreamBlocked) throw new Error(`Application error alert: ${result.errorAlertText}`);
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

  await page.screenshot({ path: "artifacts/browser-smoke.png", fullPage: true });
  console.log(JSON.stringify({ pass: true, ...result, consoleErrors, pageErrors, requestFailures, badResponses }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
