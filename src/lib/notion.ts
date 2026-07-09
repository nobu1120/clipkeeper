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
    return { ok: true, workspaceName: data?.bot?.owner?.workspace ? data.name : data.name };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractPlainTitle(titleProp: any): string {
  if (!titleProp) return "Untitled";
  if (Array.isArray(titleProp.title)) {
    return titleProp.title.map((t: any) => t.plain_text).join("") || "Untitled";
  }
  return "Untitled";
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
  const res = await fetch(`${NOTION_API_BASE}/search`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      filter: { property: "object", value: "database" },
      page_size: 50,
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
  return (data.results as any[]).map((db) => ({
    id: db.id,
    title: Array.isArray(db.title)
      ? db.title.map((t: any) => t.plain_text).join("") || "Untitled"
      : "Untitled",
    properties: Object.entries(db.properties ?? {}).map(([name, prop]) =>
      toPropertySummary(name, prop)
    ),
  }));
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

export { extractPlainTitle };
