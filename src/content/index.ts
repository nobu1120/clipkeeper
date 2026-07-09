import type { ExtensionMessage } from "../lib/types";
import { extractFullPage, extractSelection } from "./extract";

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
