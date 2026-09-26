import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/** Local synthetic checkout provider: stable retries, captured metadata, and no real payments. */
export function createPaymentCaptureServer() {
  const sessions = new Map();
  return createServer((request, response) => {
    if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(request.headers.host ?? "") || request.headers.origin) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/sessions") {
      response.end(JSON.stringify([...sessions.values()]));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/checkout/sessions" || request.headers.authorization !== "Bearer sk_test_e2e_membership") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_768) request.destroy();
    });
    request.on("end", () => {
      const key = String(request.headers["idempotency-key"] ?? "");
      if (!key) { response.writeHead(400).end(); return; }
      let session = sessions.get(key);
      if (!session) {
        const params = new URLSearchParams(body);
        const id = `cs_test_${randomUUID()}`;
        const metadata = Object.fromEntries([...params].filter(([name]) => /^metadata\[.*\]$/.test(name)).map(([name, value]) => [name.slice(9, -1), value]));
        session = { id, url: `https://checkout.stripe.com/c/pay/${id}`, metadata,
          amount_total: Number(params.get("line_items[0][price_data][unit_amount]")),
          currency: params.get("line_items[0][price_data][currency]"), customer_email: params.get("customer_email"),
          success_url: params.get("success_url"), payment_status: "unpaid", payment_intent: `pi_test_${randomUUID()}` };
        sessions.set(key, session);
      }
      response.end(JSON.stringify(session));
    });
  });
}
