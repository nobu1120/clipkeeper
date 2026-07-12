import type {
  ClipRequestPropertyValue,
  NotionBlockDraft,
  NotionDatabaseSummary,
  NotionPropertySummary,
} from "./types";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class NotionApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export async function testConnection(token: string): Promise<{
  ok: boolean;
  workspaceName?: string;
  message?: string;
}> {
  try {
    const res = await fetch(`${NOTION_API_BASE}/users/me`, {
      headers: headers(token),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      return {
        ok: false,
        message: body?.message ?? `接続に失敗しました (HTTP ${res.status})`,
      };
    }
    const data = await res.json();
    return { ok: true, workspaceName: data?.bot?.workspace_name ?? data?.name };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Some Notion databases returned by /v1/search aren't ordinary
// user-created content databases — e.g. the auto-generated Teamspace
// "People" member directory is structurally a `database` object but
// Notion rejects creating ordinary pages/blocks under it. Recognize that
// class of validation error and append an actionable hint, since Notion's
// raw message alone doesn't explain what to do about it.
export function friendlyNotionErrorMessage(raw: string): string {
  if (/cannot be parented to the .+ collection record/i.test(raw)) {
    return (
      `${raw}\n\n選択したデータベースは、Notionが自動生成する「People」（ワークスペースメンバー一覧）` +
      "のようなシステム管理用コレクションの可能性があります。通常のページを保存できないため、" +
      "オプション画面で別のデータベースを選び直してください。"
    );
  }
  return raw;
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toPropertySummary(name: string, prop: any): NotionPropertySummary {
  const type = prop.type;
  const options =
    type === "select"
      ? prop.select?.options
      : type === "multi_select"
        ? prop.multi_select?.options
        : undefined;
  return { name, type, options };
}

export async function listDatabases(
  token: string
): Promise<NotionDatabaseSummary[]> {
  const results: any[] = [];
  let startCursor: string | undefined;

  // Notion's /v1/search paginates at 100 results max per request. A fixed
  // single request (previously capped at page_size: 50) silently dropped
  // any databases beyond the first page for integrations connected to many
  // databases. Follow has_more/next_cursor until every page is fetched.
  for (;;) {
    const res = await fetch(`${NOTION_API_BASE}/search`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        filter: { property: "object", value: "database" },
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw new NotionApiError(
        body?.message ?? `データベース一覧の取得に失敗しました (HTTP ${res.status})`,
        res.status
      );
    }
    const data = await res.json();
    results.push(...(data.results as any[]));
    if (!data.has_more || !data.next_cursor) break;
    startCursor = data.next_cursor as string;
  }

  return results
    .map((db) => ({
      id: db.id,
      title: Array.isArray(db.title)
        ? db.title.map((t: any) => t.plain_text).join("") || "Untitled"
        : "Untitled",
      properties: Object.entries(db.properties ?? {}).map(([name, prop]) =>
        toPropertySummary(name, prop)
      ),
    }))
    .filter((db) => !isNotionSystemCollection(db.title));
}

// Notion auto-generates certain database-shaped objects that /v1/search
// returns alongside real, user-created databases — most notably the
// Teamspace "People" member directory. These look like ordinary databases
// but reject page creation with a Notion-side validation error ("cannot be
// parented to the ... collection record"), so they're never a valid save
// destination. Filter them out by their fixed, Notion-assigned title so
// they never show up as a choice in the first place.
//
// This is a title-match heuristic, not a definitive API flag (Notion's
// search API doesn't expose one) — a workspace with its own legitimately
// named "People" database would also be hidden. That tradeoff is
// intentional: showing a database that reliably fails to save is worse
// than hiding one exact-name edge case.
const NOTION_SYSTEM_COLLECTION_TITLES = new Set(["People"]);

function isNotionSystemCollection(title: string): boolean {
  return NOTION_SYSTEM_COLLECTION_TITLES.has(title);
}

function blockToNotion(block: NotionBlockDraft): any {
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return {
        object: "block",
        type: block.type,
        [block.type]: { rich_text: [{ type: "text", text: { content: block.text } }] },
      };
    case "image":
      return {
        object: "block",
        type: "image",
        image: { type: "external", external: { url: block.url } },
      };
    case "code":
      return {
        object: "block",
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: block.text.slice(0, 2000) } }],
          language: block.language ?? "plain text",
        },
      };
    case "quote":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "paragraph":
    default:
      return {
        object: "block",
        type: block.type,
        [block.type]: {
          rich_text: [{ type: "text", text: { content: block.text.slice(0, 2000) } }],
        },
      };
  }
}

function propertyValueToNotion(prop: ClipRequestPropertyValue): any {
  switch (prop.type) {
    case "title":
      return { title: [{ type: "text", text: { content: String(prop.value) } }] };
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: String(prop.value) } }] };
    case "url":
      return { url: String(prop.value) };
    case "date":
      return prop.value ? { date: { start: String(prop.value) } } : { date: null };
    case "select":
      return prop.value ? { select: { name: String(prop.value) } } : { select: null };
    case "multi_select":
      return {
        multi_select: (Array.isArray(prop.value) ? prop.value : [prop.value])
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    default:
      return undefined;
  }
}

export async function createPage(params: {
  token: string;
  databaseId: string;
  title: string;
  sourceUrl: string;
  properties: ClipRequestPropertyValue[];
  blocks: NotionBlockDraft[];
}): Promise<{ pageUrl: string }> {
  const { token, databaseId, title, sourceUrl, properties, blocks } = params;

  const propertiesPayload: Record<string, any> = {};
  for (const prop of properties) {
    const value = propertyValueToNotion(prop);
    if (value !== undefined) propertiesPayload[prop.name] = value;
  }
  // Ensure the title property is always set even if caller didn't map one.
  if (!Object.values(propertiesPayload).some((v) => "title" in (v ?? {}))) {
    const titleKey = properties.find((p) => p.type === "title")?.name ?? "Name";
    propertiesPayload[titleKey] = { title: [{ type: "text", text: { content: title } }] };
  }

  const res = await fetch(`${NOTION_API_BASE}/pages`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: propertiesPayload,
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", text: { content: `Source: ${sourceUrl}`, link: { url: sourceUrl } } },
            ],
          },
        },
        ...blocks.slice(0, 95).map(blockToNotion),
      ],
    }),
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new NotionApiError(
      body?.message ?? `保存に失敗しました (HTTP ${res.status})`,
      res.status
    );
  }
  const data = await res.json();
  return { pageUrl: data.url as string };
}
