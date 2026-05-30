import { Link2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TuyaConnectionStatus } from "@/types";

interface TuyaConnectCardProps {
  status: TuyaConnectionStatus;
}

const formatExpiry = (iso: string | null): string | null => {
  if (!iso) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Warsaw",
    }).format(new Date(iso));
  } catch {
    return null;
  }
};

export default function TuyaConnectCard({ status }: TuyaConnectCardProps) {
  const expiresLabel = formatExpiry(status.accessTokenExpiresAt);

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">Połączenie Tuya</h2>
      <p className="mb-4 text-sm text-blue-100/70">
        Połącz konto Smart Life / Tuya, aby odczytywać dane z licznika energii.
      </p>

      {status.linked ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Link2 className="size-4 shrink-0" aria-hidden />
            Konto Tuya jest połączone
          </p>
          {status.tuyaUid ? (
            <p className="text-xs text-blue-100/50">
              UID: <span className="font-mono text-blue-100/70">{status.tuyaUid}</span>
            </p>
          ) : null}
          {expiresLabel ? <p className="text-xs text-blue-100/50">Token ważny do: {expiresLabel}</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-blue-100/80">
            <Unplug className="size-4 shrink-0" aria-hidden />
            Brak połączenia z Tuya
          </p>
          <Button
            asChild
            className={cn("w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500")}
          >
            <a href="/api/tuya/oauth/start">
              <span className="flex items-center justify-center gap-2">
                <Link2 className="size-4" />
                Połącz Tuya
              </span>
            </a>
          </Button>
        </div>
      )}
    </section>
  );
}
