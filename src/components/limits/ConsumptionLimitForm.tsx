import { useEffect, useState } from "react";
import { Save, Zap } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { useLimitUpsert } from "@/components/hooks/useLimitUpsert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConsumptionLimit, WindowType } from "@/types";
import { WINDOW_TYPE_LABELS } from "@/components/limits/limit-labels";

interface PreviewProps {
  consumptionKwh: number;
  thresholdKwh: number;
  hasReadings: boolean;
}

interface ConsumptionLimitFormProps {
  initialLimit: ConsumptionLimit | null;
  preview: PreviewProps | null;
}

export default function ConsumptionLimitForm({ initialLimit, preview }: ConsumptionLimitFormProps) {
  const [limit, setLimit] = useState<ConsumptionLimit | null>(initialLimit);
  const [threshold, setThreshold] = useState(initialLimit ? String(initialLimit.threshold_kwh) : "");
  const [windowType, setWindowType] = useState<WindowType>(initialLimit?.window_type ?? "day");
  const [successVisible, setSuccessVisible] = useState(false);

  const { upsert, isSubmitting, errorMessage, clearErrors } = useLimitUpsert();

  useEffect(() => {
    if (!successVisible) return;
    const timer = setTimeout(() => {
      setSuccessVisible(false);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [successVisible]);

  const effectiveThreshold = limit ? limit.threshold_kwh : null;
  const barPercent =
    preview && effectiveThreshold && effectiveThreshold > 0
      ? Math.min(100, (preview.consumptionKwh / effectiveThreshold) * 100)
      : null;

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();

    const saved = await upsert({ threshold_kwh: Number(threshold), window_type: windowType });
    if (saved) {
      setLimit(saved);
      setSuccessVisible(true);
    }
  }

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">Limit zużycia energii</h2>
      <p className="mb-4 text-sm text-blue-100/70">
        Ustaw próg kWh i okno czasowe, po przekroczeniu którego otrzymasz powiadomienie.
      </p>

      {successVisible ? (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-900/20 px-3 py-2 text-sm text-green-200">
          Limit zapisany pomyślnie.
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="threshold-kwh" className="block text-sm text-blue-100/80">
            Próg zużycia (kWh)
          </label>
          <div className="relative">
            <Zap className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-blue-100/50" />
            <input
              id="threshold-kwh"
              type="number"
              min="0.001"
              step="any"
              value={threshold}
              onChange={(e) => {
                setThreshold(e.target.value);
                clearErrors();
              }}
              placeholder="np. 10"
              className={cn(
                "w-full rounded-lg border border-white/20 bg-white/10 py-2 pr-3 pl-9 text-sm text-white placeholder:text-blue-100/30 focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/40 focus:outline-none",
              )}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="window-type" className="block text-sm text-blue-100/80">
            Okno czasowe
          </label>
          <select
            id="window-type"
            value={windowType}
            onChange={(e) => {
              setWindowType(e.target.value as WindowType);
            }}
            className={cn(
              "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/40 focus:outline-none",
            )}
          >
            {(["day", "week", "month"] as WindowType[]).map((wt) => (
              <option key={wt} value={wt} className="bg-slate-900 text-white">
                {WINDOW_TYPE_LABELS[wt]}
              </option>
            ))}
          </select>
        </div>

        <ServerError message={errorMessage} />

        <Button
          type="submit"
          disabled={isSubmitting}
          className={cn("w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500")}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Zapisywanie…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Save className="size-4" />
              Zapisz limit
            </span>
          )}
        </Button>
      </form>

      {preview && effectiveThreshold && preview.hasReadings ? (
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-100/70">Zużycie w oknie</span>
            <span className="font-medium text-white">
              {preview.consumptionKwh.toFixed(3)} / {effectiveThreshold} kWh
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                barPercent !== null && barPercent >= 100
                  ? "bg-red-500"
                  : barPercent !== null && barPercent >= 80
                    ? "bg-amber-400"
                    : "bg-purple-500",
              )}
              style={{ width: `${barPercent ?? 0}%` }}
            />
          </div>
        </div>
      ) : preview && !preview.hasReadings ? (
        <p className="mt-4 text-sm text-blue-100/50">Brak odczytów w bieżącym oknie czasowym.</p>
      ) : !preview ? (
        <p className="mt-4 text-sm text-blue-100/50">Zarejestruj licznik, aby zobaczyć zużycie w oknie.</p>
      ) : null}
    </section>
  );
}
