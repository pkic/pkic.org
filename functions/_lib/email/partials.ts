import type { DatabaseLike } from "../types";
import { resolveTemplate } from "./templates";

export const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
export const EMAIL_PARTIAL_NAMES = ["reg_details", "sponsors_block", "about_pkic", "donation_request"] as const;

export async function loadEmailPartials(db: DatabaseLike): Promise<Record<string, string>> {
  const entries = await Promise.all(
    EMAIL_PARTIAL_NAMES.map(async (name) => {
      const tmpl = await resolveTemplate(db, `partial_${name}`);
      return [name, tmpl.content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function loadEmailLayout(db: DatabaseLike): Promise<string> {
  const tmpl = await resolveTemplate(db, EMAIL_LAYOUT_TEMPLATE_KEY);
  return tmpl.content;
}
