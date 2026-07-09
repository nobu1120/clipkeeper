// Loads the unpacked extension into the user's real Chrome install via
// puppeteer-core and checks for load-time errors across the key surfaces:
// service worker registration, popup rendering, and options page rendering.
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXTENSION_PATH = resolve("dist");

if (!existsSync(CHROME_PATH)) {
  console.error(`Chrome not found at ${CHROME_PATH}`);
  process.exit(1);
}
if (!existsSync(EXTENSION_PATH)) {
  console.error(`dist/ not found — run "npm run build" first.`);
  process.exit(1);
}

const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: false, // MV3 service workers require non-headless (or "new") mode
  dumpio: true,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  // 1. Find the extension's service worker target and read its ID.
  let swTarget = null;
  for (let attempt = 0; attempt < 20 && !swTarget; attempt++) {
    const all = browser.targets();
    if (attempt === 0 || attempt === 19) {
      console.log(
        `[attempt ${attempt}] targets:`,
        all.map((t) => `${t.type()}::${t.url()}`)
      );
    }
    swTarget = all.find(
      (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://")
    );
    if (!swTarget) await new Promise((r) => setTimeout(r, 500));
  }
  if (!swTarget) {
    errors.push("service worker did not register within timeout");
    const extPage = await browser.newPage();
    await extPage.goto("chrome://extensions");
    await extPage.evaluate(() => {
      document.querySelector("extensions-manager")?.setAttribute("dev-mode-forced", "true");
    });
    const debugInfo = await extPage.evaluate(() => {
      function deepText(root) {
        const out = [];
        const walker = (node) => {
          if (node.shadowRoot) walker(node.shadowRoot);
          for (const child of node.children ?? []) walker(child);
          if (node.textContent && node.children?.length === 0) out.push(node.textContent.trim());
        };
        walker(root);
        return out.filter(Boolean);
      }
      return deepText(document.body).join(" | ").slice(0, 3000);
    });
    console.log("chrome://extensions deep text:", debugInfo);
    await extPage.screenshot({ path: "scripts/debug-extensions-page.png" });
    await extPage.close();
  } else {
    console.log("Service worker URL:", swTarget.url());
  }
  const extensionId = swTarget ? new URL(swTarget.url()).host : null;

  if (extensionId) {
    // 2. Open the popup page directly and check for console errors.
    const popupPage = await browser.newPage();
    popupPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[popup console] ${msg.text()}`);
    });
    popupPage.on("pageerror", (err) => errors.push(`[popup pageerror] ${err.message}`));
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: "networkidle0",
    });
    await new Promise((r) => setTimeout(r, 500));
    const popupText = await popupPage.evaluate(() => document.body.innerText);
    console.log("Popup rendered text snippet:", JSON.stringify(popupText.slice(0, 120)));
    if (!popupText.includes("ClipKeep")) {
      errors.push("popup did not render expected 'ClipKeep' heading");
    }
    if (!popupText.includes("未接続") && !popupText.includes("接続")) {
      errors.push("popup did not render the not-connected banner as expected");
    }
    await popupPage.close();

    // 3. Open the options page and check for console errors.
    const optionsPage = await browser.newPage();
    optionsPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[options console] ${msg.text()}`);
    });
    optionsPage.on("pageerror", (err) => errors.push(`[options pageerror] ${err.message}`));
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: "networkidle0",
    });
    await new Promise((r) => setTimeout(r, 500));
    const optionsText = await optionsPage.evaluate(() => document.body.innerText);
    console.log("Options rendered text snippet:", JSON.stringify(optionsText.slice(0, 160)));
    if (!optionsText.includes("Notion接続")) {
      errors.push("options page did not render expected 'Notion接続' section");
    }
    await optionsPage.close();
  }
} finally {
  await browser.close();
}

if (errors.length > 0) {
  console.error("\nSMOKE TEST FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
} else {
  console.log("\nSMOKE TEST PASSED: extension loaded, service worker registered, popup and options rendered without console errors.");
}
