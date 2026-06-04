import { useEffect, useState } from "react";
import { Mail, Save } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useNotificationSettingsUpsert } from "@/components/hooks/useNotificationSettingsUpsert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AlarmEmailFormProps {
  initialAlarmEmail: string | null;
}

export default function AlarmEmailForm({ initialAlarmEmail }: AlarmEmailFormProps) {
  const [alarmEmail, setAlarmEmail] = useState(initialAlarmEmail ?? "");
  const [successVisible, setSuccessVisible] = useState(false);

  const { handleSubmit, isSubmitting, errorMessage, clearErrors } = useNotificationSettingsUpsert();

  useEffect(() => {
    if (!successVisible) return;
    const timer = setTimeout(() => {
      setSuccessVisible(false);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [successVisible]);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();

    const ok = await handleSubmit(alarmEmail);
    if (ok) {
      setSuccessVisible(true);
    }
  }

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl")}>
      <h2 className="mb-1 text-lg font-semibold text-white">Adres e-mail alarmów</h2>
      <p className="mb-4 text-sm text-blue-100/70">
        Na ten adres będą wysyłane powiadomienia o przekroczeniu limitu zużycia.
      </p>

      {successVisible ? (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-900/20 px-3 py-2 text-sm text-green-200">
          Adres e-mail zapisany pomyślnie.
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormField
          id="alarm-email"
          label="Adres e-mail"
          type="email"
          value={alarmEmail}
          onChange={(value) => {
            setAlarmEmail(value);
            clearErrors();
          }}
          placeholder="np. alarm@example.com"
          icon={<Mail className="size-4" />}
        />

        <ServerError message={errorMessage} />

        <Button
          type="submit"
          disabled={isSubmitting}
          className={cn("w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500")}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Zapisywanie…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Save className="size-4" />
              Zapisz adres e-mail
            </span>
          )}
        </Button>
      </form>
    </section>
  );
}
