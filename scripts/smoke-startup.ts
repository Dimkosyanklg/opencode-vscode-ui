import { SessionController } from "../src/session/SessionController.js";

const started = Date.now();
const controller = new SessionController(
  (m, ...a) => console.log(`[+${Date.now() - started}ms][log]`, m, ...a),
  (state) => {
    console.log(
      `[+${Date.now() - started}ms] status=${state.status} modelsLoading=${state.modelsLoading} models=${state.models.length} agents=${state.agents.length} selected=${state.selectedModel?.id ?? "-"}`,
    );
  },
  process.cwd(),
);

await controller.start();
await new Promise((r) => setTimeout(r, 6000));
console.log("--- manual refreshModels()");
await controller.refreshModels();
await new Promise((r) => setTimeout(r, 3000));
console.log("FINAL models:", controller.current.models.length, "selected:", controller.current.selectedModel);

controller.dispose();
process.exit(0);
