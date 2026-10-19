import { expect, type Page, type Route } from "@playwright/test";
import { speakerParticipationPatchSchema } from "../../../assets/shared/schemas/proposal-management";
import { speakerParticipationResponseSchema } from "../../../assets/shared/schemas/speaker-self-service";

/** Read the actual backend receipt before the speaker controller receives it and reloads. */
export async function confirmSpeakerWithReceipt(page: Page, accessPath: string): Promise<void> {
  const endpoint = new URL(`${accessPath}/participation`, page.url()).href;
  const matches = (url: URL) => url.href === endpoint;
  let captured: { status: number; input: unknown; body: unknown } | undefined;
  let failure: unknown;
  const capture = async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch (error) {
      failure = error;
      await route.abort();
      return;
    }
    try {
      captured = {
        status: response.status(),
        input: route.request().postDataJSON(),
        body: await response.json(),
      };
    } catch (error) {
      failure = error;
    }
    await route.fulfill({ response });
  };
  await page.route(matches, capture);
  try {
    await page.getByRole("button", { name: "Confirm participation", exact: true }).click();
    await expect.poll(() => Boolean(captured || failure), { timeout: 30_000 }).toBe(true);
    if (failure) throw new Error("Could not capture the real speaker confirmation receipt", { cause: failure });
    if (!captured) throw new Error("Speaker confirmation did not yield its real backend receipt");
    expect(captured.status).toBe(200);
    expect(speakerParticipationPatchSchema.parse(captured.input).status).toBe("confirmed");
    expect(speakerParticipationResponseSchema.parse(captured.body).status).toBe("confirmed");
  } finally {
    await page.unroute(matches, capture);
  }
}
