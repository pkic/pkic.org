import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { sitePublicationReleaseSchema } from "../assets/shared/schemas/site-publication-release.ts";

// Test releases are immutable while served, just as Worker deployments are.
// Switch the local server only after the real publication build has finished.
const [stateDirectory, environmentFile, port] = process.argv.slice(2);
if (!stateDirectory || !environmentFile || !port)
  throw new Error("Expected state directory, environment file, and port");
const state = resolve(stateDirectory);
const token = randomUUID();
let worker;
let switching = false;
let closing = false;

function start(directory) {
  worker = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config=dist/pkic_org_base/wrangler.json",
      `--assets=${directory}`,
      `--port=${port}`,
      `--persist-to=${state}`,
      `--env-file=${environmentFile}`,
      `--log-level=${process.env.E2E_WRANGLER_LOG_LEVEL ?? (process.env.CI ? "warn" : "info")}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"], detached: true },
  );
  worker.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  worker.on("exit", (code) => {
    if (!switching && !closing) process.exit(code ?? 1);
  });
}

async function stop() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = once(worker, "exit");
  // The CLI starts workerd children; terminate the entire local process group.
  process.kill(-worker.pid, "SIGTERM");
  await exited;
}

const control = createServer(async (request, response) => {
  if (
    request.method !== "POST" ||
    request.url !== "/publication" ||
    request.headers.authorization !== `Bearer ${token}`
  ) {
    response.writeHead(403).end();
    return;
  }
  if (switching || closing) {
    response.writeHead(409).end();
    return;
  }
  switching = true;
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 4096) throw new Error("Publication request is too large");
      chunks.push(chunk);
    }
    const { directory } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof directory !== "string") throw new Error("Publication directory is required");
    const selected = resolve(directory);
    if (dirname(selected) !== state || !selected.startsWith(resolve(state, "site-release-")))
      throw new Error("Publication must belong to this test run");
    const release = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(selected, "publication.json"), "utf8")),
    );
    if (release.environment !== "local") throw new Error("Only local test releases may be activated");
    await stop();
    start(selected);
    response
      .writeHead(202, { "content-type": "application/json" })
      .end(JSON.stringify({ snapshotId: release.snapshotId }));
  } catch (error) {
    console.error(error);
    response.writeHead(500).end();
  } finally {
    switching = false;
  }
});

control.listen(0, "127.0.0.1");
await once(control, "listening");
await writeFile(
  resolve(state, ".publication-control.json"),
  JSON.stringify({
    url: `http://127.0.0.1:${control.address().port}/publication`,
    token,
  }),
);
start(resolve(state, "site"));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    control.close();
    await stop();
    process.exit(0);
  });
}
