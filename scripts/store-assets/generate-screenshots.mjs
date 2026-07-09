// Generates Chrome Web Store listing screenshots (1280x800 PNG) from the
// REAL compiled popup/options code, using the same "serve dist/ + mock
// chrome.runtime" technique as ui-test.mjs / scripts/demo/record-demo.mjs.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startStaticServer } from "../static-server.mjs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = resolve("store/screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const MOCK_CHROME_SRC = `
window.chrome = {
  runtime: {
    openOptionsPage: () => {},
    sendMessage: (msg) => {
      switch (msg.type) {
        case "GET_CONNECTION": return Promise.resolve({ token: "good-token", connectedAt: "now", workspaceName: "Demo Workspace" });
        case "GET_PLAN": return Promise.resolve({ tier: "free" });
        case "GET_USAGE": return Promise.resolve({ periodStart: new Date().toISOString(), clipCount: 6 });
        case "GET_REGISTERED_DATABASES":
          return Promise.resolve([
            { id: "db-1", title: "Reading List", isDefaultForDomains: [], properties: [
              { name: "Name", type: "title" },
              { name: "Tags", type: "multi_select", options: [{ id: "t1", name: "tech" }, { id: "t2", name: "later" }] },
            ] },
          ]);
        case "GET_DATABASES":
          return Promise.resolve([
            { id: "db-1", title: "Reading List", properties: [
              { name: "Name", type: "title" },
              { name: "Tags", type: "multi_select", options: [{ id: "t1", name: "tech" }, { id: "t2", name: "later" }] },
            ] },
          ]);
        case "EXTRACT_CONTENT":
          return Promise.resolve({
            title: "個人開発でリカーリング収益を作る7つの戦略",
            url: "https://indie-hacker-journal.example.com/recurring-revenue",
            siteName: "Indie Hacker Journal",
            excerpt: null,
            blocks: [{ type: "paragraph", text: "..." }],
          });
        case "SAVE_CLIP":
          return Promise.resolve({ ok: true, pageUrl: "https://notion.so/demo-workspace/mock-page" });
        default:
          return Promise.resolve(undefined);
      }
    },
  },
};
`;

const OVERLAY_CSS = `
  #ck-shot-chrome, #ck-shot-caption { all: initial; }
  #ck-shot-chrome *, #ck-shot-caption * { all: unset; box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif; }
  #ck-shot-chrome {
    position: fixed; top: 0; left: 0; right: 0; height: 44px; z-index: 2147483000;
    background: #e8e8e8; border-bottom: 1px solid #cfcfcf;
    display: flex; align-items: center; padding: 0 14px; gap: 10px;
  }
  #ck-shot-chrome .dots { display: flex; gap: 6px; }
  #ck-shot-chrome .dot { width: 11px; height: 11px; border-radius: 50%; }
  #ck-shot-chrome .addr {
    flex: 1; margin: 0 16px; background: #fff; border: 1px solid #d7d7d7; border-radius: 14px;
    padding: 6px 14px; font-size: 13px; color: #444; display: flex; align-items: center; gap: 6px;
  }
  #ck-shot-chrome .ext-icon {
    width: 26px; height: 26px; border-radius: 6px; background: #2f6f4f; color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
  }
  #ck-shot-caption {
    position: fixed; left: 0; right: 0; top: 44px; z-index: 2147483000;
    background: linear-gradient(180deg, rgba(26,26,26,0.92), rgba(26,26,26,0));
    color: #fff; padding: 26px 40px 60px; font-size: 26px; font-weight: 700;
  }
  #ck-shot-caption .sub { display:block; font-size: 15px; font-weight: 400; color: #ddd; margin-top: 8px; }
