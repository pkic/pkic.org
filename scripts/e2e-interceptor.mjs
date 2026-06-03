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

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const PORT = Number(process.argv[2] ?? 0);
const URL_FILE = process.argv[3];

/** @type {Array<{to: string; subject: string; payload: unknown; capturedAt: string}>} */
const outbox = [];

const server = createServer((req, res) => {
  const url = req.url ?? "";

  // Wrangler worker POSTs email payloads here instead of SendGrid
  if (req.method === "POST" && url === "/") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const personalizations = payload.personalizations;
        const to = personalizations?.[0]?.to?.[0]?.email ?? "unknown";
        const subject = payload.subject ?? "";
        outbox.push({ to, subject, payload, capturedAt: new Date().toISOString() });
        res.writeHead(202, {
          "content-type": "application/json",
          "x-message-id": `e2e-test-${Date.now()}`,
        });
        res.end(JSON.stringify({ accepted: true }));
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
    return;
  }

  // Tests poll captured emails
  if (req.method === "GET" && url === "/outbox") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(outbox));
    return;
  }

  // Clear outbox between test scenarios
  if (req.method === "POST" && url === "/clear") {
    outbox.splice(0);
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

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
