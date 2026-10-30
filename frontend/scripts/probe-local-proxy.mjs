import fs from "node:fs";
import assert from "node:assert/strict";
const origin = "http://localhost:3000";
const health = await fetch(origin + "/api/health").then((r) => r.json());
assert.equal(health.environment, "development");
const paths = [
  "/api/products",
  "/api/categories",
  "/api/households",
  "/api/health",
];
const samples = [];
async function sample(route) {
  const started = performance.now();
  const response = await fetch(origin + route);
  const body = await response.text();
  let valid = false;
  try {
    JSON.parse(body);
    valid = true;
  } catch {}
  samples.push({
    path: route,
    status: response.status,
    json: valid,
    ms: Math.round(performance.now() - started),
  });
}
for (let batch = 0; batch < 6; batch++) {
  if (batch) await new Promise((resolve) => setTimeout(resolve, 5050));
  await Promise.all(paths.map(sample));
}
for (let batch = 0; batch < 10; batch++)
  await Promise.all(Array.from({ length: 5 }, () => sample("/api/products")));
const failures = samples.filter((s) => s.status !== 200 || !s.json);
const report = {
  status: failures.length ? "failed" : "passed",
  node: process.version,
  requests: samples.length,
  successful: samples.length - failures.length,
  idle_gap_ms: 5050,
  idle_batches: 6,
  burst_concurrency: 5,
  failures,
  scope:
    "Local read-only proxy stability check; not a production load guarantee",
};
fs.writeFileSync(
  "../reports/proxy-stability.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
assert.equal(failures.length, 0);
