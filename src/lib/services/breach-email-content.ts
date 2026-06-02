import type { WindowType } from "@/types";

const WINDOW_TYPE_LABELS: Record<WindowType, string> = {
  day: "dzień",
  week: "tydzień",
  month: "miesiąc",
};

const formatKwh = (value: number): string => `${value.toFixed(2)} kWh`;

const formatTimestamp = (iso: string, timezone: string): string =>
  new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));

export const buildBreachAlarmEmail = (params: {
  consumptionKwh: number;
  thresholdKwh: number;
  windowType: WindowType;
  timezone: string;
  breachedAt: string;
  windowStart?: string | null;
}): { subject: string; text: string } => {
  const windowLabel = WINDOW_TYPE_LABELS[params.windowType];
  const breachedAtFormatted = formatTimestamp(params.breachedAt, params.timezone);

  const subject = "[Monitor energii] Przekroczono limit zużycia";
  const lines = [
    "Wykryto przekroczenie limitu zużycia energii.",
    "",
    `Zużycie: ${formatKwh(params.consumptionKwh)}`,
    `Próg limitu: ${formatKwh(params.thresholdKwh)}`,
    `Okno: ${windowLabel}`,
    `Strefa czasowa: ${params.timezone}`,
  ];

  if (params.windowStart != null) {
    lines.push(`Początek okna: ${formatTimestamp(params.windowStart, params.timezone)}`);
  }

  lines.push(`Czas naruszenia: ${breachedAtFormatted}`, "", "—", "Monitor energii");

  return { subject, text: lines.join("\n") };
};
