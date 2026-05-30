import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useTuyaOAuthCallback } from "@/components/hooks/useTuyaOAuthCallback";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TuyaOAuthCallbackPanelProps {
  code: string | null;
  state: string | null;
}

export default function TuyaOAuthCallbackPanel({ code, state }: TuyaOAuthCallbackPanelProps) {
  const { status, errorMessage, errorCode } = useTuyaOAuthCallback({ code, state });

  return (
    <div className="space-y-4 text-center">
      {status === "loading" || status === "idle" ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="size-10 animate-spin text-purple-300" aria-hidden />
          <p className="text-blue-100/80">Łączenie konta Tuya / Smart Life…</p>
        </div>
      ) : null}

      {status === "success" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <CheckCircle2 className="size-10 text-emerald-400" aria-hidden />
          <p className="font-medium text-white">Konto Tuya zostało połączone.</p>
          <p className="text-sm text-blue-100/70">Możesz teraz zarejestrować licznik na pulpicie.</p>
          <Button
            asChild
            className={cn("mt-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500")}
          >
            <a href="/dashboard">Przejdź do pulpitu</a>
          </Button>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="space-y-4 text-left">
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CircleAlert className="size-10 text-red-400" aria-hidden />
            <p className="font-medium text-white">Nie udało się połączyć konta</p>
            {errorCode ? <p className="text-xs text-blue-100/50">Kod: {errorCode}</p> : null}
          </div>
          <ServerError message={errorMessage} />
          <Button
            asChild
            className={cn(
              "w-full rounded-lg border border-white/20 bg-white/10 font-medium text-white hover:bg-white/20",
            )}
          >
            <a href="/api/tuya/oauth/start">
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="size-4" />
                Połącz ponownie
              </span>
            </a>
          </Button>
          <p className="text-center text-sm text-blue-100/60">
            <a href="/dashboard" className="text-purple-300 hover:underline">
              Wróć do pulpitu
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
