import { useCallback, useRef, useState } from "react";
import { getTuyaErrorDisplay, type TuyaErrorDisplay } from "@/lib/tuya-error-messages";
import type { TuyaApiErrorBody, TuyaApiSuccess, TuyaSyncPayload, TuyaSyncResult } from "@/types";

export interface UseTuyaSyncResult {
  sync: (options?: TuyaSyncPayload) => Promise<boolean>;
  isSyncing: boolean;
  errorDisplay: TuyaErrorDisplay | null;
  retry: () => void;
}

export function useTuyaSync(): UseTuyaSyncResult {
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorDisplay, setErrorDisplay] = useState<TuyaErrorDisplay | null>(null);
  const lastOptionsRef = useRef<TuyaSyncPayload | undefined>(undefined);

  const sync = useCallback(async (options?: TuyaSyncPayload): Promise<boolean> => {
    lastOptionsRef.current = options;
    setIsSyncing(true);
    setErrorDisplay(null);

    try {
      const response = await fetch("/api/tuya/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });

      const body = (await response.json()) as TuyaApiSuccess<TuyaSyncResult> | TuyaApiErrorBody;

      if (!body.ok) {
        setErrorDisplay(getTuyaErrorDisplay(body.error.code, body.error.message));
        return false;
      }

      window.location.reload();
      return true;
    } catch {
      setErrorDisplay(getTuyaErrorDisplay("TUYA_PROVIDER_ERROR"));
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const retry = useCallback(() => {
    void sync(lastOptionsRef.current);
  }, [sync]);

  return { sync, isSyncing, errorDisplay, retry };
}
