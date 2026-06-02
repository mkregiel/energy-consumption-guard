import { RESEND_API_KEY, RESEND_FROM_EMAIL } from "astro:env/server";

export const isResendConfigured = (): boolean => Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);

export const sendPlainTextEmail = async (params: { to: string; subject: string; text: string }): Promise<void> => {
  if (!isResendConfigured()) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    throw new Error(`Resend API error (${response.status}): ${snippet}`);
  }
};
