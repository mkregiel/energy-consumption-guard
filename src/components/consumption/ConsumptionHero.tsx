import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConsumptionReading } from "@/types";

interface ConsumptionHeroProps {
  latestReading: ConsumptionReading | null;
  meterLabel: string;
}

const formatRecordedAt = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Warsaw",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatKwh = (value: number): string =>
  new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  }).format(value);

const sourceLabel = (source: ConsumptionReading["source"]): string => (source === "tuya" ? "Tuya" : "Ręczny");

export default function ConsumptionHero({ latestReading, meterLabel }: ConsumptionHeroProps) {
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">Aktualny odczyt</h2>
      <p className="mb-4 text-sm text-blue-100/70">{meterLabel}</p>

      {latestReading ? (
        <div className="space-y-3">
          <p className="flex items-baseline gap-2">
            <Zap className="size-6 shrink-0 text-amber-300" aria-hidden />
            <span className="text-4xl font-bold text-white tabular-nums">
              {formatKwh(latestReading.kwh_cumulative)}
            </span>
            <span className="text-lg text-blue-100/70">kWh</span>
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-blue-100/50">Czas odczytu</dt>
              <dd className="text-white">{formatRecordedAt(latestReading.recorded_at)}</dd>
            </div>
            <div>
              <dt className="text-blue-100/50">Źródło</dt>
              <dd className="text-white">{sourceLabel(latestReading.source)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center text-sm text-blue-100/70">
          Brak odczytów — zsynchronizuj licznik
        </p>
      )}
    </section>
  );
}
