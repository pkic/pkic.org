import { z } from "zod";
import { parse } from "yaml";
import source from "../data/model-contributions.yaml?raw";
import { modelContributionSchema } from "../assets/shared/model-contribution";

const entries = z
  .object({
    models: z.array(modelContributionSchema.extend({ root: z.string(), sections: z.array(z.string()) })),
  })
  .parse(parse(source)).models;

export function modelContributionForRoute(route: string) {
  return entries.find(
    (entry) => route === entry.root || entry.sections.some((section) => route.startsWith(`${entry.root}${section}`)),
  );
}
