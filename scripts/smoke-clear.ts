import { SessionController } from "../src/session/SessionController.js";
import type { UiMessage } from "../shared/protocol.js";

const describe = (m: UiMessage): string =>
  m.role === "assistant" ? "assistant" : `${m.role}:${(m.text ?? "").slice(0, 30)}`;

const controller = new SessionController(
  (message, ...args) => console.log("[log]", message, ...args),
  () => {},
  process.cwd(),
);

await controller.start();
await controller.selectModel({ id: "big-pickle", providerID: "opencode" });
console.log("initial session:", controller.current.sessionID, "messages:", controller.current.messages.length);

// Send, then clear the chat while the answer is still streaming.
await controller.send("Write a 200 word story about the sea.");
console.log("after send: busy =", controller.current.busy, "messages =", controller.current.messages.length);

await new Promise((r) => setTimeout(r, 2500));
console.log("mid-stream: busy =", controller.current.busy, "messages =", controller.current.messages.length);

await controller.clearChat();
console.log(
  "after clearChat: sessionID =",
  controller.current.sessionID,
  "messages =",
  controller.current.messages.length,
  "busy =",
  controller.current.busy,
);

// The old turn is still finishing on the server; nothing may leak into the cleared chat.
await new Promise((r) => setTimeout(r, 15000));
console.log("leak check: messages =", controller.current.messages.length);

// The next message must land in a brand new session.
await controller.send("Reply with exactly: ok");
console.log("after send #2: sessionID =", controller.current.sessionID, "busy =", controller.current.busy);
await new Promise((r) => setTimeout(r, 12000));
console.log(
  "final: session =",
  controller.current.sessionID,
  "messages =",
  controller.current.messages.length,
  "->",
  JSON.stringify(controller.current.messages.map(describe)),
);

controller.dispose();
process.exit(0);
