import { useCallback, useState } from "react";
import type { Meter, MeterUpsertPayload, TuyaApiErrorBody, TuyaApiSuccess } from "@/types";

export interface MeterUpsertFieldErrors {
  label?: string;
  tuya_device_id?: string;
}

export interface UseMeterUpsertResult {
  upsert: (payload: MeterUpsertPayload) => Promise<Meter | null>;
  isSubmitting: boolean;
  errorMessage: string | null;
  fieldErrors: MeterUpsertFieldErrors;
  clearErrors: () => void;
}

const polishMeterError = (code: string, fallback: string): string => {
  switch (code) {
    case "VALIDATION_ERROR":
      return "Sprawdź poprawność pól formularza.";
    case "UNAUTHORIZED":
      return "Sesja wygasła. Zaloguj się ponownie.";
    default:
      return fallback;
  }
};

const validatePayload = (payload: MeterUpsertPayload): MeterUpsertFieldErrors => {
  const errors: MeterUpsertFieldErrors = {};
  const label = payload.label.trim();
  const deviceId = payload.tuya_device_id.trim();

  if (label.length === 0) {
    errors.label = "Nazwa licznika jest wymagana.";
  }

  if (deviceId.length === 0) {
    errors.tuya_device_id = "Device ID jest wymagane.";
  }

  return errors;
};

export function useMeterUpsert(): UseMeterUpsertResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MeterUpsertFieldErrors>({});

  const clearErrors = useCallback(() => {
    setErrorMessage(null);
    setFieldErrors({});
  }, []);

  const upsert = useCallback(async (payload: MeterUpsertPayload): Promise<Meter | null> => {
    const nextFieldErrors = validatePayload(payload);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setErrorMessage(null);
      return null;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/meters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: payload.label.trim(),
          tuya_device_id: payload.tuya_device_id.trim(),
          ...(payload.tuya_product_id?.trim() ? { tuya_product_id: payload.tuya_product_id.trim() } : {}),
        } satisfies MeterUpsertPayload),
      });

      const body = (await response.json()) as TuyaApiSuccess<{ meter: Meter }> | TuyaApiErrorBody;

      if (!body.ok) {
        setErrorMessage(polishMeterError(body.error.code, body.error.message));
        return null;
      }

      return body.data.meter;
    } catch {
      setErrorMessage("Nie udało się zapisać licznika. Sprawdź połączenie i spróbuj ponownie.");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { upsert, isSubmitting, errorMessage, fieldErrors, clearErrors };
}
