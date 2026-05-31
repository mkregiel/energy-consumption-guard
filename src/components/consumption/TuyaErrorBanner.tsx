import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TuyaErrorDisplay } from "@/lib/tuya-error-messages";

interface TuyaErrorBannerProps {
  display: TuyaErrorDisplay | null;
  onRetry?: () => void;
}

export function TuyaErrorBanner({ display, onRetry }: TuyaErrorBannerProps) {
  if (!display) {
    return null;
  }

  const showRetry = display.actionLabel === "Spróbuj ponownie" && onRetry;
  const showLink = display.actionHref && display.actionLabel && !showRetry;

  return (
    <div
      className={cn(
        "rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300",
        showLink || showRetry ? "space-y-2" : "",
      )}
    >
      <p className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{display.message}</span>
      </p>
      {showRetry ? (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className={cn("h-8 border-red-400/40 bg-red-950/40 text-red-200 hover:bg-red-900/50")}
        >
          {display.actionLabel}
        </Button>
      ) : null}
      {showLink ? (
        <Button
          asChild
          variant="outline"
          className={cn("h-8 border-red-400/40 bg-red-950/40 text-red-200 hover:bg-red-900/50")}
        >
          <a href={display.actionHref}>{display.actionLabel}</a>
        </Button>
      ) : null}
    </div>
  );
}