`;

async function ensureChrome(page, addressText) {
  await page.evaluate(
    (css, addressText) => {
      if (!document.getElementById("ck-shot-style")) {
        const style = document.createElement("style");
        style.id = "ck-shot-style";
        style.textContent = css;
        document.head.appendChild(style);
      }
      document.body.style.marginTop = "44px";
      let bar = document.getElementById("ck-shot-chrome");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "ck-shot-chrome";
        bar.innerHTML = `
          <span class="dots">
            <span class="dot" style="background:#ff5f57"></span>
            <span class="dot" style="background:#febc2e"></span>
            <span class="dot" style="background:#28c840"></span>
          </span>
          <span class="addr">🔒 <span id="ck-shot-addr-text"></span></span>
          <span class="ext-icon">CK</span>
        `;
        document.body.appendChild(bar);
      }
      document.getElementById("ck-shot-addr-text").textContent = addressText;
    },
    OVERLAY_CSS,
    addressText
  );
}

async function setCaption(page, title, sub) {
  await page.evaluate(
    (title, sub) => {
      let bar = document.getElementById("ck-shot-caption");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "ck-shot-caption";
        document.body.appendChild(bar);
      }
      bar.innerHTML = `${title}<span class="sub">${sub}</span>`;
      // push real page content below the fixed chrome bar (44px) + caption band
      document.body.style.marginTop = "190px";
    },
    title,
    sub
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { server, baseUrl } = await startStaticServer(".");
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument(MOCK_CHROME_SRC);

    // 1. Hero shot: popup open over an article, extraction + tag selection
    await page.goto(`${baseUrl}/scripts/demo/demo-article.html`, { waitUntil: "networkidle0" });
    await ensureChrome(page, "indie-hacker-journal.example.com/recurring-revenue");
    await setCaption(page, "Webページをそのままタグ付けして保存", "保存する瞬間に、データベースとタグを選べます");
    await page.evaluate((baseUrl) => {
      const frame = document.createElement("iframe");
      frame.id = "popup-frame";
      frame.src = `${baseUrl}/dist/popup/popup.html`;
      frame.style.cssText =
        "position:fixed;top:90px;right:40px;width:380px;height:600px;border:1px solid #cfcfcf;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.3);z-index:2147483100;background:#fff;";
      document.body.appendChild(frame);
    }, baseUrl);
    await sleep(400);
    await page.evaluate(() => {
      document.getElementById("popup-frame").contentDocument.getElementById("extract-page")?.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const doc = document.getElementById("popup-frame").contentDocument;
      Array.from(doc.querySelectorAll(".tag-option"))
        .find((el) => el.textContent.includes("tech"))
        ?.click();
    });
    await sleep(200);
    await page.screenshot({ path: resolve(OUT_DIR, "1-clip-and-tag.png") });

    // 2. Save success
    await page.evaluate(() => {
      document.getElementById("popup-frame").contentDocument.getElementById("save-clip")?.click();
    });
    await sleep(500);
    await setCaption(page, "保存の成否がその場でわかる", "失敗時はエラー内容と再試行ボタンを表示");
    await page.screenshot({ path: resolve(OUT_DIR, "2-save-success.png") });
    await page.evaluate(() => document.getElementById("popup-frame")?.remove());

    // 3. Options: connected state
    await page.goto(`${baseUrl}/dist/options/options.html`, { waitUntil: "networkidle0" });
    await ensureChrome(page, "ClipKeep — 設定");
    await setCaption(page, "Notionと接続して、保存先データベースを登録", "無料プランでも月20クリップまで利用できます");
    await page.screenshot({ path: resolve(OUT_DIR, "3-connect-and-plan.png") });

    // 4. Options: registered database list detail
    await page.evaluate(() => window.scrollTo(0, 300));
    await sleep(100);
    await ensureChrome(page, "ClipKeep — 設定");
    await setCaption(page, "保存先データベースを一元管理", "複数のデータベースを切り替えて使い分け（Pro）");
    await page.screenshot({ path: resolve(OUT_DIR, "4-database-management.png") });

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`Screenshots written to ${OUT_DIR}`);
}

await main();
