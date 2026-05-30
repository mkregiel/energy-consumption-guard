import { useEffect, useState } from "react";
import type { TuyaApiErrorBody, TuyaApiSuccess, TuyaOAuthCallbackPayload } from "@/types";

export type TuyaOAuthCallbackStatus = "idle" | "loading" | "success" | "error";

export interface UseTuyaOAuthCallbackParams {
  code: string | null;
  state: string | null;
}

export interface UseTuyaOAuthCallbackResult {
  status: TuyaOAuthCallbackStatus;
  errorMessage: string | null;
  errorCode: string | null;
}

const MISSING_PARAMS_MESSAGE = "Brak parametrów autoryzacji. Spróbuj połączyć konto ponownie.";

const polishOAuthError = (code: string, fallback: string): string => {
  switch (code) {
    case "TUYA_STATE_MISMATCH":
      return "Sesja autoryzacji wygasła lub jest nieprawidłowa. Połącz konto Tuya ponownie.";
    case "TUYA_AUTH_FAILED":
      return "Tuya odrzuciło autoryzację. Spróbuj połączyć konto ponownie.";
    case "TUYA_CONFIG_MISSING":
      return "Integracja Tuya nie jest skonfigurowana na serwerze.";
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.";
    case "VALIDATION_ERROR":
      return "Nieprawidłowe dane zwrotne z Tuya. Spróbuj połączyć konto ponownie.";
    default:
      return fallback;
  }
};

export function useTuyaOAuthCallback({ code, state }: UseTuyaOAuthCallbackParams): UseTuyaOAuthCallbackResult {
  const hasParams = Boolean(code && state);

  const [status, setStatus] = useState<TuyaOAuthCallbackStatus>(() => (hasParams ? "idle" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() => (hasParams ? null : MISSING_PARAMS_MESSAGE));
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!hasParams || !code || !state) {
      return;
    }

    let cancelled = false;

    async function completeOAuth() {
      setStatus("loading");
      setErrorMessage(null);
      setErrorCode(null);

      try {
        const response = await fetch("/api/tuya/oauth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state } satisfies TuyaOAuthCallbackPayload),
        });

        const body = (await response.json()) as TuyaApiSuccess<Record<string, unknown>> | TuyaApiErrorBody;

        if (cancelled) {
          return;
        }

        if (!body.ok) {
          setStatus("error");
          setErrorCode(body.error.code);
          setErrorMessage(polishOAuthError(body.error.code, body.error.message));
          return;
        }

        setStatus("success");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Nie udało się połączyć konta Tuya. Sprawdź połączenie i spróbuj ponownie.");
        }
      }
    }

    void completeOAuth();

    return () => {
      cancelled = true;
    };
  }, [code, state, hasParams]);

  return { status, errorMessage, errorCode };
}
