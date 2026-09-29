#!/usr/bin/env node
/**
 * Standalone SendGrid intercept server for E2E tests.
 *
 * Starts a lightweight HTTP server that mimics the SendGrid
 * v3 mail/send endpoint.  Playwright tests read captured emails via the
 * /outbox and /clear routes.
 *
 * Usage: node scripts/e2e-interceptor.mjs [port] [url-file]
 * Default port: 0, which asks the OS to assign a free port.
 */

import { writeFileSync } from "node:fs";
import { createCaptureServer } from "./email-capture/server.mjs";
const PORT = Number(process.argv[2] ?? 0);
const URL_FILE = process.argv[3];
const server = createCaptureServer();

server.listen(PORT, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const url = `http://127.0.0.1:${port}`;
  if (URL_FILE) {
    writeFileSync(URL_FILE, url);
  }
  console.log(`[e2e-interceptor] SendGrid intercept listening on ${url}`);
});

server.on("error", (err) => {
  console.error(`[e2e-interceptor] Failed to start on port ${PORT}:`, err.message);
  process.exit(1);
});
