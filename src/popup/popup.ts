import { sendMessage } from "../lib/messaging";
import type {
  ClipRequestPropertyValue,
  ConnectionState,
  ExtractedContent,
  NotionPropertySummary,
  PlanState,
  RegisteredDatabase,
  SaveClipResponse,
  UsageState,
} from "../lib/types";
import { FREE_MONTHLY_CLIP_LIMIT } from "../lib/types";

const app = document.getElementById("app")!;

interface PopupState {
  connection: ConnectionState;
  plan: PlanState;
  usage: UsageState;
  databases: RegisteredDatabase[];
  selectedDatabaseId: string | null;
  extracted: ExtractedContent | null;
  extractMode: "EXTRACT_CONTENT" | "EXTRACT_SELECTION";
  title: string;
  propertyValues: Record<string, string | string[]>;
  saving: boolean;
  result: SaveClipResponse | null;
}

let state: PopupState;

async function loadState(): Promise<void> {
  const [connection, plan, usage, databases] = await Promise.all([
    sendMessage<ConnectionState>({ type: "GET_CONNECTION" }),
    sendMessage<PlanState>({ type: "GET_PLAN" }),
    sendMessage<UsageState>({ type: "GET_USAGE" }),
    sendMessage<RegisteredDatabase[]>({ type: "GET_REGISTERED_DATABASES" }),
  ]);
  state = {
    connection,
    plan,
    usage,
    databases,
    selectedDatabaseId: databases[0]?.id ?? null,
    extracted: null,
    extractMode: "EXTRACT_CONTENT",
    title: "",
    propertyValues: {},
    saving: false,
    result: null,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function render(): void {
  app.innerHTML = "";

  app.append(
    el("h1", {}, ["ClipKeep for Notion"]),
    el("p", { class: "subtitle" }, ["Notionへ確実に、タグ付けして保存"])
  );

  if (!state.connection.token) {
    app.append(
      el("div", { class: "banner error" }, [
        "Notionと未接続です。オプション画面で接続してください。",
      ]),
      el("button", { class: "primary", id: "open-options" }, ["接続する"])
    );
    app.querySelector("#open-options")!.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const remaining =
    state.plan.tier === "pro"
      ? "無制限 (Pro)"
      : `${Math.max(FREE_MONTHLY_CLIP_LIMIT - state.usage.clipCount, 0)} / ${FREE_MONTHLY_CLIP_LIMIT} 件`;
  app.append(el("div", { class: "usage" }, [el("span", {}, ["今月の残りクリップ数"]), el("span", {}, [remaining])]));

  if (state.databases.length === 0) {
    app.append(
      el("div", { class: "banner error" }, [
        "保存先データベースが未登録です。オプション画面で登録してください。",
      ]),
      el("button", { class: "primary", id: "open-options" }, ["オプションを開く"])
    );
    app.querySelector("#open-options")!.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  if (!state.extracted) {
    app.append(
      el("div", { class: "row" }, [
        (() => {
          const b = el("button", { class: "primary", id: "extract-page" }, ["ページ全体を抽出"]);
          return b;
        })(),
        (() => {
          const b = el("button", { id: "extract-selection" }, ["選択範囲を抽出"]);
          return b;
        })(),
      ])
    );
    app.querySelector("#extract-page")!.addEventListener("click", () => runExtract("EXTRACT_CONTENT"));
    app.querySelector("#extract-selection")!.addEventListener("click", () => runExtract("EXTRACT_SELECTION"));
    if (state.result) renderResult();
    return;
  }

  renderClipForm();
}

async function runExtract(mode: "EXTRACT_CONTENT" | "EXTRACT_SELECTION"): Promise<void> {
  app.innerHTML = "";
  app.append(el("p", { class: "loading" }, ["ページを読み取っています..."]));
  try {
    const extracted = await sendMessage<ExtractedContent>({ type: mode });
    state.extracted = extracted;
    state.extractMode = mode;
    state.title = extracted.title;
    state.result = null;
    render();
  } catch (err) {
    state.result = { ok: false, errorCode: "UNKNOWN", message: (err as Error).message };
    render();
  }
}

function selectedDatabase(): RegisteredDatabase | undefined {
  return state.databases.find((d) => d.id === state.selectedDatabaseId);
}

function renderClipForm(): void {
  const db = selectedDatabase();

  const dbSelect = el("select", { id: "db-select" });
  for (const d of state.databases) {
    const opt = el("option", { value: d.id }, [d.title]);
    if (d.id === state.selectedDatabaseId) opt.setAttribute("selected", "true");
    dbSelect.append(opt);
  }

  const titleInput = el("input", { type: "text", id: "title-input", value: state.title });

  const form = el("div", { class: "field" }, []);
  form.append(
    el("label", {}, ["保存先データベース"]),
    dbSelect,
    el("label", {}, ["タイトル"]),
    titleInput
  );

  app.append(form);

  if (db) {
    for (const prop of db.properties) {
      if (prop.type === "select" || prop.type === "multi_select") {
        app.append(renderOptionProperty(prop));
      }
    }
  }

  app.append(el("div", { class: "divider" }));

  const saveBtn = el("button", { class: "primary", id: "save-clip" }, [
    state.saving ? "保存中..." : "Notionに保存",
  ]);
  if (state.saving) saveBtn.setAttribute("disabled", "true");
  const backBtn = el("button", { id: "back" }, ["やり直す"]);

  app.append(el("div", { class: "row" }, [saveBtn, backBtn]));

  if (state.result) renderResult();

  app.querySelector("#db-select")!.addEventListener("change", (e) => {
    state.selectedDatabaseId = (e.target as HTMLSelectElement).value;
    render();
  });
  app.querySelector("#title-input")!.addEventListener("input", (e) => {
    state.title = (e.target as HTMLInputElement).value;
  });
  app.querySelector("#save-clip")!.addEventListener("click", () => void saveClip());
  app.querySelector("#back")!.addEventListener("click", () => {
    state.extracted = null;
    state.result = null;
    render();
  });
}

function renderOptionProperty(prop: NotionPropertySummary): HTMLElement {
  const wrapper = el("div", { class: "field" }, [el("label", {}, [prop.name])]);
  const tagsWrap = el("div", { class: "tags" });
  const options = prop.options ?? [];
  const current = state.propertyValues[prop.name];

  for (const opt of options) {
    const isSelected =
      prop.type === "select" ? current === opt.name : Array.isArray(current) && current.includes(opt.name);
    const tag = el("span", { class: `tag-option${isSelected ? " selected" : ""}` }, [opt.name]);
    tag.addEventListener("click", () => {
      if (prop.type === "select") {
        state.propertyValues[prop.name] = state.propertyValues[prop.name] === opt.name ? "" : opt.name;
      } else {
        const list = new Set(Array.isArray(current) ? current : []);
        if (list.has(opt.name)) list.delete(opt.name);
        else list.add(opt.name);
        state.propertyValues[prop.name] = Array.from(list);
      }
      render();
    });
    tagsWrap.append(tag);
  }
  wrapper.append(tagsWrap);
  return wrapper;
}

function renderResult(): void {
  if (!state.result) return;
  if (state.result.ok) {
    app.append(
      el("div", { class: "banner success" }, [
        "保存しました。 ",
        el("a", { href: state.result.pageUrl, target: "_blank" }, ["Notionで開く"]),
      ])
    );
  } else {
    const banner = el("div", { class: "banner error" }, [state.result.message]);
    app.append(banner);
    if (state.result.errorCode === "NOTION_API_ERROR" || state.result.errorCode === "NETWORK_ERROR") {
      const retry = el("button", { id: "retry" }, ["再試行"]);
      retry.addEventListener("click", () => void saveClip());
      app.append(retry);
    }
  }
}

async function saveClip(): Promise<void> {
  if (!state.extracted || !state.selectedDatabaseId) return;
  const db = selectedDatabase();
  state.saving = true;
  state.result = null;
  render();

  const properties: ClipRequestPropertyValue[] = [
    { name: db?.properties.find((p) => p.type === "title")?.name ?? "Name", type: "title", value: state.title },
  ];
  if (db) {
    for (const prop of db.properties) {
      if (prop.type === "select" || prop.type === "multi_select") {
        const value = state.propertyValues[prop.name];
        if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) {
          properties.push({ name: prop.name, type: prop.type, value });
        }
      }
    }
  }

  try {
    const response = await sendMessage<SaveClipResponse>({
      type: "SAVE_CLIP",
      payload: {
        databaseId: state.selectedDatabaseId,
        title: state.title,
        sourceUrl: state.extracted.url,
        properties,
        blocks: state.extracted.blocks,
      },
    });
    state.result = response;
    if (response.ok) {
      state.usage = await sendMessage<UsageState>({ type: "GET_USAGE" });
    }
  } catch (err) {
    state.result = { ok: false, errorCode: "UNKNOWN", message: (err as Error).message };
  } finally {
    state.saving = false;
    render();
  }
}

async function init(): Promise<void> {
  await loadState();
  render();
}

void init();
