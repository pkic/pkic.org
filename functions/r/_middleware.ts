import { handleNoStoreRoute } from "../_lib/middleware/no-store";

export async function onRequest(c: any, next?: () => Promise<void>): Promise<Response> {
  return handleNoStoreRoute(c, next);
}
