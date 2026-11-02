import { expect } from "vitest";
import { registrationConfirmInfoResponseSchema } from "../../assets/shared/schemas/registration";
import { registrationEmailProofVerifyResponseSchema } from "../../assets/shared/schemas/registration-email-proof";
import type { Env } from "../../functions/_lib/types";
import { callApi } from "./app";

/** Confirm a work-address registration through the same organization selection used by attendees. */
export async function confirmWorkRegistration(environment: Env, token: string): Promise<Response> {
  const base = "/api/v1/events/pqc-2026/registrations";
  const infoResponse = await callApi(environment, `${base}/confirm-info?token=${encodeURIComponent(token)}`);
  expect(infoResponse.status, await infoResponse.clone().text()).toBe(200);
  const info = registrationConfirmInfoResponseSchema.parse(await infoResponse.json());
  expect(info.organizationProof).toBeTruthy();

  async function verify(affiliation?: object) {
    const response = await callApi(environment, `${base}/proof/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: info.organizationProof, affiliation }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return registrationEmailProofVerifyResponseSchema.parse(await response.json()).affiliation!;
  }

  const offered = await verify();
  const organizationId = offered.organization?.id ?? null;
  const name = offered.organization?.name ?? `Organization for ${offered.domain}`;
  const jobTitle = "Engineer";
  const chosen = await verify({ organizationId, ...(organizationId ? {} : { organizationName: name }), jobTitle });
  return callApi(environment, `${base}/confirm-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      organization: { name, organizationId, jobTitle, contextToken: chosen.contextToken },
    }),
  });
}
