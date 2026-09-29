import { json } from "../_lib/http";

export async function onRequest(): Promise<Response> {
  return json({
    name: "PKI Consortium API",
    version: "v1",
    status: "ok",
  });
}
