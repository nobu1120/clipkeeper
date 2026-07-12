// Renders the extension icon from an SVG source via headless Chrome
// (puppeteer-core, already a devDependency — see extraction-test.mjs for the
// same pattern), instead of hand-rolling raw, non-anti-aliased PNG pixels.
// This gives a properly anti-aliased result at every size.
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// A rounded-square gradient background with a white bookmark/ribbon mark —
// "clip and keep" — rather than a plain letter monogram or solid dot. The
// viewBox stays fixed at 128x128 for consistent coordinates; width/height
// are set per target size so Chrome rasterizes (and anti-aliases) directly
// at that resolution rather than us scaling a bitmap after the fact.
function svgMarkup(size) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5B8DEF"/>
      <stop offset="1" stop-color="#3730A3"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="28" fill="url(#bg)"/>
  <path d="M42 26 H86 V100 L64 84 L42 100 Z" fill="#ffffff"/>
</svg>`.trim();
}

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 48, 128]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0;">${svgMarkup(size)}</body></html>`
    );
    const svgEl = await page.$("svg");
    const buf = await svgEl.screenshot({ omitBackground: true, type: "png" });
    writeFileSync(new URL(`../public/icons/icon${size}.png`, import.meta.url), buf);
  }
} finally {
  await browser.close();
}
console.log("Icons generated.");
