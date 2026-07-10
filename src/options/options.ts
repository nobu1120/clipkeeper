import { sendMessage } from "../lib/messaging";
import type {
  ConnectionState,
  NotionDatabaseSummary,
  PlanState,
  RegisteredDatabase,
  UsageState,
} from "../lib/types";
import { FREE_MAX_DATABASES, FREE_MONTHLY_CLIP_LIMIT } from "../lib/types";

const app = document.getElementById("app")!;

interface OptionsState {
  connection: ConnectionState;
  plan: PlanState;
  usage: UsageState;
  registered: RegisteredDatabase[];
  availableDatabases: NotionDatabaseSummary[] | null;
  banner: { kind: "error" | "success"; text: string } | null;
  loadingDatabases: boolean;
}

let state: OptionsState;

async function loadState(): Promise<void> {
  const [connection, plan, usage, registered] = await Promise.all([
    sendMessage<ConnectionState>({ type: "GET_CONNECTION" }),
    sendMessage<PlanState>({ type: "GET_PLAN" }),
    sendMessage<UsageState>({ type: "GET_USAGE" }),
    sendMessage<RegisteredDatabase[]>({ type: "GET_REGISTERED_DATABASES" }),
  ]);
  state = {
    connection,
    plan,
    usage,
    registered,
    availableDatabases: null,
    banner: null,
    loadingDatabases: false,
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
  app.append(el("h1", {}, ["ClipKeep 設定"]));

  if (state.banner) {
    app.append(el("div", { class: `banner ${state.banner.kind}` }, [state.banner.text]));
  }

  app.append(renderConnectionSection());
  app.append(renderPlanSection());
  if (state.connection.token) {
    app.append(renderDatabaseSection());
  }
}

function renderConnectionSection(): HTMLElement {
  const section = el("section", {}, [el("h2", {}, ["Notion接続"])]);

  if (state.connection.token) {
    section.append(
      el("p", {}, [
        `接続済み${state.connection.workspaceName ? `（${state.connection.workspaceName}）` : ""}`,
      ]),
      el("button", { class: "danger", id: "disconnect" }, ["接続を解除"])
    );
    section.querySelector("#disconnect")!.addEventListener("click", () => void disconnect());
    return section;
  }

  section.append(
    el("p", { class: "muted" }, [
      "1. ",
      el("a", { href: "https://www.notion.so/my-integrations", target: "_blank" }, [
        "notion.so/my-integrations",
      ]),
      " で「New integration」を作成し、Internal Integration Secretをコピーします。",
    ]),
    el("p", { class: "muted" }, [
      "2. 保存したいNotionデータベースのページ右上「•••」→「Connections」から、作成したインテグレーションを接続してください。",
    ]),
    el("input", { type: "password", id: "token-input", placeholder: "secret_... または ntn_..." }),
    el("button", { class: "primary", id: "connect" }, ["接続する"])
  );
  section.querySelector("#connect")!.addEventListener("click", () => void connect());
  return section;
}

function renderPlanSection(): HTMLElement {
  const remaining = `${Math.max(FREE_MONTHLY_CLIP_LIMIT - state.usage.clipCount, 0)} / ${FREE_MONTHLY_CLIP_LIMIT} 件（今月）`;

  return el("section", {}, [
    el("h2", {}, ["プラン"]),
    el("p", {}, [
      el("span", {}, ["Free"]),
      ` — クリップ残り: ${remaining} / データベース登録上限: ${FREE_MAX_DATABASES}件`,
    ]),
  ]);
}

function renderDatabaseSection(): HTMLElement {
  const section = el("section", {}, [el("h2", {}, ["保存先データベース"])]);

  if (state.registered.length > 0) {
    const list = el("ul", { class: "db-list" });
    for (const db of state.registered) {
      const row = el("li", { class: "db-row" }, [
        el("span", {}, [db.title]),
        (() => {
          const btn = el("button", { class: "danger" }, ["解除"]);
          btn.addEventListener("click", () => void unregisterDatabase(db.id));
          return btn;
        })(),
      ]);
      list.append(row);
    }
    section.append(el("p", { class: "muted" }, ["登録済み:"]), list);
  } else {
    section.append(el("p", { class: "muted" }, ["まだデータベースが登録されていません。"]));
  }

  const fetchBtn = el("button", { id: "fetch-databases" }, [
    state.loadingDatabases ? "取得中..." : "Notionのデータベース一覧を取得",
  ]);
  if (state.loadingDatabases) fetchBtn.setAttribute("disabled", "true");
  section.append(fetchBtn);
  fetchBtn.addEventListener("click", () => void fetchDatabases());

  if (state.availableDatabases) {
    const list = el("ul", { class: "db-list" });
    const registeredIds = new Set(state.registered.map((d) => d.id));
    for (const db of state.availableDatabases) {
      const isRegistered = registeredIds.has(db.id);
      const actionBtn = el("button", isRegistered ? {} : { class: "primary" }, [
        isRegistered ? "登録済み" : "登録",
      ]);
      if (isRegistered) actionBtn.setAttribute("disabled", "true");
      actionBtn.addEventListener("click", () => void registerDatabase(db));
      list.append(el("li", { class: "db-row" }, [el("span", {}, [db.title]), actionBtn]));
    }
    section.append(el("p", { class: "muted" }, ["インテグレーションと接続済みのデータベース:"]), list);
  }

  return section;
}

async function connect(): Promise<void> {
  const input = document.getElementById("token-input") as HTMLInputElement;
  const token = input.value.trim();
  if (!token) return;
  const result = await sendMessage<{ ok: boolean; message?: string }>({
    type: "SET_CONNECTION",
    token,
  });
  if (result.ok) {
    state.connection = await sendMessage<ConnectionState>({ type: "GET_CONNECTION" });
    state.banner = { kind: "success", text: "Notionと接続しました。" };
  } else {
    state.banner = { kind: "error", text: result.message ?? "接続に失敗しました。" };
  }
  render();
}

async function disconnect(): Promise<void> {
  await sendMessage({ type: "DISCONNECT" });
  state.connection = { token: null, connectedAt: null, workspaceName: null };
  state.availableDatabases = null;
  state.banner = { kind: "success", text: "接続を解除しました。" };
  render();
}

async function fetchDatabases(): Promise<void> {
  state.loadingDatabases = true;
  render();
  try {
    state.availableDatabases = await sendMessage<NotionDatabaseSummary[]>({ type: "GET_DATABASES" });
    state.banner = null;
  } catch (err) {
    state.banner = { kind: "error", text: (err as Error).message };
  } finally {
    state.loadingDatabases = false;
    render();
  }
}

async function registerDatabase(db: NotionDatabaseSummary): Promise<void> {
  const result = await sendMessage<{ ok: boolean; message?: string }>({
    type: "REGISTER_DATABASE",
    database: db,
  });
  if (result.ok) {
    state.registered = await sendMessage<RegisteredDatabase[]>({ type: "GET_REGISTERED_DATABASES" });
    state.banner = { kind: "success", text: `「${db.title}」を登録しました。` };
  } else {
    state.banner = { kind: "error", text: result.message ?? "登録に失敗しました。" };
  }
  render();
}

async function unregisterDatabase(databaseId: string): Promise<void> {
  await sendMessage({ type: "UNREGISTER_DATABASE", databaseId });
  state.registered = await sendMessage<RegisteredDatabase[]>({ type: "GET_REGISTERED_DATABASES" });
  render();
}

async function init(): Promise<void> {
  await loadState();
  render();
}

void init();
