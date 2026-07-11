import {
  getActiveConnection,
  getActiveConnectionId,
  getConnection,
  getConnections,
  getPlan,
  getRegisteredDatabases,
  getUsage,
  incrementUsage,
  setActiveConnectionId,
  setConnections,
  setRegisteredDatabases,
} from "../lib/storage";
import { checkClipQuota, checkDatabaseLimit, activateLicense, deactivateLicense } from "../lib/plan";
import { createPage, friendlyNotionErrorMessage, listDatabases, testConnection } from "../lib/notion";
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
    const connection = await getActiveConnection();
    if (!connection) {
      notify("ClipKeep: 未接続です", "オプション画面でNotionと接続してください。");
      return;
    }
    const databases = await getRegisteredDatabases(connection.id);
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
    notify("ClipKeep: 保存に失敗しました", friendlyNotionErrorMessage((err as Error).message));
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

    case "GET_CONNECTIONS": {
      const [connections, activeConnectionId] = await Promise.all([
        getConnections(),
        getActiveConnectionId(),
      ]);
      return { connections, activeConnectionId };
    }

    case "TEST_CONNECTION":
      return testConnection(message.token);

    case "ADD_CONNECTION": {
      const test = await testConnection(message.token);
      if (!test.ok) {
        return { ok: false, message: test.message ?? "接続に失敗しました。" };
      }
      const connections = await getConnections();
      if (connections.some((c) => c.token === message.token)) {
        return { ok: false, message: "このワークスペースは既に接続済みです。" };
      }
      const newConnection = {
        id: crypto.randomUUID(),
        token: message.token,
        workspaceName: test.workspaceName ?? null,
        connectedAt: new Date().toISOString(),
      };
      await setConnections([...connections, newConnection]);
      await setActiveConnectionId(newConnection.id);
      return { ok: true };
    }

    case "REMOVE_CONNECTION": {
      const [connections, activeConnectionId, databases] = await Promise.all([
        getConnections(),
        getActiveConnectionId(),
        getRegisteredDatabases(),
      ]);
      const remaining = connections.filter((c) => c.id !== message.connectionId);
      await setConnections(remaining);
      await setRegisteredDatabases(databases.filter((d) => d.connectionId !== message.connectionId));
      if (activeConnectionId === message.connectionId) {
        await setActiveConnectionId(remaining[0]?.id ?? null);
      }
      return { ok: true };
    }

    case "SET_ACTIVE_CONNECTION": {
      const connections = await getConnections();
      if (!connections.some((c) => c.id === message.connectionId)) {
        return { ok: false, message: "指定されたワークスペースが見つかりません。" };
      }
      await setActiveConnectionId(message.connectionId);
      return { ok: true };
    }

    case "GET_DATABASES": {
      const connection = await getActiveConnection();
      if (!connection) throw new Error("Notionと接続されていません。");
      return listDatabases(connection.token);
    }

    case "GET_REGISTERED_DATABASES": {
      const connection = await getActiveConnection();
      return connection ? getRegisteredDatabases(connection.id) : [];
    }

    case "REGISTER_DATABASE": {
      const connection = await getActiveConnection();
      if (!connection) return { ok: false, message: "Notionと接続されていません。" };
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
              connectionId: connection.id,
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
      const connection = await getActiveConnection();
      if (!connection) {
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
          message: friendlyNotionErrorMessage((err as Error).message),
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
