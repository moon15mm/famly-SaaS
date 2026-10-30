import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
const source = fs.readFileSync(new URL("../android/app/src/main/assets/native-bridge.js", import.meta.url), "utf8");

function harness(connect = true) {
  const listeners = new Map(), messages = [], objectUrls = new Map();
  class Element { closest() { return this; } }
  class Anchor extends Element {
    constructor() { super(); this.href = ""; this.download = ""; this.fallback = false; }
    hasAttribute(name) { return name === "download" && Boolean(this.download); }
    click() { this.fallback = true; }
  }
  class LocalURL extends URL {
    static createObjectURL(blob) { const key = "blob:http://localhost:3000/" + objectUrls.size; objectUrls.set(key, blob); return key; }
    static revokeObjectURL(key) { objectUrls.delete(key); }
  }
  const context = {
    Element, HTMLAnchorElement: Anchor, URL: LocalURL, Blob, Uint8Array, Map,
    location: new URL("http://localhost:3000/account"), crypto: webcrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    addEventListener: (name, callback) => listeners.set(name, callback),
    document: { addEventListener: () => {} },
    fetch: async () => { throw new Error("Revoked URLs must use retained Blob"); },
  };
  context.window = context; context.top = context;
  vm.createContext(context); vm.runInContext(source, context);
  const port = { postMessage: (value) => messages.push(JSON.parse(value)), close() {} };
  if (connect) listeners.get("message")({ source: null, data: "min-buyutna-native", ports: [port] });
  return { context, listeners, messages, Anchor, port, objectUrls };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("retains complete Arabic export when page immediately revokes blob URL", async () => {
  const h = harness();
  const content = "\ufeffاليوم,الطلبات\n2026-10-30,7";
  const a = new h.Anchor();
  a.href = h.context.URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  a.download = "sales-report.csv";
  a.click(); h.context.URL.revokeObjectURL(a.href);
  await settle();
  assert.equal(a.fallback, false);
  assert.equal(h.objectUrls.size, 0);
  assert.equal(h.messages[0].name, "sales-report.csv");
  assert.equal(h.messages.at(-1).type, "finish");
  const bytes = Buffer.concat(h.messages.filter(m => m.type === "chunk").map(m => Buffer.from(m.data, "base64")));
  assert.equal(bytes.toString("utf8"), content);
  assert.equal(bytes.length, h.messages[0].size);
});
test("splits binary files into bounded transport messages without byte loss", async () => {
  const h = harness(); const bytes = webcrypto.getRandomValues(new Uint8Array(60000));
  const a = new h.Anchor(); a.href = h.context.URL.createObjectURL(new Blob([bytes], { type: "image/webp" })); a.download = "document.webp";
  a.click(); await settle();
  const chunks = h.messages.filter(m => m.type === "chunk");
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(m => m.data.length < 50000));
  assert.deepEqual(Buffer.concat(chunks.map(m => Buffer.from(m.data, "base64"))), Buffer.from(bytes));
});
test("rejects channel substitution from another frame", () => {
  const h = harness(false);
  h.listeners.get("message")({ source: {}, data: "min-buyutna-native", ports: [h.port] });
  h.context.print(); assert.equal(h.messages.length, 0);
  assert.equal(h.context.__minBuyutnaNativeReady, undefined);
});
test("routes print to native platform and preserves ordinary navigation", () => {
  const h = harness(); h.context.print();
  assert.deepEqual(h.messages, [{ type: "print" }]);
  const a = new h.Anchor(); a.href = "http://localhost:3000/orders"; a.click();
  assert.equal(a.fallback, true);
});
test("rejects oversized export before transporting bytes", async () => {
  const h = harness(); const a = new h.Anchor();
  a.href = h.context.URL.createObjectURL(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/json" })); a.download = "large.json";
  a.click(); await settle(); assert.deepEqual(h.messages, [{ type: "error" }]);
});
