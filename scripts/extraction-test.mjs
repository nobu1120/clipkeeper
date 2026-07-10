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
  assert.ok(!JSON.stringify(fullPageResult.blocks).includes("ナビゲーション"), "nav chrome should be excluded by Readability");
  assert.ok(!JSON.stringify(fullPageResult.blocks).includes("フッター"), "footer chrome should be excluded by Readability");

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

  console.log("\nEXTRACTION TEST PASSED");
} finally {
  await browser.close();
}
