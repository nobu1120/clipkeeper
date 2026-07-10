import { Readability } from "@mozilla/readability";
import type { ExtractedContent, NotionBlockDraft } from "../lib/types";

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
          const src = (child as HTMLImageElement).src;
          if (src && src.startsWith("http")) blocks.push({ type: "image", url: src });
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

export function extractFullPage(): ExtractedContent {
  let article: ReturnType<Readability["parse"]> | null = null;
  try {
    const docClone = document.cloneNode(true) as Document;
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
    blocks: text
      ? [{ type: "quote", text }]
      : [{ type: "paragraph", text: "(選択されたテキストがありません)" }],
  };
}
