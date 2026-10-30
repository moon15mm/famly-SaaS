import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js")))
  throw new Error("Run npm run build first.");
cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
cpSync(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);
const child = spawn(
  process.execPath,
  [
    "--require",
    path.join(root, "scripts", "local-http-agent.cjs"),
    path.join(standalone, "server.js"),
  ],
  {
    cwd: standalone,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      HOSTNAME: process.env.APP_LISTEN_HOST || "127.0.0.1",
      PORT: process.env.PORT || "3000",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
