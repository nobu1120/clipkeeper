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
function __defaultState() {
  return {
    connections: [],
    activeConnectionId: null,
    plan: { tier: "free" },
    usage: { periodStart: new Date().toISOString(), clipCount: 3 },
    registeredDatabases: [],
  };
}
function __readState() {
  const raw = sessionStorage.getItem("__mockState");
  return raw ? JSON.parse(raw) : __defaultState();
}
function __writeState(s) { sessionStorage.setItem("__mockState", JSON.stringify(s)); }
function __activeConnection(s) { return s.connections.find((c) => c.id === s.activeConnectionId) ?? null; }

window.chrome = {
  runtime: {
    openOptionsPage: () => { window.__openOptionsCalled = true; },
    sendMessage: (msg) => {
      const s = __readState();
      switch (msg.type) {
        case "GET_CONNECTION": {
          const active = __activeConnection(s);
          return Promise.resolve(
            active
              ? { token: active.token, connectedAt: active.connectedAt, workspaceName: active.workspaceName }
              : { token: null, connectedAt: null, workspaceName: null }
          );
        }
        case "GET_CONNECTIONS":
          return Promise.resolve({ connections: s.connections, activeConnectionId: s.activeConnectionId });
        case "GET_PLAN": return Promise.resolve(s.plan);
        case "GET_USAGE": return Promise.resolve(s.usage);
        case "GET_REGISTERED_DATABASES":
          return Promise.resolve(s.registeredDatabases.filter((d) => d.connectionId === s.activeConnectionId));
        case "ADD_CONNECTION": {
          const id = "conn-" + (s.connections.length + 1);
          s.connections.push({
            id,
            token: msg.token,
            workspaceName: "Mock WS " + (s.connections.length + 1),
            connectedAt: new Date().toISOString(),
          });
          s.activeConnectionId = id;
          __writeState(s);
          return Promise.resolve({ ok: true });
        }
        case "REMOVE_CONNECTION": {
          s.connections = s.connections.filter((c) => c.id !== msg.connectionId);
          s.registeredDatabases = s.registeredDatabases.filter((d) => d.connectionId !== msg.connectionId);
          if (s.activeConnectionId === msg.connectionId) s.activeConnectionId = s.connections[0]?.id ?? null;
          __writeState(s);
          return Promise.resolve({ ok: true });
        }
        case "SET_ACTIVE_CONNECTION": {
          s.activeConnectionId = msg.connectionId;
          __writeState(s);
          return Promise.resolve({ ok: true });
        }
        case "GET_DATABASES":
          return Promise.resolve([
            { id: "db-1", title: "Reading List", properties: [{ name: "Name", type: "title" }, { name: "Tags", type: "multi_select", options: [{id:"t1",name:"tech"}] }] },
          ]);
        case "REGISTER_DATABASE":
          if (s.registeredDatabases.length >= 1) return Promise.resolve({ ok: false, message: "無料プランはデータベース1件までです。" });
          s.registeredDatabases.push({ id: msg.database.id, connectionId: s.activeConnectionId, title: msg.database.title, isDefaultForDomains: [], properties: msg.database.properties });
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
          connections: [],
          activeConnectionId: null,
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
    connections: [{ id: "conn-1", token: "good-token", connectedAt: "now", workspaceName: "Mock WS" }],
    activeConnectionId: "conn-1",
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
        connectionId: "conn-1",
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

  // Database selection is a dropdown (<select>), not a list of buttons.
  const dbSelectOptions = await optionsPage.$$eval("#available-db-select option", (opts) =>
    opts.map((o) => o.textContent)
  );
  assert.ok(dbSelectOptions.some((t) => t.includes("Reading List")), "the database dropdown should list Reading List");

  await optionsPage.click("#register-selected-db");
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("登録しました"), "options should confirm database registration");
  console.log("[options] register database via dropdown OK");

  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(!text.includes("ライセンスキー"), "options page must not show any license/purchase UI (MVP is free-only)");
  assert.equal(
    await optionsPage.$("#license-input"),
    null,
    "license key input must not be present in the free-only MVP build"
  );
  console.log("[options] no Pro/license UI present OK");

  // ---- Options page: connect a second Notion workspace and switch between them ----
  await optionsPage.type("#token-input", "good-token-2");
  await optionsPage.click("#connect");
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("Mock WS 1") && text.includes("Mock WS 2"), "both connected workspaces should be listed");
  assert.ok(text.includes("Mock WS 2（使用中）"), "the newly added second workspace should become active");
  console.log("[options] add second workspace OK");

  const switchClicked = await optionsPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("これに切り替え"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert.ok(switchClicked, "a switch-to-this-workspace button should be present for the inactive workspace");
  await new Promise((r) => setTimeout(r, 300));
  text = await optionsPage.evaluate(() => document.body.innerText);
  assert.ok(text.includes("切り替えました"), "options should confirm the workspace switch");
  assert.ok(text.includes("Mock WS 1（使用中）"), "switching back should make the first workspace active again");
  assert.ok(text.includes("Reading List"), "switching back to the first workspace should restore its own registered database");
  console.log("[options] switch workspace OK");

  await optionsPage.close();

  console.log("\nUI TEST PASSED");
} finally {
  await browser.close();
  server.close();
}
