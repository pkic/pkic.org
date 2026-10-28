import { z } from "zod";

/** Shared presentation variants used by PKIC action and destination controls. */
export const buttonVariantSchema = z.enum(["primary", "secondary", "ghost", "danger", "danger-quiet", "link"]);
export type ButtonVariant = z.infer<typeof buttonVariantSchema>;
