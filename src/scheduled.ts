import { createServiceRoleClient } from "@/lib/supabase-service-role";
import { runBatchTuyaSync } from "@/lib/services/cron-sync";
import { runLimitEvaluation } from "@/lib/services/limit-evaluation";
import { runBreachNotifications } from "@/lib/services/breach-notifications";

const SYNC_CRON = "0 * * * *";
const EVALUATE_CRON = "5 * * * *";
const NOTIFY_CRON = "10 * * * *";

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
  type: "scheduled";
}

export const runScheduledJob = async (controller: ScheduledController): Promise<void> => {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    console.error("Scheduled job skipped: service role Supabase client is not configured.");
    return;
  }

  try {
    if (controller.cron === SYNC_CRON) {
      const result = await runBatchTuyaSync(supabase);
      console.log(JSON.stringify(result));
      return;
    }

    if (controller.cron === EVALUATE_CRON) {
      const result = await runLimitEvaluation(supabase);
      console.log(JSON.stringify(result));
      return;
    }

    if (controller.cron === NOTIFY_CRON) {
      const result = await runBreachNotifications(supabase);
      console.log(JSON.stringify(result));
      return;
    }

    console.error("Scheduled job received unknown cron expression", { cron: controller.cron });
  } catch (error) {
    console.error("Scheduled job failed", { cron: controller.cron, error });
  }
};
