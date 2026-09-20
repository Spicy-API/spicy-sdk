import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBase64Media } from "../src/sdk/base64.js";

void test("accepts both a typed data URI and bare Base64 with an explicit type", () => {
  for (const value of ["AQIDBA==", "AQIDBA"]) {
    assert.deepEqual([...decodeBase64Media(value, "image/png").data], [1, 2, 3, 4]);
  }
  const media = decodeBase64Media("data:image/png;base64,AQIDBA==");
  assert.equal(media.contentType, "image/png");
  assert.deepEqual([...media.data], [1, 2, 3, 4]);
});

void test("rejects an ambiguous type, corrupt encoding and oversized content, without relying on Buffer's lenient decoding", () => {
  assert.throws(() => decodeBase64Media("AQIDBA=="), /contentType/);
  assert.throws(() => decodeBase64Media("data:text/html;base64,AQIDBA=="), /contentType/);
  assert.throws(
    () => decodeBase64Media("data:image/png;base64,AQIDBA==", "image/jpeg"),
    /does not match/,
  );
  for (const value of [
    "",
    "A",
    "AQ=Z",
    "AQ===",
    "A!ID",
    "AR==",
    "AQJ=",
    "data:image/png,AQIDBA==",
  ]) {
    assert.throws(() => decodeBase64Media(value, "image/png"), TypeError, value);
  }
  assert.throws(
    () => decodeBase64Media("A".repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 + 1), "image/png"),
    /size limit/,
  );
});
