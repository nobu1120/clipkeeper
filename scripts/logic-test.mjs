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
      return jsonResponse(200, { bot: { workspace_name: "First Workspace" }, name: "First Integration" });
    }
    if (token === "Bearer good-token-2") {
      return jsonResponse(200, { bot: { workspace_name: "Second Workspace" }, name: "Second Integration" });
    }
    return jsonResponse(401, { message: "API token is invalid." });
  }

  if (String(url).endsWith("/v1/search")) {
    // Simulate a second Notion search results page to verify listDatabases()
    // follows has_more/next_cursor instead of only ever fetching page one
    // (previously a fixed page_size: 50 silently dropped anything beyond
    // the first page for integrations connected to many databases).
    if (body?.start_cursor === "cursor-page-2") {
      return jsonResponse(200, {
        results: [
          {
            id: "db-3",
            title: [{ plain_text: "Third DB (page 2)" }],
            properties: { Name: { type: "title" } },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    }
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
        {
          id: "db-people",
          title: [{ plain_text: "People" }],
          properties: { Name: { type: "title" } },
        },
      ],
      has_more: true,
      next_cursor: "cursor-page-2",
    });
  }

  if (String(url).endsWith("/v1/pages")) {
    if (body.parent.database_id === "db-people") {
      // Real-world Notion error seen when saving into an auto-generated
      // system collection (e.g. the Teamspace "People" member directory)
      // instead of an ordinary user-created database.
      return jsonResponse(400, {
        message:
          "The request failed validation. Error: Unsaved transactions: Block with ID 39a59a05-dd07-81a7-bc5d-cc7db5705766 cannot be parented to the People collection record",
      });
    }
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
const badConn = await handleMessage({ type: "ADD_CONNECTION", token: "bad-token" });
assert.equal(badConn.ok, false, "bad token should be rejected");

const goodConn = await handleMessage({ type: "ADD_CONNECTION", token: "good-token" });
assert.equal(goodConn.ok, true, "good token should be accepted");

const connection = await handleMessage({ type: "GET_CONNECTION" });
assert.equal(connection.token, "good-token");
assert.equal(connection.workspaceName, "First Workspace", "workspaceName should come from bot.workspace_name, not the integration name");

const dupeConn = await handleMessage({ type: "ADD_CONNECTION", token: "good-token" });
assert.equal(dupeConn.ok, false, "adding the same token twice should be rejected");

// --- GET_DATABASES follows Notion search pagination across multiple pages ---
const searchCallsBefore = fetchCalls.filter((c) => c.url.endsWith("/v1/search")).length;
const dbs = await handleMessage({ type: "GET_DATABASES" });
assert.equal(dbs.length, 3, "should include the database from the second search results page, not just the first, but exclude the system-managed People collection");
assert.ok(dbs.some((d) => d.id === "db-3"), "database from page 2 (via next_cursor) should be present");
assert.ok(!dbs.some((d) => d.title === "People"), "Notion's auto-generated People collection must never be selectable as a save destination");
const searchCallsAfter = fetchCalls.filter((c) => c.url.endsWith("/v1/search")).length;
assert.equal(searchCallsAfter - searchCallsBefore, 2, "listing databases should follow has_more/next_cursor across exactly 2 pages here");

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

// --- Concurrency: two SAVE_CLIP calls fired simultaneously with exactly one
// slot remaining must not both succeed. A separate check-then-later-
// increment (the previous implementation) left a window where both could
// read the same "1 remaining" count before either wrote back, letting usage
// exceed the free limit. reserveClipQuota() must serialize check+increment
// as one operation regardless of call order. ---
const usageBeforeConcurrent = await handleMessage({ type: "GET_USAGE" });
store.set("clipkeep.usage", { periodStart: usageBeforeConcurrent.periodStart, clipCount: 19 });
const concurrentPayload = (label) => ({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-1",
    title: `Concurrent ${label}`,
    sourceUrl: `https://example.com/concurrent-${label}`,
    properties: [{ name: "Name", type: "title", value: `Concurrent ${label}` }],
    blocks: [],
  },
});
const concurrentResults = await Promise.all([
  handleMessage(concurrentPayload("A")),
  handleMessage(concurrentPayload("B")),
]);
const concurrentSucceeded = concurrentResults.filter((r) => r.ok);
const concurrentFailed = concurrentResults.filter((r) => !r.ok);
assert.equal(
  concurrentSucceeded.length,
  1,
  "exactly one of two concurrent saves at the quota boundary should succeed"
);
assert.equal(concurrentFailed.length, 1, "the other concurrent save should be quota-blocked");
assert.equal(concurrentFailed[0].errorCode, "QUOTA_EXCEEDED");
const usageAfterConcurrent = await handleMessage({ type: "GET_USAGE" });
assert.equal(
  usageAfterConcurrent.clipCount,
  20,
  "usage must not exceed the free limit even under concurrent saves"
);

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

// --- Saving into a Notion system collection (e.g. the "People" member
// directory) surfaces Notion's raw error plus an actionable hint, instead
// of just the bare validation message. It must also release the quota
// slot it reserved before the failed save, so a rejected save doesn't
// silently cost the user a clip. ---
const usageBeforePeopleFailure = await handleMessage({ type: "GET_USAGE" });
const peopleCollectionResult = await handleMessage({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-people",
    title: "Should fail",
    sourceUrl: "https://example.com/people",
    properties: [{ name: "Name", type: "title", value: "Should fail" }],
    blocks: [],
  },
});
assert.equal(peopleCollectionResult.ok, false);
assert.equal(peopleCollectionResult.errorCode, "NOTION_API_ERROR");
assert.ok(
  peopleCollectionResult.message.includes("cannot be parented to the People collection record"),
  "Notion's raw error message should still be included"
);
assert.ok(
  peopleCollectionResult.message.includes("別のデータベースを選び直してください"),
  "a friendly actionable hint should be appended for this error class"
);
const usageAfterPeopleFailure = await handleMessage({ type: "GET_USAGE" });
assert.equal(
  usageAfterPeopleFailure.clipCount,
  usageBeforePeopleFailure.clipCount,
  "a failed save must release its reserved quota slot, not consume it"
);

