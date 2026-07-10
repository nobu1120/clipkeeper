import type { ExtensionMessage } from "../lib/types";
import { extractFullPage, extractSelection } from "./extract";

// content.js is (re-)injected via chrome.scripting.executeScript on every
// extract request. Without this guard, repeated extraction in the same tab
// (without a navigation in between) would register a new onMessage listener
// each time, leaking listeners for the lifetime of the tab.
const INJECTED_FLAG = "__clipkeepContentScriptRegistered";
const global = window as unknown as Record<string, boolean>;

if (!global[INJECTED_FLAG]) {
  global[INJECTED_FLAG] = true;

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === "EXTRACT_CONTENT") {
        sendResponse(extractFullPage());
        return true;
      }
      if (message.type === "EXTRACT_SELECTION") {
        sendResponse(extractSelection());
        return true;
      }
      return false;
    }
  );
}
