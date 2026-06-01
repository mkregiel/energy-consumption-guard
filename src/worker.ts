import { handle } from "@astrojs/cloudflare/handler";
import { runScheduledJob, type ScheduledController } from "./scheduled";

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: unknown, ctx: Parameters<typeof handle>[2]) {
    return handle(request, env, ctx);
  },
  scheduled(controller: ScheduledController, _env: unknown, ctx: WorkerExecutionContext) {
    ctx.waitUntil(runScheduledJob(controller));
  },
};
