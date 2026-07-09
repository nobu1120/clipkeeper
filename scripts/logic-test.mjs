// Exercises the REAL compiled background message handler (freemium quota
// gating, Notion API request shaping, connection flow) in Node, with a
// stubbed `chrome` global and stubbed `fetch`. No browser required, so this
// works regardless of the Chrome Developer-Mode policy restriction.
import assert from "node:assert/strict";

const store = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: store.get(key) };
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
    },
  },
  contextMenus: {
    create() {},
    onClicked: { addListener() {} },
  },
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
  },
  notifications: { create() {} },
  tabs: { query: async () => [], sendMessage: async () => ({}) },
  scripting: { executeScript: async () => {} },
};

const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  const body = init?.body ? JSON.parse(init.body) : undefined;

  if (String(url).endsWith("/v1/users/me")) {
    const token = init.headers.Authorization;
    if (token === "Bearer good-token") {
      return jsonResponse(200, { name: "Test Workspace Bot" });
    }
    return jsonResponse(401, { message: "API token is invalid." });
  }

  if (String(url).endsWith("/v1/search")) {
    return jsonResponse(200, {
      results: [
        {
          id: "db-1",
          title: [{ plain_text: "Reading List" }],
          properties: {
            Name: { type: "title" },
            Tags: { type: "multi_select", multi_select: { options: [{ id: "t1", name: "tech" }] } },
          },
        },
        {
          id: "db-2",
          title: [{ plain_text: "Second DB" }],
          properties: { Name: { type: "title" } },
        },
      ],
    });
  }

  if (String(url).endsWith("/v1/pages")) {
    assert.equal(body.parent.database_id, "db-1", "page should be created under the selected database");
    assert.ok(body.children[0].paragraph.rich_text[0].text.content.startsWith("Source:"), "first child block should carry the source URL");
    return jsonResponse(200, { url: "https://notion.so/fake-page-id" });
  }

  throw new Error(`Unexpected fetch to ${url}`);
};

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

const { handleMessage } = await import("../dist-test/background.node.mjs");

// --- GET_PLAN defaults to free ---
assert.deepEqual(await handleMessage({ type: "GET_PLAN" }), { tier: "free" });

// --- Connection flow: bad token rejected, good token accepted ---
const badConn = await handleMessage({ type: "SET_CONNECTION", token: "bad-token" });
assert.equal(badConn.ok, false, "bad token should be rejected");

const goodConn = await handleMessage({ type: "SET_CONNECTION", token: "good-token" });
assert.equal(goodConn.ok, true, "good token should be accepted");

const connection = await handleMessage({ type: "GET_CONNECTION" });
assert.equal(connection.token, "good-token");

// --- Database registration respects the free-tier limit of 1 ---
const dbs = await handleMessage({ type: "GET_DATABASES" });
assert.equal(dbs.length, 2);

const reg1 = await handleMessage({ type: "REGISTER_DATABASE", database: dbs[0] });
assert.equal(reg1.ok, true, "first database registration should succeed on free plan");

const reg2 = await handleMessage({ type: "REGISTER_DATABASE", database: dbs[1] });
assert.equal(reg2.ok, false, "second database registration should be blocked on free plan (limit=1)");
assert.match(reg2.message, /データベース/);

// --- SAVE_CLIP happy path calls Notion pages API with correct shape ---
const saveResult = await handleMessage({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-1",
    title: "Test Clip",
    sourceUrl: "https://example.com/article",
    properties: [{ name: "Name", type: "title", value: "Test Clip" }],
    blocks: [{ type: "paragraph", text: "hello" }],
  },
});
assert.equal(saveResult.ok, true);
assert.equal(saveResult.pageUrl, "https://notion.so/fake-page-id");

// --- Free tier quota: after 19 more clips (20 total), the 21st is blocked ---
for (let i = 0; i < 19; i++) {
  const r = await handleMessage({
    type: "SAVE_CLIP",
    payload: {
      databaseId: "db-1",
      title: `Clip ${i}`,
      sourceUrl: "https://example.com/x",
      properties: [{ name: "Name", type: "title", value: `Clip ${i}` }],
      blocks: [],
    },
  });
  assert.equal(r.ok, true, `clip ${i} within free quota should succeed`);
}

const usageAtLimit = await handleMessage({ type: "GET_USAGE" });
assert.equal(usageAtLimit.clipCount, 20);

const blocked = await handleMessage({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-1",
    title: "Over limit",
    sourceUrl: "https://example.com/over",
    properties: [{ name: "Name", type: "title", value: "Over limit" }],
    blocks: [],
  },
});
assert.equal(blocked.ok, false);
assert.equal(blocked.errorCode, "QUOTA_EXCEEDED");

// --- License activation lifts the quota ---
const badLicense = await handleMessage({ type: "ACTIVATE_LICENSE", licenseKey: "not-a-real-key" });
assert.equal(badLicense.ok, false, "malformed license key should be rejected");

const goodLicense = await handleMessage({
  type: "ACTIVATE_LICENSE",
  licenseKey: "CLIPKEEP-PRO-AB12-CD34-EF56",
});
assert.equal(goodLicense.ok, true, "well-formed license key should activate Pro");

const proPlan = await handleMessage({ type: "GET_PLAN" });
assert.equal(proPlan.tier, "pro");

const unblockedAfterPro = await handleMessage({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-1",
    title: "Pro clip",
    sourceUrl: "https://example.com/pro",
    properties: [{ name: "Name", type: "title", value: "Pro clip" }],
    blocks: [],
  },
});
assert.equal(unblockedAfterPro.ok, true, "Pro plan should bypass the free clip quota");

// Pro plan should also allow registering a second database now.
const reg2AfterPro = await handleMessage({ type: "REGISTER_DATABASE", database: dbs[1] });
assert.equal(reg2AfterPro.ok, true, "Pro plan should allow a second database");

console.log(`\nAll assertions passed. (${fetchCalls.length} fetch calls made to the stubbed Notion API)`);
console.log("LOGIC TEST PASSED");
