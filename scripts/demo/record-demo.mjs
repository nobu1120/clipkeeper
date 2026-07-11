// Builds a ~60s MP4 walkthrough of ClipKeep's main flow (Notion connect ->
// clip a page -> pick a tag -> save success -> result in Notion) as a paced
// storyboard: puppeteer drives the REAL compiled popup/options code (via the
// same "serve dist/ + mock chrome.runtime" technique used in ui-test.mjs),
// captures a screenshot per beat, then ffmpeg holds each still for its
// duration and concatenates them into a video.
//
// Real Chrome Developer Mode is policy-locked in automated/CDP-launched
// profiles in this environment (see README.md), so this does not load the
// packaged extension inside a real toolbar. Instead it overlays a drawn
// "browser chrome" bar so the flow still reads as an extension popup, and
// the final "saved in Notion" beat is a styled static mock page (no real
// Notion account / API calls involved), per project instructions to use
// dummy data for this demo.
import puppeteer from "puppeteer-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { startStaticServer } from "../static-server.mjs";

const execFileAsync = promisify(execFile);
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const VIEWPORT = { width: 1280, height: 720 };
const FRAMES_DIR = resolve("scripts/demo/frames");
const OUTPUT_PATH = resolve("scripts/demo/clipkeep-demo.mp4");

if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });

const MOCK_CHROME_SRC = `
function __readState() {
  const raw = sessionStorage.getItem("__mockState");
  return raw ? JSON.parse(raw) : {
    connection: { token: null, connectedAt: null, workspaceName: null },
    plan: { tier: "free" },
    usage: { periodStart: new Date().toISOString(), clipCount: 2 },
    registeredDatabases: [],
  };
}
function __writeState(s) { sessionStorage.setItem("__mockState", JSON.stringify(s)); }

window.chrome = {
  runtime: {
    openOptionsPage: () => {},
    sendMessage: (msg) => {
      const s = __readState();
      switch (msg.type) {
        case "GET_CONNECTION": return Promise.resolve(s.connection);
        case "GET_PLAN": return Promise.resolve(s.plan);
        case "GET_USAGE": return Promise.resolve(s.usage);
        case "GET_REGISTERED_DATABASES": return Promise.resolve(s.registeredDatabases);
        case "SET_CONNECTION":
          s.connection = { token: msg.token, connectedAt: new Date().toISOString(), workspaceName: "Demo Workspace" };
          __writeState(s);
          return Promise.resolve({ ok: true });
        case "GET_DATABASES":
          return Promise.resolve([
            { id: "db-1", title: "Reading List", properties: [
              { name: "Name", type: "title" },
              { name: "Tags", type: "multi_select", options: [{ id: "t1", name: "tech" }, { id: "t2", name: "later" }] },
            ] },
          ]);
        case "REGISTER_DATABASE":
          if (s.registeredDatabases.length >= 1) return Promise.resolve({ ok: false, message: "無料プランはデータベース1件までです。" });
          s.registeredDatabases.push({ id: msg.database.id, title: msg.database.title, properties: msg.database.properties });
          __writeState(s);
          return Promise.resolve({ ok: true });
        case "EXTRACT_CONTENT":
          return Promise.resolve({
            title: "個人開発でリカーリング収益を作る7つの戦略",
            url: "https://indie-hacker-journal.example.com/recurring-revenue",
            siteName: "Indie Hacker Journal",
            excerpt: null,
            blocks: [{ type: "paragraph", text: "個人開発で継続的な収益を作るには..." }],
          });
        case "SAVE_CLIP":
          s.usage.clipCount += 1;
          __writeState(s);
          return Promise.resolve({ ok: true, pageUrl: "https://notion.so/demo-workspace/mock-page" });
        default:
          return Promise.resolve(undefined);
      }
    },
  },
};
`;

// ---- Visual overlay helpers (executed inside the page) ----

