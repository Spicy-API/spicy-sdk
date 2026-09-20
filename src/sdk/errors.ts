import type { TaskRecord } from "./types.js";

export interface SpicyApiErrorOptions {
  status: number;
  code?: number | undefined;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
  rateLimitLimit?: number | undefined;
  rateLimitRemaining?: number | undefined;
  /**
   * The raw reply, truncated, and only when it was not the platform's JSON envelope - which means
   * it was not written by the platform. It names the layer that answered instead.
   */
  responseBody?: string | undefined;
}

export class SpicyApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly rateLimitLimit: number | undefined;
  readonly rateLimitRemaining: number | undefined;
  readonly responseBody: string | undefined;

  constructor(message: string, options: SpicyApiErrorOptions) {
    super(message);
    this.name = "SpicyApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.rateLimitLimit = options.rateLimitLimit;
    this.rateLimitRemaining = options.rateLimitRemaining;
    this.responseBody = options.responseBody;
  }
}

export class SpicyTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpicyTransportError";
  }
}

export class SpicyTimeoutError extends SpicyTransportError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`request exceeded the local ${timeoutMs}ms timeout`);
    this.name = "SpicyTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class SpicyWaitTimeoutError extends Error {
  readonly taskId: string;
  readonly timeoutMs: number;
  readonly lastTask: TaskRecord | undefined;

  constructor(taskId: string, timeoutMs: number, lastTask?: TaskRecord) {
    super(`task ${taskId} did not reach a terminal state within ${timeoutMs}ms`);
    this.name = "SpicyWaitTimeoutError";
    this.taskId = taskId;
    this.timeoutMs = timeoutMs;
    this.lastTask = lastTask;
  }
}

export class SpicyUploadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SpicyUploadError";
    this.status = status;
  }
}