// --- Property auto-mapping: a "date"-type property must translate to
// Notion's { date: { start } } shape (previously unsupported — only
// title/rich_text/url/select/multi_select were handled). ---
const dateSaveResult = await handleMessage({
  type: "SAVE_CLIP",
  payload: {
    databaseId: "db-1",
    title: "Dated Clip",
    sourceUrl: "https://example.com/dated",
    properties: [
      { name: "Name", type: "title", value: "Dated Clip" },
      { name: "Published", type: "date", value: "2026-07-01" },
    ],
    blocks: [],
  },
});
assert.equal(dateSaveResult.ok, true, "save with a date property should succeed");
const dateSaveBody = JSON.parse(fetchCalls[fetchCalls.length - 1].init.body);
assert.deepEqual(
  dateSaveBody.properties.Published,
  { date: { start: "2026-07-01" } },
  "a date-type property should translate to Notion's { date: { start } } shape"
);

// --- Domain-remembered database: GET_REMEMBERED_DATABASE / REMEMBER_DATABASE
// round-trip, so quick-save and the popup can default to the database a
// given site's clips were last saved to instead of always the first
// registered one. ---
const noMemoryYet = await handleMessage({ type: "GET_REMEMBERED_DATABASE", hostname: "example.com" });
assert.equal(noMemoryYet.databaseId, null, "no database should be remembered for a domain never saved to");

const remember = await handleMessage({ type: "REMEMBER_DATABASE", hostname: "example.com", databaseId: "db-1" });
assert.equal(remember.ok, true);

const remembered = await handleMessage({ type: "GET_REMEMBERED_DATABASE", hostname: "example.com" });
assert.equal(remembered.databaseId, "db-1", "the remembered database should be returned for the same hostname");

const rememberedForOtherHost = await handleMessage({
  type: "GET_REMEMBERED_DATABASE",
  hostname: "other-site.example",
});
assert.equal(
  rememberedForOtherHost.databaseId,
  null,
  "a different hostname must not share another domain's remembered database"
);