const OVERLAY_CSS = `
  #ck-demo-chrome, #ck-demo-caption { all: initial; }
  #ck-demo-chrome * , #ck-demo-caption * { all: unset; box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif; }
  #ck-demo-chrome {
    position: fixed; top: 0; left: 0; right: 0; height: 44px; z-index: 2147483000;
    background: #e8e8e8; border-bottom: 1px solid #cfcfcf;
    display: flex; align-items: center; padding: 0 14px; gap: 10px;
  }
  #ck-demo-chrome .dots { display: flex; gap: 6px; }
  #ck-demo-chrome .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  #ck-demo-chrome .addr {
    flex: 1; margin: 0 16px; background: #fff; border: 1px solid #d7d7d7; border-radius: 14px;
    padding: 6px 14px; font-size: 12.5px; color: #444; display: flex; align-items: center; gap: 6px;
  }
  #ck-demo-chrome .ext-icon {
    width: 26px; height: 26px; border-radius: 6px; background: #1a1a1a; color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
    transition: box-shadow .15s;
  }
  #ck-demo-chrome .ext-icon.active { box-shadow: 0 0 0 3px rgba(47,111,79,0.55); background: #2f6f4f; }
  #ck-demo-caption {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000;
    background: rgba(20,20,20,0.88); color: #fff; padding: 14px 26px; font-size: 16px;
    display: flex; align-items: center; min-height: 24px;
  }
  #ck-demo-cursor {
    position: fixed; z-index: 2147483647; width: 22px; height: 22px; pointer-events: none;
    background: radial-gradient(circle at 30% 30%, #fff 0%, #fff 35%, rgba(255,255,255,0) 36%),
                conic-gradient(from 210deg, #1a1a1a 0deg, #1a1a1a 60deg, transparent 61deg);
    border-radius: 2px 50% 50% 50%;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,.5));
    transform: rotate(-45deg);
  }
`;

async function ensureChrome(page, { addressText, iconActive }) {
  await page.evaluate(
    (css, addressText, iconActive) => {
      if (!document.getElementById("ck-demo-style")) {
        const style = document.createElement("style");
        style.id = "ck-demo-style";
        style.textContent = css;
        document.head.appendChild(style);
      }
      document.documentElement.style.setProperty("scroll-behavior", "auto");
      document.body.style.marginTop = "44px";
      document.body.style.marginBottom = "54px";

      let bar = document.getElementById("ck-demo-chrome");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "ck-demo-chrome";
        bar.innerHTML = `
          <span class="dots">
            <span class="dot" style="background:#ff5f57"></span>
            <span class="dot" style="background:#febc2e"></span>
            <span class="dot" style="background:#28c840"></span>
          </span>
          <span class="addr">🔒 <span id="ck-demo-addr-text"></span></span>
          <span class="ext-icon" id="ck-demo-ext-icon">CK</span>
        `;
        document.body.appendChild(bar);
      }
      document.getElementById("ck-demo-addr-text").textContent = addressText;
      document.getElementById("ck-demo-ext-icon").classList.toggle("active", !!iconActive);
    },
    OVERLAY_CSS,
    addressText,
    iconActive
  );
}

async function setCaption(page, text) {
  await page.evaluate((text) => {
    let bar = document.getElementById("ck-demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ck-demo-caption";
      document.body.appendChild(bar);
    }
    bar.textContent = text;
  }, text);
}

async function setCursor(page, coord) {
  await page.evaluate((coord) => {
    let cur = document.getElementById("ck-demo-cursor");
    if (!coord) {
      if (cur) cur.remove();
      return;
    }
    if (!cur) {
      cur = document.createElement("div");
      cur.id = "ck-demo-cursor";
      document.body.appendChild(cur);
    }
    cur.style.left = `${coord[0]}px`;
    cur.style.top = `${coord[1]}px`;
  }, coord);
}

async function showPopupOverlay(page, baseUrl) {
  await page.evaluate((baseUrl) => {
    if (document.getElementById("ck-demo-popup-frame")) return;
    const frame = document.createElement("iframe");
    frame.id = "ck-demo-popup-frame";
    frame.src = `${baseUrl}/dist/popup/popup.html`;
    frame.style.cssText = `
      position: fixed; top: 50px; right: 14px; width: 360px; height: 560px;
      border: 1px solid #cfcfcf; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      z-index: 2147483100; background: white;
    `;
    document.body.appendChild(frame);
  }, baseUrl);
  // give the iframe a beat to finish its own init() fetch cycle
  await sleep(400);
}

