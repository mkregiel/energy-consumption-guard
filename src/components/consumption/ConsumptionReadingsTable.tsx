import { cn } from "@/lib/utils";
import type { ConsumptionReading } from "@/types";

interface ConsumptionReadingsTableProps {
  readings: ConsumptionReading[];
}

const formatRecordedAt = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short",
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

const formatDelta = (delta: number | null): string => {
  if (delta === null) {
    return "—";
  }

  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatKwh(delta)}`;
};

export default function ConsumptionReadingsTable({ readings }: ConsumptionReadingsTableProps) {
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">Historia odczytów</h2>
      <p className="mb-4 text-sm text-blue-100/70">Ostatnie {readings.length} synchronizacji</p>

      {readings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center text-sm text-blue-100/70">
          Brak odczytów — zsynchronizuj licznik
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-blue-100/50">
                  <th className="pr-4 pb-2 font-medium">Czas</th>
                  <th className="pr-4 pb-2 font-medium">kWh (skumulowane)</th>
                  <th className="pb-2 font-medium">Zmiana</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((reading) => (
                  <tr key={reading.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4 text-blue-100/90 tabular-nums">{formatRecordedAt(reading.recorded_at)}</td>
                    <td className="py-2 pr-4 text-white tabular-nums">{formatKwh(reading.kwh_cumulative)}</td>
                    <td className="py-2 text-blue-100/80 tabular-nums">{formatDelta(reading.kwh_delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 sm:hidden">
            {readings.map((reading) => (
              <li key={reading.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                <p className="text-blue-100/90 tabular-nums">{formatRecordedAt(reading.recorded_at)}</p>
                <p className="mt-1 text-white tabular-nums">
                  {formatKwh(reading.kwh_cumulative)} kWh
                  {reading.kwh_delta !== null ? (
                    <span className="ml-2 text-blue-100/70">({formatDelta(reading.kwh_delta)} kWh)</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
