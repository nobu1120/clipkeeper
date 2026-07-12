export interface ExtractedContent {
  title: string;
  url: string;
  siteName: string | null;
  excerpt: string | null;
  byline: string | null;
  publishedTime: string | null;
  blocks: NotionBlockDraft[];
}

export type NotionBlockDraft =
  | { type: "heading_1" | "heading_2" | "heading_3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "bulleted_list_item"; text: string }
  | { type: "numbered_list_item"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "image"; url: string };

export interface NotionDatabaseSummary {
  id: string;
  title: string;
  properties: NotionPropertySummary[];
}

export interface NotionPropertySummary {
  name: string;
  type: string;
  options?: { id: string; name: string; color?: string }[];
}

export interface ClipRequestPropertyValue {
  name: string;
  type: string;
  value: string | string[];
}

export interface SaveClipRequest {
  databaseId: string;
  title: string;
  sourceUrl: string;
  properties: ClipRequestPropertyValue[];
  blocks: NotionBlockDraft[];
}

export interface SaveClipResult {
  ok: true;
  pageUrl: string;
}

export interface SaveClipError {
  ok: false;
  errorCode:
    | "NOT_CONNECTED"
    | "QUOTA_EXCEEDED"
    | "NOTION_API_ERROR"
    | "NETWORK_ERROR"
    | "UNKNOWN";
  message: string;
}

export type SaveClipResponse = SaveClipResult | SaveClipError;

export interface UsageState {
  periodStart: string; // ISO date, first of month
  clipCount: number;
}

export interface PlanState {
  tier: "free" | "pro";
  licenseKey?: string;
}

export const FREE_MONTHLY_CLIP_LIMIT = 20;
export const FREE_MAX_DATABASES = 1;

// A single Notion workspace connection. Internal Integration Tokens are
// inherently scoped to one workspace each (Notion has no "pick a workspace"
// concept for this auth style, unlike OAuth) — so supporting multiple
// workspaces means storing multiple named connections and letting the user
// switch which one is active, rather than a single global token.
export interface NotionConnection {
  id: string;
  token: string;
  workspaceName: string | null;
  connectedAt: string;
}

// Legacy single-connection shape, derived from whichever NotionConnection is
// currently active. Kept so simple consumers (the popup) don't need to know
// about multi-workspace management.
export interface ConnectionState {
  token: string | null;
  connectedAt: string | null;
  workspaceName: string | null;
}

export interface RegisteredDatabase {
  id: string;
  connectionId: string;
  title: string;
  properties: NotionPropertySummary[];
}

// Runtime message protocol between popup/options <-> background <-> content script
export type ExtensionMessage =
  | { type: "EXTRACT_CONTENT" }
  | { type: "EXTRACT_SELECTION" }
  | { type: "GET_DATABASES"; forceRefresh?: boolean }
  | { type: "SAVE_CLIP"; payload: SaveClipRequest }
  | { type: "GET_USAGE" }
  | { type: "GET_CONNECTION" }
  | { type: "GET_CONNECTIONS" }
  | { type: "TEST_CONNECTION"; token: string }
  | { type: "ADD_CONNECTION"; token: string }
  | { type: "REMOVE_CONNECTION"; connectionId: string }
  | { type: "SET_ACTIVE_CONNECTION"; connectionId: string }
  | { type: "REGISTER_DATABASE"; database: NotionDatabaseSummary }
  | { type: "UNREGISTER_DATABASE"; databaseId: string }
  | { type: "GET_REGISTERED_DATABASES" }
  | { type: "GET_REMEMBERED_DATABASE"; hostname: string }
  | { type: "REMEMBER_DATABASE"; hostname: string; databaseId: string }
  | { type: "GET_PLAN" }
  | { type: "ACTIVATE_LICENSE"; licenseKey: string }
  | { type: "DEACTIVATE_LICENSE" };
