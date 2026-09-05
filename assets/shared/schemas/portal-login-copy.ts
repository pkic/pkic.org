import { z } from "zod";

/**
 * The copy on the signed-out portal screen's brand panel.
 *
 * It is page content, not application state, so Hugo owns it: the portal page's
 * front matter carries the words and the figures, the layout serializes them
 * beside the mount, and the screen reads them here. Editing the pitch, or the
 * count of member organizations, is then a content change rather than a
 * frontend deployment.
 */
export const portalLoginFactSchema = z.object({
  /** The figure itself, as written — "400+", "14". */
  value: z.string().trim().min(1).max(24),
  /** What the figure counts. */
  label: z.string().trim().min(1).max(80),
});

export const portalLoginCopySchema = z.object({
  kicker: z.string().trim().min(1).max(48).optional(),
  headline: z.string().trim().min(1).max(200).optional(),
  blurb: z.string().trim().min(1).max(400).optional(),
  facts: z.array(portalLoginFactSchema).max(4).optional(),
});

export type PortalLoginCopy = z.infer<typeof portalLoginCopySchema>;
export type PortalLoginFact = z.infer<typeof portalLoginFactSchema>;

/** Where the portal layout writes the serialized copy. */
export const PORTAL_LOGIN_COPY_ID = "portal-login-copy";
