import { createServer } from "node:http";
import { readFileSync } from "node:fs";

export function createCaptureServer() {
  /** @type {Array<{to: string; subject: string; payload: unknown; capturedAt: string}>} */
  const outbox = [];

  return createServer((req, res) => {
    const url = req.url ?? "";
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) {
      res.writeHead(403);
      res.end("Local inbox only");
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      res.writeHead(403);
      res.end("Same-origin requests only");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && ["/", "/inbox.js", "/inbox.css"].includes(url)) {
      const file = url === "/" ? "inbox.html" : url.slice(1);
      res.setHeader(
        "Content-Type",
        url.endsWith(".js") ? "text/javascript" : url.endsWith(".css") ? "text/css" : "text/html",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.end(readFileSync(new URL(file, import.meta.url)));
      return;
    }
    // The worker reaches this server through pooled connections. Node's
    // default 5s keepAliveTimeout closes idle pooled sockets from this end,
    // and a send racing that close fails with a reset instead of a clean
    // response. Refusing reuse removes that race: every send opens a fresh
    // connection, which at e2e volume costs nothing.
    res.setHeader("Connection", "close");

    // Wrangler worker POSTs email payloads here instead of SendGrid
    if (req.method === "POST" && url === "/") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const personalizations = payload.personalizations;
          const to = personalizations?.[0]?.to?.[0]?.email ?? "unknown";
          const subject = payload.subject ?? "";
          outbox.push({ to, subject, payload, capturedAt: new Date().toISOString() });
          console.log(`[email-capture] Message ${outbox.length} captured; view the local inbox.`);
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
}
