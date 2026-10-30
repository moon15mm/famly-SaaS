import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api } from "../lib/api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("read retries one transient plain-text proxy error", async () => {
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1
      ? new Response("Internal Server Error", { status: 500 })
      : Response.json({ ok: true });
  assert.deepEqual(await api("/health"), { ok: true });
  assert.equal(calls, 2);
});
test("read retries one disconnected socket", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("socket reset diagnostic");
    return Response.json([1, 2]);
  };
  assert.deepEqual(await api("/products"), [1, 2]);
  assert.equal(calls, 2);
});
test("write never retries a proxy failure and gives a readable error", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Internal Server Error", { status: 500 });
  };
  await assert.rejects(api("/orders", { method: "POST", body: "{}" }), /تعذر/);
  assert.equal(calls, 1);
});
test("write never retries a network failure or exposes transport diagnostics", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("private transport diagnostic");
  };
  await assert.rejects(
    api("/payments/test/id", { method: "POST" }),
    (error) =>
      error.message.includes("تعذر") && !error.message.includes("private"),
  );
  assert.equal(calls, 1);
});
test("validation errors retain the server's useful message without retry", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ detail: "الكمية غير متاحة" }, { status: 422 });
  };
  await assert.rejects(api("/orders", { method: "POST" }), /الكمية غير متاحة/);
  assert.equal(calls, 1);
});
test("successful non-JSON response reports a readable protocol error", async () => {
  globalThis.fetch = async () =>
    new Response("<html>unexpected</html>", { status: 200 });
  await assert.rejects(api("/products"), /استجابة|الخادم/);
});
test("empty successful response does not cause a JSON parser error", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await api("/resource", { method: "DELETE" }), undefined);
});
