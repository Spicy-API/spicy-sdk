import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";

const baseURL = "https://api.spicyapi.ai/v1";

void test("the official client receives chunked text, optional reasoning and final usage over the compatibility path", async () => {
  let requests = 0;
  const client = new OpenAI({
    apiKey: "test-only",
    baseURL,
    maxRetries: 0,
    fetch: (url, init) => {
      requests += 1;
      assert.equal(
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        `${baseURL}/chat/completions`,
      );
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "intent-1");
      assert.equal(typeof init?.body, "string");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      assert.equal(body["model"], "example/1/chat");
      assert.deepEqual(body["stream_options"], { include_usage: true });
      const data =
        [
          { choices: [{ index: 0, delta: { reasoning_content: "optional" } }] },
          { choices: [{ index: 0, delta: { content: "Hello, world" } }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 5,
              total_tokens: 8,
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n";
      const bytes = new TextEncoder().encode(data);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    },
  });
  const stream = await client.chat.completions.create(
    {
      model: "example/1/chat",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      stream_options: { include_usage: true },
    },
    { headers: { "Idempotency-Key": "intent-1" }, signal: AbortSignal.timeout(1000) },
  );
  let text = "";
  let reasoning = "";
  let total = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as
      { content?: string; reasoning_content?: string } | undefined;
    text += delta?.content ?? "";
    reasoning += delta?.reasoning_content ?? "";
    if (chunk.usage) total = chunk.usage.total_tokens;
  }
  assert.equal(text, "Hello, world");
  assert.equal(reasoning, "optional");
  assert.equal(total, 8);
  assert.equal(requests, 1);
});

void test("compatibility calls through the official client do not auto-retry a request whose cost is uncertain", async () => {
  let requests = 0;
  const client = new OpenAI({
    apiKey: "test-only",
    baseURL,
    maxRetries: 0,
    fetch: () => {
      requests += 1;
      return Promise.resolve(
        Response.json(
          { error: { message: "Temporarily unavailable", type: "server_error" } },
          { status: 503 },
        ),
      );
    },
  });
  await assert.rejects(
    client.chat.completions.create({
      model: "example/1/chat",
      messages: [{ role: "user", content: "Hello" }],
    }),
  );
  assert.equal(requests, 1);
});
