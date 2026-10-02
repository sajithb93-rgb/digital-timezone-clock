import { chromium } from "playwright";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

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

  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return /\d+ candles/.test(text) && text.includes("BINANCE");
  }, { timeout: 60_000 });

  await page.waitForFunction(() => {
    const status = document.querySelector(".data-status");
    return status?.textContent?.includes("LIVE DATA") ?? false;
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
      errorAlertText: document.querySelector(".alert")?.textContent ?? ""
    };
  });

  console.log(JSON.stringify({ snapshot: result, consoleErrors, pageErrors, requestFailures, badResponses }, null, 2));

  if (!result.chartPresent || !result.canvasPresent) throw new Error("Chart canvas did not render");
  if (!result.canvasSize || result.canvasSize.width < 300 || result.canvasSize.height < 200) throw new Error("Rendered chart canvas has invalid dimensions");
  if (!result.chartSize || result.chartSize.width < 300 || result.chartSize.height < 300) throw new Error("Chart container has invalid dimensions");
  if (!result.overlayPresent) throw new Error("Analysis SVG overlay did not mount");
  if (result.candleCount < 2) throw new Error(`Expected at least 2 candles, got ${result.candleCount}`);
  if (!result.status.includes("LIVE DATA")) throw new Error("Binance live-data status did not become LIVE DATA");
  if (result.errorAlert) throw new Error(`Application error alert: ${result.errorAlertText}`);
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

  await page.screenshot({ path: "artifacts/browser-smoke.png", fullPage: true });
  console.log(JSON.stringify({ pass: true, ...result, consoleErrors, pageErrors, requestFailures, badResponses }, null, 2));
} finally {
  await browser.close();
}
