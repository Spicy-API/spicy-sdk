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
