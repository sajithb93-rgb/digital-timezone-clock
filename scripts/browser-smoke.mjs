import { chromium } from "playwright";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".chartarea canvas", { state: "visible", timeout: 30_000 });

  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return /\\d+ candles/.test(text) && text.includes("BINANCE");
  }, { timeout: 60_000 });

  await page.waitForFunction(() => {
    const status = Array.from(document.querySelectorAll(".status-line")).find((el) =>
      el.textContent?.includes("REST")
    );
    return status?.textContent?.includes("CONNECTED") ?? false;
  }, { timeout: 60_000 });

  const result = await page.evaluate(() => {
    const chart = document.querySelector(".chartarea");
    const canvas = chart?.querySelector("canvas");
    const overlay = document.querySelector("svg.chart-overlay");
    const debug = document.querySelector(".analysis-debug");
    const candleText = document.body.innerText.match(/(\\d+) candles/);
    const canvasRect = canvas?.getBoundingClientRect();
    const chartRect = chart?.getBoundingClientRect();

    return {
      chartPresent: !!chart,
      canvasPresent: !!canvas,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      chartSize: chartRect ? { width: chartRect.width, height: chartRect.height } : null,
      overlayPresent: !!overlay,
      overlayContentNodes: overlay ? overlay.childElementCount : 0,
      candleCount: candleText ? Number(candleText[1]) : 0,
      debugText: debug?.textContent ?? "",
      restConnected: Array.from(document.querySelectorAll(".status-line"))
        .some((el) => el.textContent?.includes("REST") && el.textContent?.includes("CONNECTED")),
      errorAlert: !!document.querySelector(".alert"),
      errorAlertText: document.querySelector(".alert")?.textContent ?? ""
    };
  });

  if (!result.chartPresent || !result.canvasPresent) throw new Error("Chart canvas did not render");
  if (!result.canvasSize || result.canvasSize.width < 300 || result.canvasSize.height < 200) {
    throw new Error("Rendered chart canvas has invalid dimensions");
  }
  if (!result.chartSize || result.chartSize.width < 300 || result.chartSize.height < 300) {
    throw new Error("Chart container has invalid dimensions");
  }
  if (!result.overlayPresent) throw new Error("Analysis SVG overlay did not mount");
  if (result.candleCount < 2) throw new Error(`Expected at least 2 candles, got ${result.candleCount}`);
  if (!result.restConnected) throw new Error("Binance REST status did not become CONNECTED");
  if (result.errorAlert) throw new Error(`Application error alert: ${result.errorAlertText}`);
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

  await page.screenshot({ path: "artifacts/browser-smoke.png", fullPage: true });
  console.log(JSON.stringify({ pass: true, ...result, consoleErrors, pageErrors }, null, 2));
} finally {
  await browser.close();
}