async function hidePopupOverlay(page) {
  await page.evaluate(() => document.getElementById("ck-demo-popup-frame")?.remove());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Click via direct DOM .click() rather than coordinate-based clicking, since
// our fixed-position demo overlays (chrome bar / caption bar) sit above the
// real page in z-index and would otherwise intercept a coordinate click.
// `boundsOf`/`clickByText` still return a bounding box so the fake cursor
// can be positioned realistically for the screenshot.
async function boundsOfSelector(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

async function clickSelector(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
}

async function boundsOfButtonWithText(page, text) {
  return page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes(text));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, text);
}

async function clickButtonWithText(page, text) {
  await page.evaluate((text) => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes(text))?.click();
  }, text);
}

async function boundsOfInFrame(page, frameSelector, innerSelector) {
  return page.evaluate(
    (frameSelector, innerSelector) => {
      const frame = document.querySelector(frameSelector);
      const el = frame.contentDocument.querySelector(innerSelector);
      if (!el) return null;
      const inner = el.getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      return { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height };
    },
    frameSelector,
    innerSelector
  );
}

function centerOf(box) {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

// ---- Storyboard ----

const shots = []; // { file, duration }

async function shot(page, name, duration) {
  const file = resolve(FRAMES_DIR, `${String(shots.length).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push({ file, duration });
}

async function titleCard(page, { title, subtitle }) {
  await page.setContent(`
    <html><head><style>
      body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
             background:#141414; color:#fff; font-family:-apple-system,'Segoe UI','Hiragino Kaku Gothic ProN',sans-serif; }
      h1 { font-size:44px; margin:0 0 14px; }
      p { font-size:18px; color:#a8a8a8; margin:0; }
    </style></head>
    <body><h1>${title}</h1><p>${subtitle}</p></body></html>
  `);
  await page.setViewport(VIEWPORT);
}

async function main() {
  const { server, baseUrl } = await startStaticServer(".");
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument(MOCK_CHROME_SRC);

    // 0. Intro card
    await titleCard(page, {
      title: "ClipKeep for Notion",
      subtitle: "Notionへ確実に、タグ付けして保存できるクリッパー — MVP Demo",
    });
    await shot(page, "intro", 4.5);

    // 1-3. Options: connect to Notion
    await page.goto(`${baseUrl}/dist/options/options.html`, { waitUntil: "networkidle0" });
    await ensureChrome(page, { addressText: "ClipKeep — 設定", iconActive: false });
    await setCaption(page, "① Notionのインテグレーション トークンを貼り付けて接続");
    await shot(page, "options-empty", 3.5);

    await page.type("#token-input", "secret_demo_clipkeep_1234567890", { delay: 15 });
    await setCursor(page, centerOf(await boundsOfSelector(page, "#connect")));
    await shot(page, "options-typed", 3);

    await clickSelector(page, "#connect");
    await sleep(300);
    await setCursor(page, null);
    await ensureChrome(page, { addressText: "ClipKeep — 設定", iconActive: false });
    await setCaption(page, "Notionとの接続が完了しました");
    await shot(page, "options-connected", 4.5);

    // 4-5. Options: fetch + register database
    await clickSelector(page, "#fetch-databases");
    await sleep(400);
    await ensureChrome(page, { addressText: "ClipKeep — 設定", iconActive: false });
    await setCaption(page, "② 保存先データベースを登録");
    await setCursor(page, centerOf(await boundsOfButtonWithText(page, "登録")));
    await shot(page, "options-fetch", 3.5);

    await clickButtonWithText(page, "登録");
    await sleep(300);
    await setCursor(page, null);
    await ensureChrome(page, { addressText: "ClipKeep — 設定", iconActive: false });
    await setCaption(page, "「Reading List」を保存先として登録しました");
    await shot(page, "options-registered", 4.5);

    // 6. Show the article page
    await page.goto(`${baseUrl}/scripts/demo/demo-article.html`, { waitUntil: "networkidle0" });
    await ensureChrome(page, {
      addressText: "indie-hacker-journal.example.com/recurring-revenue",
      iconActive: false,
    });
    await setCaption(page, "③ Webページを開いた状態でClipKeepのアイコンをクリック");
    await shot(page, "article", 4.5);

    // 7. Open the (real) popup as a floating overlay
    await ensureChrome(page, {
      addressText: "indie-hacker-journal.example.com/recurring-revenue",
      iconActive: true,
    });
    await showPopupOverlay(page, baseUrl);
    await setCaption(page, "拡張機能のポップアップが開きます");
    await setCursor(page, centerOf(await boundsOfInFrame(page, "#ck-demo-popup-frame", "#extract-page")));
    await shot(page, "popup-opened", 3);

    // 8. Extract page content inside the popup
    await page.evaluate(() => {
      const frame = document.getElementById("ck-demo-popup-frame");
      frame.contentDocument.getElementById("extract-page")?.click();
    });
    await sleep(500);
    await setCursor(page, null);
    await setCaption(page, "④ 本文を自動抽出 → 保存先とタイトルを確認");
    await shot(page, "popup-extracted", 4.5);

    // 9. Select a tag inside the popup
    await setCursor(
      page,
      centerOf(
        await page.evaluate(() => {
          const frame = document.getElementById("ck-demo-popup-frame");
          const tag = Array.from(frame.contentDocument.querySelectorAll(".tag-option")).find((el) =>
            el.textContent.includes("tech")
          );
          const inner = tag.getBoundingClientRect();
          const outer = frame.getBoundingClientRect();
          return { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height };
        })
      )
    );
    await shot(page, "popup-before-tag", 2.5);
    await page.evaluate(() => {
      const frame = document.getElementById("ck-demo-popup-frame");
      const tag = Array.from(frame.contentDocument.querySelectorAll(".tag-option")).find((el) =>
        el.textContent.includes("tech")
      );
      tag?.click();
    });
    await sleep(200);
    await setCursor(page, centerOf(await boundsOfInFrame(page, "#ck-demo-popup-frame", "#save-clip")));
    await setCaption(page, "タグ「tech」を選択して保存");
    await shot(page, "popup-tag-selected", 3.5);

    // 10. Save and show success
    await page.evaluate(() => {
      const frame = document.getElementById("ck-demo-popup-frame");
      frame.contentDocument.getElementById("save-clip")?.click();
    });
    await setCursor(page, null);
    await sleep(600);
    await ensureChrome(page, {
      addressText: "indie-hacker-journal.example.com/recurring-revenue",
      iconActive: true,
    });
    await setCaption(page, "⑤ 保存成功。失敗時はここにエラーと再試行ボタンが表示されます");
    await shot(page, "popup-success", 6);

    await hidePopupOverlay(page);

    // 11. Mock Notion result page
    await page.goto(`${baseUrl}/scripts/demo/notion-mock-page.html`, { waitUntil: "networkidle0" });
    await ensureChrome(page, { addressText: "notion.so/demo-workspace/...", iconActive: false });
    await setCaption(page, "⑥ Notion側に保存された結果（デモ用シミュレーション）");
    await shot(page, "notion-result", 8);

    // 12. Outro
    await titleCard(page, {
      title: "ClipKeep for Notion",
      subtitle: "SELECTION.md / SPEC.md / README.md にて詳細",
    });
    await shot(page, "outro", 4.5);

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`Captured ${shots.length} shots. Encoding video...`);
  await encodeVideo(shots, OUTPUT_PATH);
  console.log(`\nDEMO VIDEO CREATED: ${OUTPUT_PATH}`);
}

async function encodeVideo(shots, outputPath) {
  const listPath = resolve(FRAMES_DIR, "concat.txt");
  const lines = [];
  for (const s of shots) {
    const escaped = s.file.replace(/\\/g, "/").replace(/'/g, "'\\''");
    lines.push(`file '${escaped}'`);
    lines.push(`duration ${s.duration}`);
  }
  // ffmpeg's concat demuxer ignores the last entry's duration; repeat it.
  const lastEscaped = shots[shots.length - 1].file.replace(/\\/g, "/").replace(/'/g, "'\\''");
  lines.push(`file '${lastEscaped}'`);
  writeFileSync(listPath, lines.join("\n"), "utf-8");

  if (existsSync(outputPath)) rmSync(outputPath, { force: true });

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-vf", "fps=24,format=yuv420p",
    "-c:v", "libx264",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

await main();
