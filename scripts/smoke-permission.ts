import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { SessionController } from "../src/session/SessionController.js";

const controller = new SessionController(
  (m, ...a) => console.log("[log]", m, ...a),
  () => {},
  process.cwd(),
);

await controller.start();
await controller.selectModel({ id: "big-pickle", providerID: "opencode" });

// Create a session that forces an "ask" permission for shell commands.
const endpoint = await Service.ensure();
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
const session = await client.session.create({
  location: { directory: process.cwd() },
  model: { id: "big-pickle", providerID: "opencode" },
  title: "permission smoke",
  permissions: [{ action: "shell", resource: "*", effect: "ask" }],
});
console.log("created session:", session.id);

await controller.openSession(session.id);
console.log("opened, active:", controller.current.sessionID);

await controller.send("Run the shell command `echo hello` and then report the output.");

// Wait for a permission request to appear.
let perm = undefined;
for (let i = 0; i < 40 && !perm; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  perm = controller.current.permissions[0];
}
console.log("permission:", perm ? JSON.stringify(perm) : "NONE");
console.log("permission count via API:", (await client.permission.list({ sessionID: session.id })).length);

if (perm) {
  await controller.replyPermission(perm.id, "once");
  console.log("replied once; pending now:", controller.current.permissions.length);
}

await new Promise((r) => setTimeout(r, 12000));
console.log("remaining permissions:", controller.current.permissions.length);
console.log(
  "messages:",
  controller.current.messages.map((m) => m.role).join(" | "),
);
for (const m of controller.current.messages) {
  if (m.role !== "assistant") continue;
  for (const p of m.parts) {
    if (p.kind === "tool") console.log(`  tool ${p.name} status=${p.status} output=${JSON.stringify(p.output)?.slice(0, 60)}`);
    if (p.kind === "text" && p.text) console.log(`  text ${JSON.stringify(p.text).slice(0, 120)}`);
  }
}
console.log("error:", controller.current.error ?? "none");

controller.dispose();
process.exit(0);
