import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeWebhookSignature,
  SpicyWebhookVerificationError,
  verifyWebhook,
} from "../src/index.js";

const secret = "webhook-secret";
const timestamp = "1788134400";
const now = (): number => 1_788_134_400_000;

void test("verifies current version 2 webhook bytes and returns the delivery ID", () => {
  const rawBody = JSON.stringify({
    code: 200,
    msg: "success",
    request_id: "delivery_1",
    data: { taskId: "job_1", state: "succeeded" },
  });
  const signature = computeWebhookSignature("job_1", timestamp, rawBody, secret);

  const result = verifyWebhook({
    rawBody,
    timestamp,
    signature,
    payloadVersion: 2,
    secret,
    now,
  });

  assert.equal(result.taskId, "job_1");
  assert.equal(result.deliveryId, "delivery_1");
});

void test("verifies legacy version 1 task_id extraction", () => {
  const rawBody = JSON.stringify({ task_id: "job_legacy", state: "failed" });
  const signature = computeWebhookSignature("job_legacy", timestamp, rawBody, secret);

  const result = verifyWebhook({
    rawBody,
    timestamp,
    signature,
    payloadVersion: 1,
    secret,
    now,
  });

  assert.equal(result.taskId, "job_legacy");
  assert.equal(result.deliveryId, undefined);
});

void test("rejects body tampering in constant-length signature comparison", () => {
  const original = JSON.stringify({ task_id: "job_1", state: "failed" });
  const forged = JSON.stringify({ task_id: "job_1", state: "succeeded" });
  const signature = computeWebhookSignature("job_1", timestamp, original, secret);

  assert.throws(
    () =>
      verifyWebhook({
        rawBody: forged,
        timestamp,
        signature,
        payloadVersion: 1,
        secret,
        now,
      }),
    (error: unknown) =>
      error instanceof SpicyWebhookVerificationError && error.reason === "invalid_signature",
  );
});

void test("checks signature before reporting a stale timestamp", () => {
  const rawBody = JSON.stringify({ task_id: "job_1", state: "failed" });
  const staleTimestamp = "1788000000";

  assert.throws(
    () =>
      verifyWebhook({
        rawBody,
        timestamp: staleTimestamp,
        signature: "not-a-signature",
        payloadVersion: 1,
        secret,
        now,
      }),
    (error: unknown) =>
      error instanceof SpicyWebhookVerificationError && error.reason === "invalid_signature",
  );

  assert.throws(
    () =>
      verifyWebhook({
        rawBody,
        timestamp: staleTimestamp,
        signature: computeWebhookSignature("job_1", staleTimestamp, rawBody, secret),
        payloadVersion: 1,
        secret,
        now,
      }),
    (error: unknown) =>
      error instanceof SpicyWebhookVerificationError && error.reason === "stale_timestamp",
  );
});
