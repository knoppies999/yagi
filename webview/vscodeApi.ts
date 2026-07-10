// Thin typed wrapper around the VS Code webview API.
import type { OutMsg } from "./messages";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function post(msg: OutMsg): void {
  api.postMessage(msg);
}
