import { resolve } from "node:path";
import { prepareStaticPublicationFixture } from "./prepare-static-publication.mjs";

/**
 * Run only for selected publication tests, before the Worker startup deadline.
 * @param {Pick<import("vitest/node").TestProject, "provide">} project
 */
export default async function setup({ provide }) {
  const fixture = await prepareStaticPublicationFixture(resolve(import.meta.dirname, "../.."));
  provide("staticPublicationDirectory", fixture.publicDirectory);
}
