import { createServer, type Server } from "node:http";

interface TuyaApiEnvelope<T> {
  success: boolean;
  result?: T;
  code?: number;
  msg?: string;
  t: number;
}

const TOKEN_RESULT = {
  uid: "e2e-tuya-uid",
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  expire_time: 7200,
};

const DEVICES_RESULT = [
  {
    id: "e2e-device-1",
    name: "E2E Test Meter",
    product_id: "e2e-product",
    online: true,
  },
];

const DEVICE_STATUS_RESULT = [{ code: "total_electricity", value: 12345 }];

const sendJson = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
};

const envelope = <T>(result: T): TuyaApiEnvelope<T> => ({ success: true, result, t: Date.now() });

/**
 * Minimal stand-in for Tuya's Cloud API: only the two endpoints the OAuth
 * connect flow exercises (authorization-code exchange + device list). Auth
 * headers (HMAC signature) are not validated.
 */
export async function startTuyaStub(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/v1.0/token") {
      const code = url.searchParams.get("code");
      if (code === "e2e-tuya-error") {
        sendJson(res, 200, { success: false, code: 1106, msg: "e2e stub: invalid code", t: Date.now() });
        return;
      }
      sendJson(res, 200, envelope(TOKEN_RESULT));
      return;
    }

    if (req.method === "GET" && /^\/v1\.0\/users\/[^/]+\/devices$/.test(url.pathname)) {
      sendJson(res, 200, envelope(DEVICES_RESULT));
      return;
    }

    if (req.method === "GET" && /^\/v1\.0\/iot-03\/devices\/[^/]+\/status$/.test(url.pathname)) {
      sendJson(res, 200, envelope(DEVICE_STATUS_RESULT));
      return;
    }

    sendJson(res, 404, { success: false, code: 404, msg: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Tuya stub server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }),
      ),
  };
}
