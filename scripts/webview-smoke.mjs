import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
  url: "https://localhost/",
  pretendToBeVisual: true,
});

const posted = [];
const api = {
  postMessage: (message) => posted.push(message),
  getState: () => undefined,
  setState: () => {},
};
dom.window.acquireVsCodeApi = () => api;
globalThis.acquireVsCodeApi = () => api;

for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MessageEvent", "Event", "MouseEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  try {
    globalThis[key] = dom.window[key];
  } catch {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
dom.window.Element.prototype.scrollIntoView = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

await import("file:///G:/opencode-vscode-ui/dist/webview/assets/index.js");
await new Promise((r) => setTimeout(r, 100));

const state = {
  status: "ready",
  workspace: "G:\\opencode-vscode-ui",
  models: [{ key: "opencode/big-pickle", ref: { id: "big-pickle", providerID: "opencode" }, name: "Big Pickle", providerID: "opencode", providerName: "opencode", variants: [], capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 200000, output: 32000 }, status: "active", enabled: true }],
  selectedModel: { id: "big-pickle", providerID: "opencode" },
  agents: [],
  sessions: [
    { id: "s1", title: "Sea story writing request", timeCreated: Date.now() - 90000, timeUpdated: Date.now() - 60000, model: { id: "big-pickle", providerID: "opencode" } },
    { id: "s2", title: "Fix clear chat button", timeCreated: Date.now() - 7200000, timeUpdated: Date.now() - 7000000 },
  ],
  permissions: [
    { id: "p1", sessionID: "s1", action: "shell", resources: ["echo hello"], tool: "call_123" },
  ],
  busy: false,
  messages: [
    { id: "u1", role: "user", time: Date.now(), text: "hello" },
    { id: "a1", role: "assistant", time: Date.now(), parts: [{ kind: "text", text: "hi there" }] },
  ],
};

dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", state } }));
await new Promise((r) => setTimeout(r, 100));

const buttons = [...dom.window.document.querySelectorAll("button")];
console.log("buttons:", buttons.map((b) => b.getAttribute("aria-label") ?? b.className).join(" | "));
console.log("messages rendered before:", dom.window.document.querySelectorAll(".msg").length);

const permCard = dom.window.document.querySelector(".perm__card");
console.log("permission card present:", Boolean(permCard));
const allowOnce = [...dom.window.document.querySelectorAll(".perm__button")].find((b) =>
  b.textContent?.includes("Allow once"),
);
console.log("allow-once button:", Boolean(allowOnce));
allowOnce?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 100));
console.log("posted after allow:", JSON.stringify(posted));

const history = buttons.find((b) => b.getAttribute("aria-label") === "Chat history");
console.log("history button present:", Boolean(history));
history?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 300));
console.log("posted after history click:", JSON.stringify(posted));
console.log(
  "history titles:",
  [...dom.window.document.querySelectorAll(".history__item-title")].map((e) => e.textContent).join(" | "),
);

const clear = buttons.find((b) => b.getAttribute("aria-label") === "Clear chat");
if (!clear) {
  console.log("CLEAR CHAT BUTTON NOT FOUND");
  process.exit(1);
}
console.log("disabled:", clear.disabled);

clear.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 100));

console.log("posted after click:", JSON.stringify(posted));
process.exit(0);
