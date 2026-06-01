export const apiJsonError = (status: number, code: string, message: string, details?: unknown) =>
  Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );

export const apiJsonSuccess = (status: number, data: Record<string, unknown>) =>
  Response.json(
    {
      ok: true,
      data,
    },
    { status },
  );
