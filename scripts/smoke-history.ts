import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { SessionController } from "../src/session/SessionController.js";

const controller = new SessionController(
  (m, ...a) => console.log("[log]", m, ...a),
  () => {},
  process.cwd(),
);

await controller.start();
await new Promise((r) => setTimeout(r, 1500));

const sessions = controller.current.sessions;
console.log("after start: sessionID =", controller.current.sessionID, "(lazy)");
console.log("sessions loaded:", sessions.length);
for (const s of sessions.slice(0, 4)) {
  console.log(`  - ${s.id}  ${JSON.stringify(s.title)}  model=${s.model?.id ?? "-"}`);
}

// Open an older session (the last one) and read its messages.
const target = sessions[sessions.length - 1];
if (target) {
  await controller.openSession(target.id);
  console.log(
    `opened ${target.id} -> active=${controller.current.sessionID} title=${JSON.stringify(controller.current.sessionTitle)} messages=${controller.current.messages.length} model=${controller.current.selectedModel?.id ?? "-"}`,
  );
}

// Create a throwaway session and delete it through the controller.
const endpoint = await Service.ensure();
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
const throwaway = await client.session.create({ location: { directory: process.cwd() }, title: "smoke-throwaway" });
await controller.loadSessions();
const before = controller.current.sessions.length;
console.log("before delete:", before, "throwaway present:", controller.current.sessions.some((s) => s.id === throwaway.id));

await controller.deleteSession(throwaway.id);
const after = controller.current.sessions.length;
console.log("after delete:", after, "throwaway present:", controller.current.sessions.some((s) => s.id === throwaway.id));

controller.dispose();
process.exit(0);
