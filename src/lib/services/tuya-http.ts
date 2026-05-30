import type { TuyaConfig } from "@/lib/services/tuya-config";
import { mapTuyaProviderError, TuyaServiceError } from "@/lib/services/tuya-errors";

const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface TuyaTokenResult {
  uid: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface TuyaConsumptionSnapshot {
  kwhCumulative: number;
  recordedAt: string;
  sourceCode: string;
}

export interface TuyaDeviceRecord {
  id: string;
  name: string;
  productId?: string;
  online?: boolean;
}

interface TuyaApiEnvelope<T> {
  success: boolean;
  result?: T;
  code?: number;
  msg?: string;
  t?: number;
}

interface TuyaTokenApiResult {
  uid: string;
  access_token: string;
  refresh_token: string;
  expire_time?: number;
  expire?: number;
}

interface TuyaStatusItem {
  code: string;
  value: unknown;
}

interface TuyaEnergyStatisticsResult {
  total?: number;
  unit?: string;
  indicator?: string;
  list?: { date: string; value: number }[];
}

interface TuyaEnergyTrendItem {
  time: string;
  value: number;
}

interface TuyaReportLogEntry {
  code: string;
  value: unknown;
  event_time?: number;
  eventTime?: number;
}

interface TuyaReportLogsResult {
  logs?: TuyaReportLogEntry[];
  has_more?: boolean;
  hasMore?: boolean;
  last_row_key?: string;
  lastRowKey?: string;
}

interface TuyaDeviceApiItem {
  id: string;
  name?: string;
  product_id?: string;
  productId?: string;
  online?: boolean;
  is_online?: boolean;
}

const CUMULATIVE_ENERGY_CODES = [
  "total_electricity",
  "total_forward_energy",
  "forward_energy_total",
  "total_ele",
  "add_ele",
] as const;

const textEncoder = new TextEncoder();

const toHexUpper = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const hmacSha256Upper = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  return toHexUpper(signature);
};

const buildSortedQuery = (params: Record<string, string>): string => {
  const entries = Object.entries(params).sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
};

const buildStringToSign = (
  method: string,
  pathWithQuery: string,
  bodySha256: string,
  signatureHeadersBlock = "",
): string => `${method}\n${bodySha256}\n${signatureHeadersBlock}\n${pathWithQuery}`;

const createNonce = (): string => crypto.randomUUID().replace(/-/g, "");

const parseTuyaResponse = async <T>(response: Response): Promise<T> => {
  let payload: TuyaApiEnvelope<T>;
  try {
    payload = (await response.json()) as TuyaApiEnvelope<T>;
  } catch {
    throw mapTuyaProviderError(undefined, "Tuya returned a non-JSON response.");
  }

  if (!response.ok || !payload.success) {
    throw mapTuyaProviderError(payload.code, payload.msg);
  }

  if (payload.result === undefined) {
    throw mapTuyaProviderError(payload.code, "Tuya response did not include result data.");
  }

  return payload.result;
};

const normalizeEnergyValue = (code: string, rawValue: unknown): number | null => {
  const numeric =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" && rawValue.trim().length > 0
        ? Number(rawValue)
        : NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  if (code === "add_ele" || code === "total_ele") {
    // Tuya scale=3 on smart plugs (e.g. Gosund SP111): raw value / 1000 = kWh increment.
    return numeric / 1000;
  }

  if (numeric > 10_000) {
    return numeric / 1000;
  }

  return numeric;
};

const floorToMinuteIso = (date: Date): string => {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy.toISOString();
};

const floorToUtcDayStartIso = (date: Date): string =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();

const floorToUtcMonthStartIso = (date: Date): string =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();

const formatStatisticsDay = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const formatStatisticsMonth = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
};

const sumStatisticsList = (list: TuyaEnergyStatisticsResult["list"]): number =>
  (list ?? []).reduce((total, item) => total + (Number.isFinite(item.value) ? item.value : 0), 0);

