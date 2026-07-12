// Verifies the real content-extraction code (Readability + htmlToBlocks)
// against a sample article, using a normal Chrome page (no extension
// loading required, so it works even where Developer Mode is policy-locked).
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fixtureUrl = `file://${resolve("scripts/fixtures/sample-article.html")}`;
const bundlePath = resolve("dist-test/extract.browser.js");

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.addScriptTag({ path: bundlePath });

  const fullPageResult = await page.evaluate(() => window.ClipKeepExtract.extractFullPage());
  console.log("extractFullPage() ->", JSON.stringify(fullPageResult, null, 2).slice(0, 1500));

  assert.equal(fullPageResult.title, "テスト記事タイトル", "title should come from Readability's article title");
  assert.ok(!JSON.stringify(fullPageResult.blocks).includes("フッター"), "footer chrome should be excluded");

  // Metadata used by the popup's property auto-mapping (author/date/source
  // property pre-fill) must actually be surfaced on the extraction result —
  // Readability parses these from <meta> tags but they were previously
  // discarded entirely.
  assert.equal(fullPageResult.siteName, "ClipKeepテストサイト", "siteName should come from og:site_name");
  assert.equal(fullPageResult.byline, "ClipKeep 太郎", "byline should come from the author meta tag");
  assert.equal(
    fullPageResult.publishedTime,
    "2026-07-01T09:00:00.000Z",
    "publishedTime should come from the article:published_time meta tag"
  );

  // Regression guard for a real bug found via live QA on Yahoo! JAPAN's
  // portal homepage: a link-heavy <header> sitting outside <main> (a common
  // real-world pattern for site-wide navigation menus) got picked up as the
  // "article" itself — since the site's obfuscated/hashed class names gave
  // Readability's own nav-keyword heuristic nothing to match, and the page
  // has no single real article for it to prefer instead. stripPageChrome()
  // removes header/nav/footer/aside/ARIA-landmark chrome outside
  // <article>/<main> before Readability ever scores it, so none of these
  // menu items should survive into the extracted blocks.
  const blocksJson = JSON.stringify(fullPageResult.blocks);
  for (const menuItem of ["ホームページに設定する", "きっず版", "アプリ版", "ヘルプ", "オークション", "ショッピング"]) {
    assert.ok(!blocksJson.includes(menuItem), `header nav menu item "${menuItem}" should be stripped as page chrome`);
  }

  // Regression guard: the fixture's content lives inside a <main> element
  // (not <article>/<div>/<section>/<figure>). htmlToBlocks() previously only
  // recursed into that fixed tag whitelist, so unrecognized containers like
  // <main> got flattened into a single giant paragraph, silently discarding
  // all headings/lists/quotes/code. Multiple distinct block types surviving
  // here proves the walk() recursed into <main> instead of collapsing it.
  assert.ok(fullPageResult.blocks.length > 5, "content wrapped in <main> should not collapse into one paragraph block");

  const types = fullPageResult.blocks.map((b) => b.type);
  assert.ok(
    types.includes("heading_1") || types.includes("heading_2") || types.includes("heading_3"),
    "expected at least one heading block for 小見出しその1"
  );
  assert.ok(types.includes("bulleted_list_item"), "expected bulleted_list_item blocks");
  assert.ok(types.includes("quote"), "expected a quote block");
  assert.ok(types.includes("code"), "expected a code block");
  const codeBlock = fullPageResult.blocks.find((b) => b.type === "code");
  assert.ok(codeBlock.text.includes("hello from code block"), "code block should retain code content");

  // Regression guard: images must be extracted, including lazy-loaded ones
  // that only carry the real URL in a data-src attribute (with a base64
  // placeholder in `src` until JS swaps it in on scroll). This is an
  // extremely common real-world pattern; previously only a plain `src`
  // starting with "http" was recognized, silently dropping any lazy image.
  const imageBlocks = fullPageResult.blocks.filter((b) => b.type === "image");
  assert.equal(imageBlocks.length, 2, "expected both the normal and the lazy-loaded image to be extracted");
  assert.ok(
    imageBlocks.some((b) => b.url === "https://example.com/hero.jpg"),
    "normal <img src> should be extracted as-is"
  );
  assert.ok(
    imageBlocks.some((b) => b.url === "https://example.com/lazy-photo.jpg"),
    "lazy-loaded image should resolve to the real data-src URL, not the base64 placeholder"
  );
  assert.ok(
    !imageBlocks.some((b) => b.url.startsWith("data:")),
    "a data: URI placeholder must never be saved as the image URL"
  );

  // Selection extraction
  await page.evaluate(() => {
    const p = document.querySelector("main p");
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const selectionResult = await page.evaluate(() => window.ClipKeepExtract.extractSelection());
  console.log("extractSelection() ->", JSON.stringify(selectionResult));
  assert.equal(selectionResult.blocks[0].type, "quote");
  assert.ok(selectionResult.blocks[0].text.includes("ClipKeepの本文抽出ロジックを検証"));
  assert.equal(selectionResult.byline, null, "selection extraction has no article metadata to draw a byline from");
  assert.equal(selectionResult.publishedTime, null, "selection extraction has no article metadata to draw a date from");

  console.log("\nEXTRACTION TEST PASSED");
} finally {
  await browser.close();
}
