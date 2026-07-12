import { Readability } from "@mozilla/readability";
import type { ExtractedContent, NotionBlockDraft } from "../lib/types";

// Common attribute names lazy-loading libraries stash the real image URL in
// before swapping it into `src` on scroll/JS execution. Readability has its
// own lazy-image fixup, but it only recognizes values ending in
// .jpg/.jpeg/.png/.webp — many real-world CDN URLs are extensionless or
// query-string based (e.g. `?w=800`, `.avif`, `.gif`) and slip through, so
// this is a broader belt-and-suspenders fallback run on whatever HTML
// Readability hands back.
const LAZY_SRC_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-actualsrc", "data-hi-res-src"];

function resolveImageUrl(img: HTMLImageElement): string | null {
  const candidates: (string | null)[] = [img.getAttribute("src")];
  for (const attr of LAZY_SRC_ATTRS) candidates.push(img.getAttribute(attr));

  const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
  if (srcset) {
    // srcset is a comma-separated list of "<url> <descriptor>" pairs; take
    // the first URL as a reasonable default.
    candidates.push(srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? null);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    // Tiny inline placeholder images (1x1 base64 GIFs etc.) used by lazy-load
    // libraries are never useful to save — skip and keep looking.
    if (trimmed.startsWith("data:")) continue;
    try {
      return new URL(trimmed, document.baseURI).href;
    } catch {
      continue;
    }
  }
  return null;
}

function htmlToBlocks(root: HTMLElement): NotionBlockDraft[] {
  const blocks: NotionBlockDraft[] = [];

  function textOf(node: Element): string {
    return (node.textContent ?? "").trim().replace(/\s+/g, " ");
  }

  function walk(node: Element) {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      const text = textOf(child);

      if (!text && tag !== "img" && tag !== "pre") continue;

      switch (tag) {
        case "h1":
          blocks.push({ type: "heading_1", text });
          break;
        case "h2":
          blocks.push({ type: "heading_2", text });
          break;
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          blocks.push({ type: "heading_3", text });
          break;
        case "blockquote":
          blocks.push({ type: "quote", text });
          break;
        case "pre": {
          const code = child.querySelector("code");
          blocks.push({ type: "code", text: (code ?? child).textContent ?? "" });
          break;
        }
        case "ul":
          for (const li of Array.from(child.querySelectorAll(":scope > li"))) {
            const liText = textOf(li);
            if (liText) blocks.push({ type: "bulleted_list_item", text: liText });
          }
          break;
        case "ol":
          for (const li of Array.from(child.querySelectorAll(":scope > li"))) {
            const liText = textOf(li);
            if (liText) blocks.push({ type: "numbered_list_item", text: liText });
          }
          break;
        case "img": {
          const url = resolveImageUrl(child as HTMLImageElement);
          if (url) blocks.push({ type: "image", url });
          break;
        }
        case "p":
          blocks.push({ type: "paragraph", text });
          break;
        case "div":
        case "section":
        case "article":
        case "figure":
        case "main":
          walk(child);
          break;
        default:
          // Unknown container tags (header/aside/details/custom elements, or
          // any future HTML we haven't special-cased) still have their own
          // element children, so recurse into them rather than collapsing
          // the whole subtree's text into a single paragraph — that flattens
          // real-world articles (e.g. content wrapped in <main>) into one
          // giant block and discards all headings/lists/code/images inside.
          if (child.children.length > 0) {
            walk(child);
          } else if (text) {
            blocks.push({ type: "paragraph", text });
          }
      }
      if (blocks.length >= 95) break;
    }
  }

  walk(root);
  return blocks;
}

// Readability scores candidates by text/link density and class/id keywords
// like "nav"/"menu"/"footer" — but sites that ship obfuscated, hashed class
// names (common with bundled/minified frontends) give it nothing to match,
// so a large site-chrome block (e.g. a portal's link-heavy top header) can
// out-score the real content or even stand in as the only content on pages
// that have no single article (portal/aggregator homepages). Stripping
// semantic/ARIA chrome landmarks before Readability ever sees them sidesteps
// that failure mode. Landmarks nested inside <article>/<main> are left
// alone since those are typically legitimate in-content elements (e.g. a
// post's <header> title+byline block), not page chrome.
const PAGE_CHROME_SELECTOR =
  "header, nav, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary']";

function stripPageChrome(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(PAGE_CHROME_SELECTOR))) {
    if (!el.closest("article, main, [role='main']")) {
      el.remove();
    }
  }
}

export function extractFullPage(): ExtractedContent {
  let article: ReturnType<Readability["parse"]> | null = null;
  try {
    const docClone = document.cloneNode(true) as Document;
    stripPageChrome(docClone);
    const reader = new Readability(docClone, { keepClasses: false });
    article = reader.parse();
  } catch {
    article = null;
  }

  if (!article || !article.content) {
    return {
      title: document.title,
      url: location.href,
      siteName: null,
      excerpt: null,
      byline: null,
      publishedTime: null,
      blocks: [{ type: "paragraph", text: "(本文を自動抽出できませんでした)" }],
    };
  }

  // Parse into a document created via DOMParser rather than assigning to a
  // live element's innerHTML: per spec, DOMParser output is fully inert (no
  // subresource loads, no script/event-handler execution), which matters
  // because `article.content` is untrusted HTML from an arbitrary web page.
  const wrapper = new DOMParser().parseFromString(article.content, "text/html").body;
  const blocks = htmlToBlocks(wrapper);

  return {
    title: article.title || document.title,
    url: location.href,
    siteName: article.siteName ?? null,
    excerpt: article.excerpt ?? null,
    byline: article.byline || null,
    publishedTime: article.publishedTime || null,
    blocks: blocks.length > 0 ? blocks : [{ type: "paragraph", text: article.textContent.slice(0, 500) }],
  };
}

export function extractSelection(): ExtractedContent {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  return {
    title: document.title,
    url: location.href,
    siteName: null,
    excerpt: text.slice(0, 200),
    byline: null,
    publishedTime: null,
    blocks: text
      ? [{ type: "quote", text }]
      : [{ type: "paragraph", text: "(選択されたテキストがありません)" }],
  };
}
