import { useCallback, useState } from "react";
import type { NotificationSettings, TuyaApiErrorBody, TuyaApiSuccess } from "@/types";

export interface UseNotificationSettingsUpsertResult {
  handleSubmit: (alarmEmail: string) => Promise<boolean>;
  isSubmitting: boolean;
  errorMessage: string | null;
  clearErrors: () => void;
}

const polishNotificationError = (code: string, fallback: string): string => {
  switch (code) {
    case "VALIDATION_ERROR":
      return "Adres e-mail jest nieprawidłowy.";
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie.";
    default:
      return fallback;
  }
};

export function useNotificationSettingsUpsert(): UseNotificationSettingsUpsertResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearErrors = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const handleSubmit = useCallback(async (alarmEmail: string): Promise<boolean> => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alarm_email: alarmEmail }),
      });

      const body = (await response.json()) as TuyaApiSuccess<{ settings: NotificationSettings }> | TuyaApiErrorBody;

      if (!body.ok) {
        setErrorMessage(polishNotificationError(body.error.code, body.error.message));
        return false;
      }

      return true;
    } catch {
      setErrorMessage("Wystąpił błąd. Spróbuj ponownie.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { handleSubmit, isSubmitting, errorMessage, clearErrors };
}
