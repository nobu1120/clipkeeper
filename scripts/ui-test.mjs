// Renders the real popup.html / options.html (from dist/) in a normal Chrome
// page with a mocked chrome.runtime.sendMessage, driving the actual popup.ts
// / options.ts code through a full user flow. This validates the UI logic
// without needing the extension to be loaded via Developer Mode.
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { startStaticServer } from "./static-server.mjs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const { server, baseUrl } = await startStaticServer("dist");
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

// State lives in sessionStorage (not a plain JS var) so it survives
// page.reload(), since evaluateOnNewDocument re-runs this script on every
// navigation and would otherwise reset an in-memory variable each time.
const MOCK_CHROME_SRC = `
function __readState() {
  const raw = sessionStorage.getItem("__mockState");
  return raw ? JSON.parse(raw) : {
    connection: { token: null, connectedAt: null, workspaceName: null },
    plan: { tier: "free" },
    usage: { periodStart: new Date().toISOString(), clipCount: 3 },
    registeredDatabases: [],
  };
}
function __writeState(s) { sessionStorage.setItem("__mockState", JSON.stringify(s)); }

window.chrome = {
  runtime: {
    openOptionsPage: () => { window.__openOptionsCalled = true; },
    sendMessage: (msg) => {
      const s = __readState();
      switch (msg.type) {
        case "GET_CONNECTION": return Promise.resolve(s.connection);
        case "GET_PLAN": return Promise.resolve(s.plan);
        case "GET_USAGE": return Promise.resolve(s.usage);
        case "GET_REGISTERED_DATABASES": return Promise.resolve(s.registeredDatabases);
        case "SET_CONNECTION":
          s.connection = { token: msg.token, connectedAt: new Date().toISOString(), workspaceName: "Mock WS" };
          __writeState(s);
          return Promise.resolve({ ok: true });
        case "DISCONNECT":
          s.connection = { token: null, connectedAt: null, workspaceName: null };
          __writeState(s);
          return Promise.resolve({ ok: true });
        case "GET_DATABASES":
          return Promise.resolve([
            { id: "db-1", title: "Reading List", properties: [{ name: "Name", type: "title" }, { name: "Tags", type: "multi_select", options: [{id:"t1",name:"tech"}] }] },
          ]);
        case "REGISTER_DATABASE":
          if (s.registeredDatabases.length >= 1) return Promise.resolve({ ok: false, message: "無料プランはデータベース1件までです。" });
          s.registeredDatabases.push({ id: msg.database.id, title: msg.database.title, isDefaultForDomains: [], properties: msg.database.properties });
          __writeState(s);
          return Promise.resolve({ ok: true });
        case "EXTRACT_CONTENT":
          return Promise.resolve({ title: "モック記事タイトル", url: "https://example.com/mock", siteName: null, excerpt: null, blocks: [{ type: "paragraph", text: "モック本文" }] });
        case "SAVE_CLIP":
          s.usage.clipCount += 1;
          __writeState(s);
          return Promise.resolve({ ok: true, pageUrl: "https://notion.so/mock-page" });
        case "ACTIVATE_LICENSE":
          return Promise.resolve({ ok: /^CLIPKEEP-PRO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(msg.licenseKey) });
        case "DEACTIVATE_LICENSE":
          s.plan = { tier: "free" };
          __writeState(s);
          return Promise.resolve({ ok: true });
        default:
          return Promise.resolve(undefined);
      }
    },
  },
};
`;

function setMockState(page, patch) {
  return page.evaluate((patchJson) => {
    const raw = sessionStorage.getItem("__mockState");
    const s = raw
      ? JSON.parse(raw)
      : {
          connection: { token: null, connectedAt: null, workspaceName: null },
          plan: { tier: "free" },
          usage: { periodStart: new Date().toISOString(), clipCount: 3 },
          registeredDatabases: [],
        };
    Object.assign(s, JSON.parse(patchJson));
    sessionStorage.setItem("__mockState", JSON.stringify(s));
  }, JSON.stringify(patch));
}

try {
  // ---- Popup: not-connected state ----
  const popupPage = await browser.newPage();
  popupPage.on("pageerror", (e) => {
    throw new Error(`[popup pageerror] ${e.message}`);
  });
  await popupPage.evaluateOnNewDocument(MOCK_CHROME_SRC);
  await popupPage.goto(`${baseUrl}/popup/popup.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  let text = await popupPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("未接続"), "popup should show not-connected banner");
  console.log("[popup] not-connected state OK");

  // ---- Popup: connected, no databases registered ----
  await setMockState(popupPage, {
    connection: { token: "good-token", connectedAt: "now", workspaceName: "Mock WS" },
  });
  await popupPage.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  text = await popupPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("データベースが未登録"), "popup should prompt to register a database");
  console.log("[popup] connected-but-no-db state OK");

  // ---- Popup: full clip -> save flow ----
  await setMockState(popupPage, {
    registeredDatabases: [
      {
        id: "db-1",
        title: "Reading List",
        isDefaultForDomains: [],
        properties: [
          { name: "Name", type: "title" },
          { name: "Tags", type: "multi_select", options: [{ id: "t1", name: "tech" }] },
        ],
      },
    ],
  });
  await popupPage.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  await popupPage.click("#extract-page");
  await new Promise((r) => setTimeout(r, 300));
  text = await popupPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("Reading List"), "clip form should show the registered database");
  const titleValue = await popupPage.$eval("#title-input", (el) => el.value);
  assert.equal(titleValue, "モック記事タイトル", "title field should be pre-filled from extraction");

  // select the "tech" tag option before saving
  const tagClicked = await popupPage.evaluate(() => {
    const tag = Array.from(document.querySelectorAll(".tag-option")).find((el) =>
      el.textContent.includes("tech")
    );
    if (!tag) return false;
    tag.click();
    return true;
  });
  assert.ok(tagClicked, "tag option 'tech' should be present and clickable");

  await popupPage.click("#save-clip");
  await new Promise((r) => setTimeout(r, 400));
  text = await popupPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("保存しました"), "popup should show success banner after save");
  console.log("[popup] extract -> tag -> save flow OK");

  await popupPage.close();

  // ---- Options page: connect, fetch databases, register, hit free-tier limit ----
  const optionsPage = await browser.newPage();
  optionsPage.on("pageerror", (e) => {
    throw new Error(`[options pageerror] ${e.message}`);
  });
  await optionsPage.evaluateOnNewDocument(MOCK_CHROME_SRC);
  await optionsPage.goto(`${baseUrl}/options/options.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));

  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("Notion接続"), "options page should render the connection section");

  await optionsPage.type("#token-input", "good-token");
  await optionsPage.click("#connect");
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(
    text.includes("接続しました") || text.includes("接続済み"),
    "options should reflect successful connection"
  );
  console.log("[options] connect flow OK");

  await optionsPage.click("#fetch-databases");
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("Reading List"), "fetched database list should include Reading List");

  const registerButtons = await optionsPage.$$("button.primary");
  const registerBtn = registerButtons[registerButtons.length - 1];
  await registerBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("登録しました"), "options should confirm database registration");
  console.log("[options] register database OK");

  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(!text.includes("ライセンスキー"), "options page must not show any license/purchase UI (MVP is free-only)");
  assert.equal(
    await optionsPage.$("#license-input"),
    null,
    "license key input must not be present in the free-only MVP build"
  );
  console.log("[options] no Pro/license UI present OK");

  await optionsPage.close();

  console.log("\nUI TEST PASSED");
} finally {
  await browser.close();
  server.close();
}
