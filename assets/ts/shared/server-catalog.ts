import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";

/** Runtime-validated metadata for any bounded, server-backed selector. */
export interface ServerCatalog<Item, Response> {
  endpoint: string;
  responseSchema: z.ZodType<Response>;
  resolveItems: (response: Response) => Item[];
  resolvePage: (response: Response) => PageInfo;
  itemKey: (item: Item) => string;
  itemLabel: (item: Item) => string;
  params?: Record<string, string>;
  sort: string;
}
