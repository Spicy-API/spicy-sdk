import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { components } from "../generated/openapi.js";

export type WebhookPayload =
  components["schemas"]["LegacyWebhookPayload"] | components["schemas"]["TaskRecordEnvelope"];

export type WebhookPayloadVersion = 1 | 2;

export interface VerifyWebhookOptions {
  rawBody: string | Uint8Array;
  timestamp: string;
  signature: string;
  payloadVersion: WebhookPayloadVersion;
  secret: string;
  toleranceSeconds?: number;
  now?: () => number;
  maxBodyBytes?: number;
}

export interface VerifiedWebhook<T extends WebhookPayload = WebhookPayload> {
  payload: T;
  payloadVersion: WebhookPayloadVersion;
  taskId: string;
  deliveryId?: string;
  timestamp: number;
}

export type WebhookVerificationReason =
  | "body_too_large"
  | "invalid_json"
  | "invalid_payload"
  | "invalid_secret"
  | "invalid_signature"
  | "invalid_timestamp"
  | "stale_timestamp";

export class SpicyWebhookVerificationError extends Error {
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message);
    this.name = "SpicyWebhookVerificationError";
    this.reason = reason;
  }
}

function rawBytes(rawBody: string | Uint8Array): Uint8Array {
  return typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody;
}

function extractTaskId(payload: unknown, version: WebhookPayloadVersion): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (version === 1) return typeof record.task_id === "string" ? record.task_id : undefined;
  if (record.data === null || typeof record.data !== "object" || Array.isArray(record.data))
    return undefined;
  const data = record.data as Record<string, unknown>;
  return typeof data.taskId === "string" ? data.taskId : undefined;
}

export function computeWebhookSignature(
  taskId: string,
  timestamp: string | number,
  rawBody: string | Uint8Array,
  secret: string,
): string {
  const digest = createHash("sha256").update(rawBytes(rawBody)).digest("hex");
  return createHmac("sha256", secret).update(`${taskId}.${timestamp}.${digest}`).digest("base64");
}

export function verifyWebhook<T extends WebhookPayload = WebhookPayload>(
  options: VerifyWebhookOptions,
): VerifiedWebhook<T> {
  const bytes = rawBytes(options.rawBody);
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  if (bytes.byteLength > maxBodyBytes) {
    throw new SpicyWebhookVerificationError(
      "body_too_large",
      `webhook body exceeds ${maxBodyBytes} bytes`,
    );
  }
  if (!options.secret.trim()) {
    throw new SpicyWebhookVerificationError("invalid_secret", "webhook secret is required");
  }
  if (!/^\d+$/.test(options.timestamp)) {
    throw new SpicyWebhookVerificationError(
      "invalid_timestamp",
      "webhook timestamp must be Unix seconds",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SpicyWebhookVerificationError("invalid_json", "webhook body is not valid JSON");
  }
  const taskId = extractTaskId(payload, options.payloadVersion);
  if (!taskId) {
    throw new SpicyWebhookVerificationError(
      "invalid_payload",
      `webhook payload version ${options.payloadVersion} does not contain a task ID`,
    );
  }

  const expected = Buffer.from(
    computeWebhookSignature(taskId, options.timestamp, bytes, options.secret),
    "base64",
  );
  const suppliedRaw = Buffer.from(options.signature, "base64");
  const supplied = Buffer.alloc(expected.byteLength);
  suppliedRaw.copy(supplied, 0, 0, expected.byteLength);
  const signatureMatches =
    suppliedRaw.byteLength === expected.byteLength && timingSafeEqual(expected, supplied);
  if (!signatureMatches) {
    throw new SpicyWebhookVerificationError(
      "invalid_signature",
      "webhook signature does not match",
    );
  }

  const timestamp = Number(options.timestamp);
  if (!Number.isSafeInteger(timestamp)) {
    throw new SpicyWebhookVerificationError(
      "invalid_timestamp",
      "webhook timestamp is outside the safe range",
    );
  }
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  if (!Number.isInteger(toleranceSeconds) || toleranceSeconds < 0 || toleranceSeconds > 86_400) {
    throw new TypeError("toleranceSeconds must be an integer between 0 and 86400");
  }
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1_000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new SpicyWebhookVerificationError(
      "stale_timestamp",
      "webhook timestamp is outside the tolerance window",
    );
  }

  const record = payload as Record<string, unknown>;
  const deliveryId =
    options.payloadVersion === 2 && typeof record.request_id === "string"
      ? record.request_id
      : undefined;
  return {
    payload: payload as T,
    payloadVersion: options.payloadVersion,
    taskId,
    ...(deliveryId === undefined ? {} : { deliveryId }),
    timestamp,
  };
}
