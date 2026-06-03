import { useCallback, useState } from "react";
import type { ConsumptionLimit, LimitUpsertPayload, TuyaApiErrorBody, TuyaApiSuccess } from "@/types";

export interface UseLimitUpsertResult {
  upsert: (payload: LimitUpsertPayload) => Promise<ConsumptionLimit | null>;
  isSubmitting: boolean;
  errorMessage: string | null;
  clearErrors: () => void;
}

const polishLimitError = (code: string, fallback: string): string => {
  switch (code) {
    case "VALIDATION_ERROR":
      return "Sprawdź poprawność pól formularza.";
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie.";
    default:
      return fallback;
  }
};

export function useLimitUpsert(): UseLimitUpsertResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearErrors = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const upsert = useCallback(async (payload: LimitUpsertPayload): Promise<ConsumptionLimit | null> => {
    setErrorMessage(null);
    if (!(payload.threshold_kwh > 0)) {
      setErrorMessage("Próg zużycia musi być większy od zera.");
      return null;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload satisfies LimitUpsertPayload),
      });

      const body = (await response.json()) as TuyaApiSuccess<{ limit: ConsumptionLimit }> | TuyaApiErrorBody;

      if (!body.ok) {
        setErrorMessage(polishLimitError(body.error.code, body.error.message));
        return null;
      }

      return body.data.limit;
    } catch {
      setErrorMessage("Nie udało się zapisać limitu. Sprawdź połączenie i spróbuj ponownie.");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { upsert, isSubmitting, errorMessage, clearErrors };
}
