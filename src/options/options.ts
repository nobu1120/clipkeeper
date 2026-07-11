import { sendMessage } from "../lib/messaging";
import type {
  NotionConnection,
  NotionDatabaseSummary,
  PlanState,
  RegisteredDatabase,
  UsageState,
} from "../lib/types";
import { FREE_MAX_DATABASES, FREE_MONTHLY_CLIP_LIMIT } from "../lib/types";

const app = document.getElementById("app")!;

interface OptionsState {
  connections: NotionConnection[];
  activeConnectionId: string | null;
  plan: PlanState;
  usage: UsageState;
  registered: RegisteredDatabase[];
  availableDatabases: NotionDatabaseSummary[] | null;
  banner: { kind: "error" | "success"; text: string } | null;
  loadingDatabases: boolean;
}

let state: OptionsState;

async function loadConnectionsState(): Promise<void> {
  const [{ connections, activeConnectionId }, registered] = await Promise.all([
    sendMessage<{ connections: NotionConnection[]; activeConnectionId: string | null }>({
      type: "GET_CONNECTIONS",
    }),
    sendMessage<RegisteredDatabase[]>({ type: "GET_REGISTERED_DATABASES" }),
  ]);
  state.connections = connections;
  state.activeConnectionId = activeConnectionId;
  state.registered = registered;
  state.availableDatabases = null;
}

async function loadState(): Promise<void> {
  const [plan, usage] = await Promise.all([
    sendMessage<PlanState>({ type: "GET_PLAN" }),
    sendMessage<UsageState>({ type: "GET_USAGE" }),
  ]);
  state = {
    connections: [],
    activeConnectionId: null,
    plan,
    usage,
    registered: [],
    availableDatabases: null,
    banner: null,
    loadingDatabases: false,
  };
  await loadConnectionsState();
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
  if (state.activeConnectionId) {
    app.append(renderDatabaseSection());
  }
}

function renderConnectionSection(): HTMLElement {
  const section = el("section", {}, [el("h2", {}, ["Notion接続"])]);

  if (state.connections.length > 0) {
    const list = el("ul", { class: "db-list" });
    for (const conn of state.connections) {
      const isActive = conn.id === state.activeConnectionId;
      const label = conn.workspaceName ?? "(名称不明のワークスペース)";
      const row = el("li", { class: "db-row" }, [
        el("span", {}, [isActive ? `${label}（使用中）` : label]),
      ]);
      if (!isActive) {
        const switchBtn = el("button", {}, ["これに切り替え"]);
        switchBtn.addEventListener("click", () => void switchConnection(conn.id));
        row.append(switchBtn);
      }
      const removeBtn = el("button", { class: "danger" }, ["解除"]);
      removeBtn.addEventListener("click", () => void removeConnection(conn.id));
      row.append(removeBtn);
      list.append(row);
    }
    section.append(
      el("p", { class: "muted" }, [
        "接続中のワークスペース(保存・データベース登録は「使用中」のワークスペースに対して行われます):",
      ]),
      list
    );
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
    el("p", { class: "muted" }, [
      "複数のNotionワークスペース(アカウント)を使い分けたい場合は、ワークスペースごとにインテグレーションを作成し、",
      "同じSecretの貼り付け操作を繰り返すことで、下の一覧に追加していけます。",
    ]),
    el("input", { type: "password", id: "token-input", placeholder: "secret_... または ntn_..." }),
    el("button", { class: "primary", id: "connect" }, [
      state.connections.length > 0 ? "別のワークスペースを追加" : "接続する",
    ])
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
    if (state.availableDatabases.length === 0) {
      section.append(
        el("p", { class: "muted" }, [
          "インテグレーションと接続済みのデータベースが見つかりませんでした。",
          "Notionのデータベースページ右上「•••」→「Connections」から、このインテグレーションを接続してください。",
        ])
      );
    } else {
      const registeredIds = new Set(state.registered.map((d) => d.id));
      const select = el("select", { id: "available-db-select" });
      for (const db of state.availableDatabases) {
        const isRegistered = registeredIds.has(db.id);
        const opt = el("option", { value: db.id }, [isRegistered ? `${db.title}（登録済み）` : db.title]);
        if (isRegistered) opt.setAttribute("disabled", "true");
        select.append(opt);
      }
      const firstSelectable = state.availableDatabases.find((db) => !registeredIds.has(db.id));
      if (firstSelectable) select.value = firstSelectable.id;

      const registerBtn = el("button", { class: "primary", id: "register-selected-db" }, ["登録"]);
      if (state.availableDatabases.every((db) => registeredIds.has(db.id))) {
        registerBtn.setAttribute("disabled", "true");
      }
      registerBtn.addEventListener("click", () => {
        const dbId = select.value;
        const db = state.availableDatabases?.find((d) => d.id === dbId);
        if (db) void registerDatabase(db);
      });

      section.append(
        el("p", { class: "muted" }, [
          `インテグレーションと接続済みのデータベース（${state.availableDatabases.length}件）:`,
        ]),
        el("div", { class: "row" }, [select, registerBtn])
      );
    }
  }

  return section;
}

async function connect(): Promise<void> {
  const input = document.getElementById("token-input") as HTMLInputElement;
  const token = input.value.trim();
  if (!token) return;
  const result = await sendMessage<{ ok: boolean; message?: string }>({
    type: "ADD_CONNECTION",
    token,
  });
  if (result.ok) {
    await loadConnectionsState();
    state.banner = { kind: "success", text: "Notionワークスペースを接続しました。" };
  } else {
    state.banner = { kind: "error", text: result.message ?? "接続に失敗しました。" };
  }
  render();
}

async function switchConnection(connectionId: string): Promise<void> {
  await sendMessage({ type: "SET_ACTIVE_CONNECTION", connectionId });
  await loadConnectionsState();
  state.banner = { kind: "success", text: "使用するワークスペースを切り替えました。" };
  render();
}

async function removeConnection(connectionId: string): Promise<void> {
  await sendMessage({ type: "REMOVE_CONNECTION", connectionId });
  await loadConnectionsState();
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
