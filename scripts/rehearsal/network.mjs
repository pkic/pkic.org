import { isIP } from "node:net";

/** Connect to wildcard listeners through loopback; specific interfaces stay specific. */
export function rehearsalOrigin(host = "127.0.0.1", port) {
  if (!isIP(host)) throw new Error("--host must be a valid IP address");
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return `http://${isIP(address) === 6 ? `[${address}]` : address}:${port}`;
}

/** Keep the inbox's HTTP listener independent of an overridden public application origin. */
export function rehearsalInboxOrigin({ host = "127.0.0.1", inboxPort }) {
  return rehearsalOrigin(host, inboxPort);
}

/** Preserve localhost for the default loopback mode and use the chosen IP for remote links. */
export function rehearsalApplicationOrigin({ host = "127.0.0.1", port }) {
  const origin = rehearsalOrigin(host, port);
  return host === "127.0.0.1" ? `http://localhost:${port}` : origin;
}
