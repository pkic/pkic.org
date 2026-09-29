import { json } from "../_lib/http";

const PUBLIC_CACHE_CONTROL = "public";

export async function onRequest(): Promise<Response> {
  const response = json({
    name: "PKI Consortium API",
    version: "v1",
    status: "ok",
  });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}
