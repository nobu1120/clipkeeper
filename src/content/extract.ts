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
          walk(child);
          break;
        default:
          if (text) blocks.push({ type: "paragraph", text });
      }
      if (blocks.length >= 95) break;
    }
  }

  walk(root);
  return blocks;
}

export function extractFullPage(): ExtractedContent {
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone, { keepClasses: false });
  const article = reader.parse();

  if (!article || !article.content) {
    return {
      title: document.title,
      url: location.href,
      siteName: null,
      excerpt: null,
      blocks: [{ type: "paragraph", text: "(本文を自動抽出できませんでした)" }],
    };
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = article.content;
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