const snapshotFromStatusItems = (statusItems: TuyaStatusItem[], recordedAt: Date): TuyaConsumptionSnapshot | null => {
  for (const code of CUMULATIVE_ENERGY_CODES) {
    const match = statusItems.find((item) => item.code === code);
    if (!match) {
      continue;
    }

    const kwhCumulative = normalizeEnergyValue(code, match.value);
    if (kwhCumulative === null) {
      continue;
    }

    return {
      kwhCumulative,
      recordedAt: floorToMinuteIso(recordedAt),
      sourceCode: code,
    };
  }

  return null;
};

export class HttpTuyaTransport {
  constructor(private readonly config: TuyaConfig) {}

  private async signedRequest<T>(options: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string>;
    accessToken?: string;
    body?: string;
  }): Promise<T> {
    const queryString = options.query ? buildSortedQuery(options.query) : "";
    const pathWithQuery = queryString ? `${options.path}?${queryString}` : options.path;
    const body = options.body ?? "";
    const bodySha256 =
      body.length > 0 ? toHexUpper(await crypto.subtle.digest("SHA-256", textEncoder.encode(body))) : EMPTY_BODY_SHA256;
    const timestamp = Date.now().toString();
    const nonce = createNonce();
    const stringToSign = buildStringToSign(options.method, pathWithQuery, bodySha256);
    const identifier = this.config.authMode === "app" ? this.config.appIdentifier : "";
    const signPayload = options.accessToken
      ? `${this.config.clientId}${options.accessToken}${timestamp}${nonce}${identifier}${stringToSign}`
      : `${this.config.clientId}${timestamp}${nonce}${identifier}${stringToSign}`;
    const sign = await hmacSha256Upper(this.config.clientSecret, signPayload);

    const headers: Record<string, string> = {
      client_id: this.config.clientId,
      sign,
      sign_method: "HMAC-SHA256",
      t: timestamp,
      nonce,
    };

    if (identifier.length > 0) {
      headers.identifier = identifier;
    }

    if (options.accessToken) {
      headers.access_token = options.accessToken;
    }

    if (body.length > 0) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${this.config.baseUrl}${pathWithQuery}`, {
      method: options.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });

    return parseTuyaResponse<T>(response);
  }

  async exchangeAuthorizationCode(code: string): Promise<TuyaTokenResult> {
    // OAuth 2.0 H5 (App Authorization) uses grant_type=2 on /v1.0/token.
    // grant_type=3 on /v1.0/authorize_token is a separate authorization-mode flow.
    const result = await this.signedRequest<TuyaTokenApiResult>({
      method: "GET",
      path: "/v1.0/token",
      query: {
        grant_type: "2",
        code,
      },
    });

    return {
      uid: result.uid,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresInSeconds: result.expire_time ?? result.expire ?? 7200,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TuyaTokenResult> {
    const result = await this.signedRequest<TuyaTokenApiResult>({
      method: "GET",
      path: `/v1.0/token/${encodeURIComponent(refreshToken)}`,
    });

    return {
      uid: result.uid,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresInSeconds: result.expire_time ?? result.expire ?? 7200,
    };
  }

  async getProjectAccessToken(): Promise<TuyaTokenResult> {
    const result = await this.signedRequest<TuyaTokenApiResult>({
      method: "GET",
      path: "/v1.0/token",
      query: {
        grant_type: "1",
      },
    });

    return {
      uid: result.uid,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresInSeconds: result.expire_time ?? result.expire ?? 7200,
    };
  }

  private async fetchEleUsageStatistics(
    deviceId: string,
    accessToken: string,
    dateType: "day" | "month",
    beginDate: string,
    endDate: string,
  ): Promise<number | null> {
    const body = JSON.stringify({
      dev_id: deviceId,
      indicator_code: "ele_usage",
      date_type: dateType,
      begin_date: beginDate,
      end_date: endDate,
      aggregation_type: "SUM",
    });

    try {
      const result = await this.signedRequest<TuyaEnergyStatisticsResult>({
        method: "POST",
        path: "/v1.0/m/energy/statistics/device/datadate",
        accessToken,
        body,
        query: {
          devId: deviceId,
          indicatorCode: "ele_usage",
          dateType,
          beginDate,
          endDate,
        },
      });

      if (typeof result.total === "number" && Number.isFinite(result.total)) {
        return result.total;
      }

      const listSum = sumStatisticsList(result.list);
      return Number.isFinite(listSum) ? listSum : null;
    } catch {
      return null;
    }
  }

  private async fetchIot03EnergyTrend(
    deviceId: string,
    accessToken: string,
    statisticsType: "day" | "month",
    startTime: string,
    endTime: string,
  ): Promise<number | null> {
    try {
      const result = await this.signedRequest<TuyaEnergyTrendItem[]>({
        method: "GET",
        path: "/v1.0/iot-03/energy/electricity/devices/nodes/statistics-trend",
        accessToken,
        query: {
          energy_action: "consume",
          statistics_type: statisticsType,
          start_time: startTime,
          end_time: endTime,
          device_ids: deviceId,
          contain_childs: "false",
        },
      });

      const total = result.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
      return Number.isFinite(total) ? total : null;
    } catch {
      return null;
    }
  }

  private async fetchAddEleReportLogsTotal(
    deviceId: string,
    accessToken: string,
  ): Promise<{ totalKwh: number; latestEventAt: Date } | null> {
    const endTime = Date.now();
    const startTime = endTime - 90 * 24 * 60 * 60 * 1000;
    let lastRowKey: string | undefined;
    let totalKwh = 0;
    let latestEventMs = 0;
    let hasEntries = false;

    try {
      for (let page = 0; page < 20; page += 1) {
        const query: Record<string, string> = {
          codes: "add_ele",
          start_time: startTime.toString(),
          end_time: endTime.toString(),
          size: "100",
        };

        if (lastRowKey) {
          query.last_row_key = lastRowKey;
        }

        const result = await this.signedRequest<TuyaReportLogsResult>({
          method: "GET",
          path: `/v2.1/cloud/thing/${encodeURIComponent(deviceId)}/report-logs`,
          accessToken,
          query,
        });

        for (const entry of result.logs ?? []) {
          if (entry.code !== "add_ele") {
            continue;
          }

          const incrementKwh = normalizeEnergyValue("add_ele", entry.value);
          if (incrementKwh === null) {
            continue;
          }

          hasEntries = true;
          totalKwh += incrementKwh;

          const eventTimeMs = entry.event_time ?? entry.eventTime;
          if (typeof eventTimeMs === "number" && eventTimeMs > latestEventMs) {
            latestEventMs = eventTimeMs;
          }
        }

        const nextRowKey = result.last_row_key ?? result.lastRowKey;
        const hasMore = result.has_more ?? result.hasMore;
        if (!hasMore || !nextRowKey) {
          break;
        }

        lastRowKey = nextRowKey;
      }

      if (!hasEntries) {
        return null;
      }

      return {
        totalKwh,
        latestEventAt: new Date(latestEventMs > 0 ? latestEventMs : endTime),
      };
    } catch {
      return null;
    }
  }

  private async fetchEleUsageFallback(
    deviceId: string,
    accessToken: string,
    recordedAt: Date,
  ): Promise<TuyaConsumptionSnapshot | null> {
    const monthKey = formatStatisticsMonth(recordedAt);
    const monthTotal = await this.fetchEleUsageStatistics(deviceId, accessToken, "month", monthKey, monthKey);
    if (monthTotal !== null) {
      return {
        kwhCumulative: monthTotal,
        recordedAt: floorToUtcMonthStartIso(recordedAt),
        sourceCode: "ele_usage",
      };
    }

    const dayKey = formatStatisticsDay(recordedAt);
    const dayTotal = await this.fetchEleUsageStatistics(deviceId, accessToken, "day", dayKey, dayKey);
    if (dayTotal !== null) {
      return {
        kwhCumulative: dayTotal,
        recordedAt: floorToUtcDayStartIso(recordedAt),
        sourceCode: "ele_usage",
      };
    }

    const iot03MonthTotal = await this.fetchIot03EnergyTrend(deviceId, accessToken, "month", monthKey, monthKey);
    if (iot03MonthTotal !== null) {
      return {
        kwhCumulative: iot03MonthTotal,
        recordedAt: floorToUtcMonthStartIso(recordedAt),
        sourceCode: "iot03_energy_month",
      };
    }

    const iot03DayTotal = await this.fetchIot03EnergyTrend(deviceId, accessToken, "day", dayKey, dayKey);
    if (iot03DayTotal !== null) {
      return {
        kwhCumulative: iot03DayTotal,
        recordedAt: floorToUtcDayStartIso(recordedAt),
        sourceCode: "iot03_energy_day",
      };
    }

    const reportLogsAggregate = await this.fetchAddEleReportLogsTotal(deviceId, accessToken);
    if (reportLogsAggregate) {
      return {
        kwhCumulative: reportLogsAggregate.totalKwh,
        recordedAt: floorToMinuteIso(reportLogsAggregate.latestEventAt),
        sourceCode: "add_ele_report_logs",
      };
    }

    return null;
  }

  private async fetchLegacyDeviceStatus(deviceId: string, accessToken: string): Promise<TuyaStatusItem[] | null> {
    try {
      return await this.signedRequest<TuyaStatusItem[]>({
        method: "GET",
        path: `/v1.0/devices/${encodeURIComponent(deviceId)}/status`,
        accessToken,
      });
    } catch {
      return null;
    }
  }

  async listUserDevices(uid: string, accessToken: string): Promise<TuyaDeviceRecord[]> {
    const result = await this.signedRequest<TuyaDeviceApiItem[]>({
      method: "GET",
      path: `/v1.0/users/${encodeURIComponent(uid)}/devices`,
      accessToken,
      query: {
        from: "home",
        page_no: "1",
        page_size: "50",
      },
    });

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((device) => ({
      id: device.id,
      name: typeof device.name === "string" && device.name.trim().length > 0 ? device.name : device.id,
      productId: device.product_id ?? device.productId,
      online: device.online ?? device.is_online,
    }));
  }

  async getDeviceConsumption(deviceId: string, accessToken: string): Promise<TuyaConsumptionSnapshot> {
    const recordedAt = new Date();

    const statusItems = await this.signedRequest<TuyaStatusItem[]>({
      method: "GET",
      path: `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/status`,
      accessToken,
    });

    const iot03Snapshot = snapshotFromStatusItems(statusItems, recordedAt);
    if (iot03Snapshot) {
      return iot03Snapshot;
    }

    const legacyStatusItems = await this.fetchLegacyDeviceStatus(deviceId, accessToken);
    if (legacyStatusItems) {
      const legacySnapshot = snapshotFromStatusItems(legacyStatusItems, recordedAt);
      if (legacySnapshot) {
        return legacySnapshot;
      }
    }

    const statisticsSnapshot = await this.fetchEleUsageFallback(deviceId, accessToken, recordedAt);
    if (statisticsSnapshot) {
      return statisticsSnapshot;
    }

    throw new TuyaServiceError(
      "TUYA_READING_UNAVAILABLE",
      "No supported cumulative energy status code found on device.",
      502,
      {
        deviceId,
        statusCodes: statusItems.map((item) => item.code),
        legacyStatusCodes: legacyStatusItems?.map((item) => item.code) ?? null,
      },
    );
  }
}

export const probeSdkTransportAvailability = async (): Promise<boolean> => {
  try {
    const moduleName = "@tuya/tuya-connector-nodejs";
    await import(/* @vite-ignore */ moduleName);
    return true;
  } catch {
    return false;
  }
};
