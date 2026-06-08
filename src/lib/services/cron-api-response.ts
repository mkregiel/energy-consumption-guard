export const cronJsonError = (status: number, code: string, message: string, details?: unknown) =>
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

export const cronJsonSuccess = (status: number, data: object) =>
  Response.json(
    {
      ok: true,
      data,
    },
    { status },
  );
