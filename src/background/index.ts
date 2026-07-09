import {
  clearConnection,
  getConnection,
  getPlan,
  getRegisteredDatabases,
  getUsage,
  incrementUsage,
  setConnection,
  setRegisteredDatabases,
} from "../lib/storage";
import { checkClipQuota, checkDatabaseLimit, activateLicense, deactivateLicense } from "../lib/plan";
import { createPage, listDatabases, testConnection } from "../lib/notion";
import type {
  ExtensionMessage,
  ExtractedContent,
  SaveClipResponse,
} from "../lib/types";

const CONTEXT_MENU_PAGE = "clipkeep-save-page";
const CONTEXT_MENU_SELECTION = "clipkeep-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PAGE,
    title: "ClipKeepでこのページを保存",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SELECTION,
    title: "ClipKeepで選択範囲を保存",
    contexts: ["selection"],
  });
});

async function injectAndExtract(
  tabId: number,
  kind: "EXTRACT_CONTENT" | "EXTRACT_SELECTION"
): Promise<ExtractedContent> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: kind,
  } satisfies ExtensionMessage)) as ExtractedContent;
  return response;
}

function notify(title: string, message: string) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

async function quickSaveFromContextMenu(
  tabId: number,
  kind: "EXTRACT_CONTENT" | "EXTRACT_SELECTION"
) {
  try {
    const quota = await checkClipQuota();
    if (!quota.allowed) {
      notify("ClipKeep: 上限に達しました", quota.reason ?? "無料枠の上限です。");
      return;
    }
    const connection = await getConnection();
    if (!connection.token) {
      notify("ClipKeep: 未接続です", "オプション画面でNotionと接続してください。");
      return;
    }
    const databases = await getRegisteredDatabases();
    const target = databases[0];
    if (!target) {
      notify("ClipKeep: 保存先が未設定です", "オプション画面で保存先データベースを登録してください。");
      return;
    }
    const content = await injectAndExtract(tabId, kind);
    const result = await createPage({
      token: connection.token,
      databaseId: target.id,
      title: content.title,
      sourceUrl: content.url,
      properties: [{ name: "Name", type: "title", value: content.title }],
      blocks: content.blocks,
    });
    await incrementUsage();
    notify("ClipKeepに保存しました", content.title);
    void result;
  } catch (err) {
    notify("ClipKeep: 保存に失敗しました", (err as Error).message);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === CONTEXT_MENU_PAGE) {
    void quickSaveFromContextMenu(tab.id, "EXTRACT_CONTENT");
  } else if (info.menuItemId === CONTEXT_MENU_SELECTION) {
    void quickSaveFromContextMenu(tab.id, "EXTRACT_SELECTION");
  }
});

export async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "EXTRACT_CONTENT":
    case "EXTRACT_SELECTION": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("アクティブなタブが見つかりません。");
      return injectAndExtract(tab.id, message.type);
    }

    case "GET_CONNECTION":
      return getConnection();

    case "TEST_CONNECTION":
      return testConnection(message.token);

    case "SET_CONNECTION": {
      const test = await testConnection(message.token);
      if (!test.ok) {
        return { ok: false, message: test.message ?? "接続に失敗しました。" };
      }
      await setConnection({
        token: message.token,
        connectedAt: new Date().toISOString(),
        workspaceName: test.workspaceName ?? null,
      });
      return { ok: true };
    }

    case "DISCONNECT":
      await clearConnection();
      return { ok: true };

    case "GET_DATABASES": {
      const connection = await getConnection();
      if (!connection.token) throw new Error("Notionと接続されていません。");
      return listDatabases(connection.token);
    }

    case "GET_REGISTERED_DATABASES":
      return getRegisteredDatabases();

    case "REGISTER_DATABASE": {
      const limit = await checkDatabaseLimit();
      const existing = await getRegisteredDatabases();
      const alreadyRegistered = existing.some((d) => d.id === message.database.id);
      if (!alreadyRegistered && !limit.allowed) {
        return { ok: false, message: limit.reason };
      }
      const next = alreadyRegistered
        ? existing
        : [
            ...existing,
            {
              id: message.database.id,
              title: message.database.title,
              isDefaultForDomains: [],
              properties: message.database.properties,
            },
          ];
      await setRegisteredDatabases(next);
      return { ok: true };
    }

    case "UNREGISTER_DATABASE": {
      const existing = await getRegisteredDatabases();
      await setRegisteredDatabases(existing.filter((d) => d.id !== message.databaseId));
      return { ok: true };
    }

    case "SAVE_CLIP": {
      const quota = await checkClipQuota();
      if (!quota.allowed) {
        return {
          ok: false,
          errorCode: "QUOTA_EXCEEDED",
          message: quota.reason ?? "無料枠の上限に達しました。",
        } satisfies SaveClipResponse;
      }
      const connection = await getConnection();
      if (!connection.token) {
        return {
          ok: false,
          errorCode: "NOT_CONNECTED",
          message: "Notionと接続されていません。オプション画面で接続してください。",
        } satisfies SaveClipResponse;
      }
      try {
        const result = await createPage({
          token: connection.token,
          databaseId: message.payload.databaseId,
          title: message.payload.title,
          sourceUrl: message.payload.sourceUrl,
          properties: message.payload.properties,
          blocks: message.payload.blocks,
        });
        await incrementUsage();
        return { ok: true, pageUrl: result.pageUrl } satisfies SaveClipResponse;
      } catch (err) {
        return {
          ok: false,
          errorCode: "NOTION_API_ERROR",
          message: (err as Error).message,
        } satisfies SaveClipResponse;
      }
    }

    case "GET_USAGE":
      return getUsage();

    case "GET_PLAN":
      return getPlan();

    case "ACTIVATE_LICENSE": {
      const activated = await activateLicense(message.licenseKey);
      return { ok: activated };
    }

    case "DEACTIVATE_LICENSE":
      await deactivateLicense();
      return { ok: true };

    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, errorCode: "UNKNOWN", message: (err as Error).message }));
  return true; // keep the message channel open for the async response
});
