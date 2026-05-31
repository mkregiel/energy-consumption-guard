import { RefreshCw } from "lucide-react";
import { useTuyaSync } from "@/components/hooks/useTuyaSync";
import { TuyaErrorBanner } from "@/components/consumption/TuyaErrorBanner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SyncConsumptionButtonProps {
  disabled?: boolean;
  meterId?: string;
}

export default function SyncConsumptionButton({ disabled = false, meterId }: SyncConsumptionButtonProps) {
  const { sync, isSyncing, errorDisplay, retry } = useTuyaSync();

  const isDisabled = disabled || isSyncing;

  return (
    <div className="space-y-3">
      <Button
        type="button"
        disabled={isDisabled}
        onClick={() => {
          void sync(meterId ? { meterId } : undefined);
        }}
        className={cn(
          "w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500",
          isDisabled && "opacity-50",
        )}
      >
        {isSyncing ? (
          <span className="flex items-center justify-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Synchronizacja…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <RefreshCw className="size-4" />
            Synchronizuj teraz
          </span>
        )}
      </Button>

      <TuyaErrorBanner display={errorDisplay} onRetry={retry} />
    </div>
  );
}
