import type { DatabaseLike } from "../types";
import { EMAIL_PARTIALS } from "./render";
import { resolveTemplate } from "./templates";

export const EMAIL_PARTIAL_NAMES = ["reg_details", "sponsors_block", "about_pkic"] as const;

export async function loadEmailPartials(db: DatabaseLike): Promise<Record<string, string>> {
  const partials: Record<string, string> = { ...EMAIL_PARTIALS };
  await Promise.all(
    EMAIL_PARTIAL_NAMES.map(async (name) => {
      try {
        const tmpl = await resolveTemplate(db, `partial_${name}`);
        partials[name] = tmpl.content;
      } catch {
        // Not seeded in DB yet; keep hardcoded fallback from EMAIL_PARTIALS.
      }
    }),
  );
  return partials;
}
