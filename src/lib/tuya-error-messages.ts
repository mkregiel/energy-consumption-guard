export interface TuyaErrorDisplay {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

export const getTuyaErrorDisplay = (code: string, fallback?: string): TuyaErrorDisplay => {
  switch (code) {
    case "TUYA_NOT_LINKED":
      return {
        message: "Połącz konto Tuya, aby synchronizować odczyty.",
        actionLabel: "Połącz Tuya",
        actionHref: "/api/tuya/oauth/start",
      };
    case "TUYA_METER_NOT_FOUND":
      return {
        message: "Brak zarejestrowanego licznika. Zarejestruj urządzenie, aby pobrać odczyty.",
        actionLabel: "Zarejestruj licznik",
        actionHref: "#meter-registration",
      };
    case "TUYA_READING_UNAVAILABLE":
      return {
        message: "Tuya nie zwróciło odczytu dla tego licznika. Sprawdź urządzenie w aplikacji Smart Life.",
        actionLabel: "Spróbuj ponownie",
      };
    case "TUYA_AUTH_FAILED":
    case "TUYA_TOKEN_EXPIRED":
      return {
        message: "Sesja Tuya wygasła lub jest nieprawidłowa. Połącz konto ponownie.",
        actionLabel: "Połącz ponownie",
        actionHref: "/api/tuya/oauth/start",
      };
    case "TUYA_PROVIDER_ERROR":
      return {
        message: "Błąd po stronie Tuya. Spróbuj ponownie za chwilę.",
        actionLabel: "Spróbuj ponownie",
      };
    case "TUYA_STATE_MISMATCH":
      return {
        message: "Sesja OAuth wygasła lub jest nieprawidłowa. Rozpocznij łączenie od nowa.",
        actionLabel: "Połącz Tuya",
        actionHref: "/api/tuya/oauth/start",
      };
    case "UNAUTHORIZED":
      return {
        message: "Sesja wygasła. Zaloguj się ponownie.",
        actionLabel: "Zaloguj się",
        actionHref: "/sign-in",
      };
    default:
      return {
        message: fallback ?? "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
        actionLabel: "Spróbuj ponownie",
      };
  }
};