const rememberStale = await handleMessage({
  type: "REMEMBER_DATABASE",
  hostname: "stale.example",
  databaseId: "db-does-not-exist",
});
assert.equal(rememberStale.ok, true);
const staleLookup = await handleMessage({ type: "GET_REMEMBERED_DATABASE", hostname: "stale.example" });
assert.equal(
  staleLookup.databaseId,
  null,
  "a remembered database id that's no longer registered should be ignored, not returned"
);

// Pro plan should also allow registering a second database now.
const reg2AfterPro = await handleMessage({ type: "REGISTER_DATABASE", database: dbs[1] });
assert.equal(reg2AfterPro.ok, true, "Pro plan should allow a second database");

// --- Multi-workspace: connecting a second workspace must not lose the
// first, must scope registered databases per workspace, and must let the
// user switch/remove workspaces independently. ---
const { connections: connsAfterFirst, activeConnectionId: firstId } = await handleMessage({
  type: "GET_CONNECTIONS",
});
assert.equal(connsAfterFirst.length, 1, "should have exactly one connection so far");
assert.equal(firstId, connsAfterFirst[0].id, "the only connection should be active");

const addSecond = await handleMessage({ type: "ADD_CONNECTION", token: "good-token-2" });
assert.equal(addSecond.ok, true, "second workspace token should be accepted");

const { connections: connsAfterSecond, activeConnectionId: secondId } = await handleMessage({
  type: "GET_CONNECTIONS",
});
assert.equal(connsAfterSecond.length, 2, "both workspaces should now be listed");
assert.notEqual(secondId, firstId, "newly added workspace should become the active one");
const secondConn = connsAfterSecond.find((c) => c.id === secondId);
assert.equal(secondConn.workspaceName, "Second Workspace");

// A freshly connected second workspace has no databases registered yet —
// this is the actual bug being guarded against: previously all workspaces
// shared one global registered-database list.
const dbsForSecond = await handleMessage({ type: "GET_REGISTERED_DATABASES" });
assert.equal(dbsForSecond.length, 0, "second workspace should start with no registered databases of its own");

// Switching back to the first workspace should show its own 2 registered databases again.
const switchBack = await handleMessage({ type: "SET_ACTIVE_CONNECTION", connectionId: firstId });
assert.equal(switchBack.ok, true);
const dbsForFirst = await handleMessage({ type: "GET_REGISTERED_DATABASES" });
assert.equal(dbsForFirst.length, 2, "switching back to the first workspace should restore its own registered databases");
assert.ok(dbsForFirst.every((d) => d.connectionId === firstId), "registered databases should be tagged with their owning connection");

// Removing the (inactive) second workspace should leave the first workspace untouched and still active.
const removeSecond = await handleMessage({ type: "REMOVE_CONNECTION", connectionId: secondId });
assert.equal(removeSecond.ok, true);
const { connections: connsAfterRemove, activeConnectionId: activeAfterRemove } = await handleMessage({
  type: "GET_CONNECTIONS",
});
assert.equal(connsAfterRemove.length, 1, "only the first workspace should remain");
assert.equal(activeAfterRemove, firstId, "removing an inactive workspace should not change the active one");

// Removing the currently-active workspace should fall back to whatever remains (none, here).
const removeFirst = await handleMessage({ type: "REMOVE_CONNECTION", connectionId: firstId });
assert.equal(removeFirst.ok, true);
const { connections: connsAfterRemoveAll, activeConnectionId: activeAfterRemoveAll } = await handleMessage({
  type: "GET_CONNECTIONS",
});
assert.equal(connsAfterRemoveAll.length, 0, "no workspaces should remain");
assert.equal(activeAfterRemoveAll, null, "active connection should fall back to null once the last workspace is removed");
assert.deepEqual(await handleMessage({ type: "GET_REGISTERED_DATABASES" }), [], "no active connection means no registered databases");

console.log(`\nAll assertions passed. (${fetchCalls.length} fetch calls made to the stubbed Notion API)`);
console.log("LOGIC TEST PASSED");
