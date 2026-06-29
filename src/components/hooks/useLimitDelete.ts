import { useCallback, useState } from "react";
import type { TuyaApiErrorBody, TuyaApiSuccess } from "@/types";

export interface UseLimitDeleteResult {
  deleteLimit: () => Promise<boolean>;
  isDeleting: boolean;
  errorMessage: string | null;
  clearErrors: () => void;
}

const polishDeleteError = (code: string, fallback: string): string => {
  switch (code) {
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie.";
    default:
      return fallback;
  }
};

export function useLimitDelete(): UseLimitDeleteResult {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearErrors = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const deleteLimit = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/limits", { method: "DELETE" });
      const body = (await response.json()) as TuyaApiSuccess<Record<string, never>> | TuyaApiErrorBody;

      if (!body.ok) {
        setErrorMessage(polishDeleteError(body.error.code, body.error.message));
        return false;
      }

      return true;
    } catch {
      setErrorMessage("Nie udało się usunąć limitu. Sprawdź połączenie i spróbuj ponownie.");
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  return { deleteLimit, isDeleting, errorMessage, clearErrors };
}
