import { useRef, useEffect } from "preact/hooks";
import type { RegistrationConfirmOrganization as Organization } from "../../shared/schemas/registration";
import {
  registrationEmailProofVerifyResponseSchema,
  registrationEmailProofVerifySchema,
} from "../../shared/schemas/registration-email-proof";
import type { identityAffiliationPreviewResponseSchema } from "../../shared/schemas/identity-affiliation";
import type { z } from "zod";
import { postJson } from "../shared/api-client";
import {
  VerifiedOrganizationDetails,
  type VerifiedOrganizationController,
} from "./identities/VerifiedOrganizationDetails";

export interface ConfirmOrganizationController {
  read?: () => { organization: Organization } | { refused: true };
  validate?: () => boolean;
  prepare?: () => Promise<boolean>;
}
/** Registration embeds the same verified organization flow; only its mailbox-proof adapter differs. */
export function RegistrationConfirmOrganization({
  controller,
  email,
  proof,
}: {
  controller: ConfirmOrganizationController;
  email: string;
  proof?: { token: string; endpoint: string; affiliation: z.infer<typeof identityAffiliationPreviewResponseSchema> };
}) {
  const details = useRef<VerifiedOrganizationController>({});
  useEffect(
    () => () => {
      delete controller.read;
      delete controller.validate;
      delete controller.prepare;
    },
    [controller],
  );
  const initial = proof?.affiliation ?? { email, domain: "", domains: [], organization: null, organizations: [] };
  controller.validate = () => details.current.validate?.() ?? false;
  controller.read = () => {
    const selected = details.current.read?.();
    if (!selected || "refused" in selected) return { refused: true };
    return {
      organization: {
        name: selected.organizationName,
        jobTitle: selected.input.jobTitle,
        ...(proof
          ? {
              organizationId: selected.input.organizationId,
              domain: selected.input.domain,
              contextToken: selected.contextToken,
            }
          : {}),
      },
    };
  };
  if (proof) controller.prepare = () => details.current.prepare?.() ?? Promise.resolve(false);
  else delete controller.prepare;
  return (
    <VerifiedOrganizationDetails
      initial={initial}
      emailId={null}
      controller={details.current}
      resolve={async (domain) => {
        if (!proof) return initial;
        const result = await postJson(
          proof.endpoint,
          registrationEmailProofVerifySchema.parse({ token: proof.token, domain }),
          registrationEmailProofVerifyResponseSchema,
        );
        if (!result.affiliation) throw new Error("Confirm your organization details again.");
        return result.affiliation;
      }}
      prepare={async (input) => {
        if (!proof) return initial;
        const { email: _email, emailId: _id, phase: _phase, ...selection } = input;
        const result = await postJson(
          proof.endpoint,
          registrationEmailProofVerifySchema.parse({ token: proof.token, affiliation: selection }),
          registrationEmailProofVerifyResponseSchema,
        );
        if (!result.affiliation) throw new Error("Confirm your organization details again.");
        return result.affiliation;
      }}
    />
  );
}
