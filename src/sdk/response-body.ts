/** Headers and body share one deadline; decompressed bytes are checked per chunk. */
export const MAX_API_RESPONSE_BYTES = 4 * 1_024 * 1_024;

export async function readResponseText(
  response: Response,
  signal: AbortSignal,
  tooLarge: () => Error,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_API_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let rejectAborted: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = (): void => {
    rejectAborted(signal.reason);
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    if (signal.aborted) onAbort();
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_API_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * How much of a foreign body to quote back: enough to carry an error page's identifying line,
 * short of turning a whole HTML document into an error message.
 */
const QUOTED_BODY_LIMIT = 180;

/** The keys intermediaries actually use to explain themselves, in the order worth reading. */
const FOREIGN_DETAIL_KEYS = ["title", "detail", "message", "error", "reason"] as const;

/**
 * Describe a response body that is not the JSON envelope every SpicyAPI route returns.
 *
 * The distinction is worth the words. Every reply from the platform - including its own
 * authentication, quota and region errors - is a `{code, msg, data, request_id}` envelope, so a
 * body without one did not come from the platform at all: a proxy, a corporate gateway or the CDN
 * edge answered in its place and the request never reached the origin. An error saying only that
 * the response was not valid JSON sends the reader looking for a broken endpoint, which is the
 * one place the fault cannot be. Quoting whatever did answer points at the layer that did.
 *
 * Being unparseable is not the interesting property, and assuming it was is how this was missed
 * the first time: Cloudflare content-negotiates its own error pages, and this client always sends
 * `Accept: application/json`, so an edge block arrives as tidy JSON with `title` and `detail` at
 * least as often as it arrives as HTML. Both are foreign; only one of them fails to parse.
 */
export function describeForeignBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "the body was empty";
  const explained = explainForeignJson(trimmed);
  if (explained !== undefined) return `the body said ${JSON.stringify(explained)}`;
  const titled = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(trimmed)?.[1]?.trim();
  if (titled) return `the body was an HTML page titled ${JSON.stringify(titled)}`;
  if (/^<(?:!doctype|html|\?xml)\b/i.test(trimmed)) return "the body was an HTML document";
  const collapsed = trimmed.replace(/\s+/g, " ");
  return collapsed.length > QUOTED_BODY_LIMIT
    ? `the body began ${JSON.stringify(`${collapsed.slice(0, QUOTED_BODY_LIMIT)}...`)}`
    : `the body was ${JSON.stringify(collapsed)}`;
}

/** Pull an intermediary's own explanation out of its JSON, or give up and let the text speak. */
function explainForeignJson(trimmed: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const said = new Set<string>();
  for (const key of FOREIGN_DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") said.add(value.trim());
  }
  if (said.size === 0) return undefined;
  const joined = [...said].join(" - ");
  return joined.length > QUOTED_BODY_LIMIT ? `${joined.slice(0, QUOTED_BODY_LIMIT)}...` : joined;
}
