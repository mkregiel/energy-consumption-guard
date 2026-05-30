import { useCallback, useEffect, useState } from "react";
import type { TuyaApiErrorBody, TuyaApiSuccess, TuyaDeviceSummary, TuyaDevicesResult } from "@/types";

export type TuyaDevicesLoadStatus = "idle" | "loading" | "success" | "error";

export interface UseTuyaDevicesParams {
  enabled: boolean;
}

export interface UseTuyaDevicesResult {
  devices: TuyaDeviceSummary[];
  status: TuyaDevicesLoadStatus;
  errorMessage: string | null;
  errorCode: string | null;
  isNotLinked: boolean;
  refetch: () => void;
}

const polishDevicesError = (code: string, fallback: string): string => {
  switch (code) {
    case "TUYA_NOT_LINKED":
      return "Połącz konto Tuya, aby zobaczyć listę urządzeń.";
    case "TUYA_AUTH_FAILED":
    case "TUYA_TOKEN_EXPIRED":
      return "Sesja Tuya wygasła. Połącz konto ponownie.";
    case "TUYA_CONFIG_MISSING":
      return "Integracja Tuya nie jest skonfigurowana na serwerze.";
    case "TUYA_PROVIDER_ERROR":
      return "Nie udało się pobrać listy urządzeń. Wpisz Device ID ręcznie poniżej.";
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie.";
    default:
      return fallback;
  }
};

export function useTuyaDevices({ enabled }: UseTuyaDevicesParams): UseTuyaDevicesResult {
  const [devices, setDevices] = useState<TuyaDeviceSummary[]>([]);
  const [status, setStatus] = useState<TuyaDevicesLoadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isNotLinked, setIsNotLinked] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => {
    setFetchKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function loadDevices() {
      setStatus("loading");
      setErrorMessage(null);
      setErrorCode(null);
      setIsNotLinked(false);

      try {
        const response = await fetch("/api/tuya/devices");
        const body = (await response.json()) as TuyaApiSuccess<TuyaDevicesResult> | TuyaApiErrorBody;

        if (cancelled) {
          return;
        }

        if (!body.ok) {
          const notLinked = body.error.code === "TUYA_NOT_LINKED";
          setIsNotLinked(notLinked);
          setStatus("error");
          setErrorCode(body.error.code);
          setErrorMessage(polishDevicesError(body.error.code, body.error.message));
          setDevices([]);
          return;
        }

        setDevices(body.data.devices);
        setStatus("success");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Nie udało się pobrać listy urządzeń. Sprawdź połączenie i spróbuj ponownie.");
          setDevices([]);
        }
      }
    }

    void loadDevices();

    return () => {
      cancelled = true;
    };
  }, [enabled, fetchKey]);

  return { devices, status, errorMessage, errorCode, isNotLinked, refetch };
}
