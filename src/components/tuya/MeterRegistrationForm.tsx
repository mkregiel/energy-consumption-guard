import { useState } from "react";
import { ChevronDown, ChevronUp, Gauge, Hash, Link2, Pencil, Save, Tag } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useMeterUpsert } from "@/components/hooks/useMeterUpsert";
import { useTuyaDevices } from "@/components/hooks/useTuyaDevices";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Meter } from "@/types";

interface MeterRegistrationFormProps {
  linked: boolean;
  meter: Meter | null;
}

const truncateDeviceId = (deviceId: string, visible = 8): string => {
  if (deviceId.length <= visible * 2 + 1) {
    return deviceId;
  }

  return `${deviceId.slice(0, visible)}…${deviceId.slice(-visible)}`;
};

export default function MeterRegistrationForm({ linked, meter }: MeterRegistrationFormProps) {
  const [isEditing, setIsEditing] = useState(!meter);
  const [manualOpen, setManualOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [label, setLabel] = useState(meter?.label ?? "");
  const [manualDeviceId, setManualDeviceId] = useState("");
  const [manualProductId, setManualProductId] = useState("");

  const { devices, status, errorMessage, errorCode, isNotLinked, refetch } = useTuyaDevices({
    enabled: linked && isEditing,
  });
  const { upsert, isSubmitting, errorMessage: submitError, fieldErrors, clearErrors } = useMeterUpsert();

  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  const listLoadFailed = status === "error" && !isNotLinked;
  const useManualEntry = manualOpen || (status === "success" && devices.length === 0) || listLoadFailed;
  const resolvedDeviceId = useManualEntry ? manualDeviceId : (selectedDeviceId ?? "");
  const resolvedProductId = useManualEntry ? manualProductId : (selectedDevice?.productId ?? "");

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();

    const saved = await upsert({
      label,
      tuya_device_id: resolvedDeviceId,
      ...(resolvedProductId.trim() ? { tuya_product_id: resolvedProductId.trim() } : {}),
    });

    if (saved) {
      window.location.reload();
    }
  }

  if (!linked) {
    return (
      <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
        <h2 className="mb-1 text-lg font-semibold text-white">Licznik energii</h2>
        <p className="mb-4 text-sm text-blue-100/70">Najpierw połącz konto Tuya, aby zarejestrować licznik.</p>
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
      </section>
    );
  }

  if (meter && !isEditing) {
    return (
      <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
        <h2 className="mb-1 text-lg font-semibold text-white">Licznik energii</h2>
        <p className="mb-4 text-sm text-blue-100/70">Zarejestrowany licznik gotowy do synchronizacji odczytów.</p>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-blue-100/50">Nazwa</dt>
            <dd className="font-medium text-white">{meter.label}</dd>
          </div>
          <div>
            <dt className="text-blue-100/50">Device ID</dt>
            <dd className="font-mono text-blue-100/80" title={meter.tuya_device_id}>
              {truncateDeviceId(meter.tuya_device_id)}
            </dd>
          </div>
        </dl>
        <Button
          type="button"
          onClick={() => {
            setIsEditing(true);
            setLabel(meter.label);
            setSelectedDeviceId(null);
            setManualDeviceId("");
            setManualProductId("");
            setManualOpen(false);
          }}
          className={cn(
            "mt-4 w-full rounded-lg border border-white/20 bg-white/10 font-medium text-white hover:bg-white/20",
          )}
        >
          <span className="flex items-center justify-center gap-2">
            <Pencil className="size-4" />
            Zmień urządzenie
          </span>
        </Button>
      </section>
    );
  }

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">{meter ? "Zmiana licznika" : "Licznik energii"}</h2>
      <p className="mb-4 text-sm text-blue-100/70">
        Wybierz licznik z listy Tuya lub wpisz Device ID ręcznie, jeśli urządzenia nie widać na liście.
      </p>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <FormField
          id="meter-label"
          label="Nazwa licznika"
          value={label}
          onChange={(value) => {
            setLabel(value);
            clearErrors();
          }}
          placeholder="np. Licznik główny"
          error={fieldErrors.label}
          icon={<Tag className="size-4" />}
        />

        {status === "loading" ? <p className="text-sm text-blue-100/70">Ładowanie listy urządzeń…</p> : null}

        {isNotLinked ? <ServerError message={errorMessage} /> : null}

        {!useManualEntry && status === "success" && devices.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 block text-sm text-blue-100/80">Urządzenia Tuya</legend>
            <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {devices.map((device) => {
                const inputId = `device-${device.deviceId}`;
                const isSelected = selectedDeviceId === device.deviceId;

                return (
                  <li key={device.deviceId}>
                    <label
                      htmlFor={inputId}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
                        isSelected
                          ? "border-purple-400/60 bg-purple-500/20"
                          : "border-white/15 bg-white/5 hover:bg-white/10",
                      )}
                    >
                      <input
                        id={inputId}
                        type="radio"
                        name="tuya-device"
                        value={device.deviceId}
                        checked={isSelected}
                        onChange={() => {
                          setSelectedDeviceId(device.deviceId);
                          clearErrors();
                        }}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-white">{device.name}</span>
                        <span className="block truncate font-mono text-xs text-blue-100/50">{device.deviceId}</span>
                        {device.online !== undefined ? (
                          <span className="mt-1 block text-xs text-blue-100/50">
                            {device.online ? "Online" : "Offline"}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!selectedDeviceId ? (
              <p className="text-xs text-blue-100/50">Wybierz urządzenie z listy lub użyj wpisu ręcznego poniżej.</p>
            ) : null}
          </fieldset>
        ) : null}

        {!useManualEntry && status === "success" && devices.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
            Brak urządzeń na liście Tuya. Wpisz Device ID ręcznie w sekcji poniżej.
          </p>
        ) : null}

        {listLoadFailed ? (
          <div className="space-y-2">
            <ServerError message={errorMessage} />
            {errorCode ? <p className="text-xs text-blue-100/50">Kod: {errorCode}</p> : null}
            <Button
              type="button"
              variant="outline"
              onClick={refetch}
              className={cn("w-full border-white/20 bg-white/5 text-white hover:bg-white/10")}
            >
              Spróbuj ponownie
            </Button>
            <p className="text-sm text-blue-100/70">
              Możesz też wpisać Device ID ręcznie — sekcja poniżej pozostaje dostępna.
            </p>
          </div>
        ) : null}

        <div className="rounded-lg border border-white/10 bg-white/5">
          <button
            type="button"
            onClick={() => {
              setManualOpen((open) => !open);
              if (!manualOpen) {
                setSelectedDeviceId(null);
              }
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-blue-100/90"
          >
            <span className="flex items-center gap-2">
              <Hash className="size-4" />
              Wpisz Device ID ręcznie
            </span>
            {manualOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {manualOpen || useManualEntry ? (
            <div className="space-y-4 border-t border-white/10 px-3 py-3">
              <FormField
                id="manual-device-id"
                label="Device ID"
                value={manualDeviceId}
                onChange={(value) => {
                  setManualDeviceId(value);
                  clearErrors();
                }}
                placeholder="np. bf1234567890abcdef"
                error={useManualEntry ? fieldErrors.tuya_device_id : undefined}
                icon={<Gauge className="size-4" />}
              />
              <FormField
                id="manual-product-id"
                label="Product ID (opcjonalnie)"
                value={manualProductId}
                onChange={setManualProductId}
                placeholder="np. keyabc123"
                icon={<Hash className="size-4" />}
              />
            </div>
          ) : null}
        </div>

        {!useManualEntry && fieldErrors.tuya_device_id ? (
          <p className="text-xs text-red-300">{fieldErrors.tuya_device_id}</p>
        ) : null}

        <ServerError message={submitError} />

        <div className="flex flex-col gap-2 sm:flex-row">
          {meter ? (
            <Button
              type="button"
              onClick={() => {
                setIsEditing(false);
                clearErrors();
              }}
              className={cn(
                "rounded-lg border border-white/20 bg-white/10 font-medium text-white hover:bg-white/20 sm:flex-1",
              )}
            >
              Anuluj
            </Button>
          ) : null}
          <Button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500 sm:flex-1",
              meter ? "" : "w-full",
            )}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Zapisywanie…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Save className="size-4" />
                {meter ? "Zapisz zmiany" : "Zarejestruj licznik"}
              </span>
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
