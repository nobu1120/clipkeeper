import type { ExtensionMessage } from "./types";

export function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
