/**
 * Capture the canonical documents from the local Worker after Hugo has built
 * public/. The deployed Worker serves these assets instead of converting every
 * route schema during isolate startup.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filterOpenApiSpecForMcp } from "../functions/_lib/openapi/mcp.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.argv[2] ?? "local";
if (!new Set(["local", "preview", "production"]).has(environment)) {
  throw new Error(`Unsupported Cloudflare environment: ${environment}`);
}

const OPENAPI_PATH = "/api/v1/openapi.json";
const MCP_OPENAPI_PATH = "/api/v1/mcp/openapi.json";
const artifactPath = (path) => resolve(root, "public", path.slice(1));

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port");
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function readDocument(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (childError) throw childError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The local Worker exited before OpenAPI generation");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`OpenAPI route returned HTTP ${response.status}`);
      const document = await response.json();
      if (!document?.info?.title || Object.keys(document.paths ?? {}).length === 0) {
        throw new Error("The generated OpenAPI document is empty");
      }
      return document;
    } catch (error) {
      if (!(error instanceof TypeError) && error?.name !== "TimeoutError") throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw new Error("Timed out waiting for the local Worker to generate OpenAPI");
}

const temporaryState = await mkdtemp(join(process.env.PKIC_BUILD_TMPDIR ?? tmpdir(), "pkic-openapi-"));
const port = await availablePort();
// A repeated local build must not read its previous document back through the
// assets binding. Hugo has already produced public/ before this script runs.
await Promise.all([OPENAPI_PATH, MCP_OPENAPI_PATH].map((path) => rm(artifactPath(path), { force: true })));
const child = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--env",
    environment,
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    temporaryState,
    "--show-interactive-dev-session=false",
  ],
  { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "ignore" },
);
let childError;
child.once("error", (error) => {
  childError = error;
});

try {
  const openapi = await readDocument(`http://127.0.0.1:${port}${OPENAPI_PATH}`, child);
  const mcpOpenapi = filterOpenApiSpecForMcp(openapi);
  if (Object.keys(mcpOpenapi.paths ?? {}).length === 0) {
    throw new Error("The generated MCP OpenAPI document is empty");
  }
  for (const [path, document] of [
    [OPENAPI_PATH, openapi],
    [MCP_OPENAPI_PATH, mcpOpenapi],
  ]) {
    const body = JSON.stringify(document) + "\n";
    const destination = artifactPath(path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);
    console.log(`Generated ${path} (${Buffer.byteLength(body)} bytes)`);
  }
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exit = new Promise((resolvePromise) => child.once("exit", resolvePromise));
    child.kill("SIGTERM");
    await Promise.race([exit, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(temporaryState, { recursive: true, force: true });
}
