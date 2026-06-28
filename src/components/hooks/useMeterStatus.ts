import { useCallback, useState } from "react";
import type { Meter, TuyaApiErrorBody, TuyaApiSuccess } from "@/types";

export interface UseMeterStatusResult {
  updateStatus: (status: "active" | "inactive") => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}

export function useMeterStatus(): UseMeterStatusResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback(async (status: "active" | "inactive"): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/meters/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const body = (await response.json()) as TuyaApiSuccess<{ meter: Meter }> | TuyaApiErrorBody;

      if (!body.ok) {
        setError(body.error.message);
        return false;
      }

      window.location.reload();
      return true;
    } catch {
      setError("Nie udało się zmienić statusu monitoringu. Spróbuj ponownie.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { updateStatus, isLoading, error };
}
