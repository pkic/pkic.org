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
/** The slices of the members roll a figure may count; see MEMBERS_LIST_SORT_COLUMNS' query. */
export const portalLoginMemberCountSchema = z.enum(["all", "organization", "independent"]);

export const portalLoginFactSchema = z.object({
  /**
   * The figure itself, as written — "400+", "14" — or the placeholder shown
   * until a counted one arrives.
   */
  value: z.string().trim().min(1).max(24),
  /** What the figure counts. */
  label: z.string().trim().min(1).max(80),
  /**
   * Present when the figure is the size of the members roll rather than an
   * authored number: the screen counts that slice from the public list
   * endpoint and replaces `value` when it lands. The site used to state this
   * from the YAML files in the repository, which is how a fresh install
   * claimed 374 members and had none (#8).
   */
  /*
   * Nullable as well as optional. Hugo's `dict` writes every key it is given,
   * so a fact with no counted figure arrives as `"memberCount": null` rather
   * than absent — and an `.optional()` that rejects null failed the parse for
   * the whole block, which took all three figures off the screen at once.
   * That was the "missing stats" half of #33.
   */
  memberCount: portalLoginMemberCountSchema.nullable().optional(),
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
