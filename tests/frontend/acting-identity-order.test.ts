import { describe, expect, it } from "vitest";
import { orderedForChoice } from "../../assets/ts/shared/acting-identity-catalog";
import { pieces, seededRandom } from "../helpers/fuzz";

type Choice = { id: string; organizationId: string | null; membershipCategory: string | null };
const personal = (id: string, membershipCategory: string | null = null): Choice => ({
  id,
  organizationId: null,
  membershipCategory,
});
const organization = (id: string, membershipCategory: string | null = null): Choice => ({
  id,
  organizationId: `org-${id}`,
  membershipCategory,
});

describe("the order identities are offered in", () => {
  it("puts a member organization first, other organizations next, and the personal identity last", () => {
    const offered = orderedForChoice([personal("p", "H6"), organization("plain"), organization("member", "A")]);
    expect(offered.map((choice) => choice.id)).toEqual(["member", "plain", "p"]);
  });

  it("keeps the given order among equals", () => {
    const offered = orderedForChoice([organization("b"), organization("a"), organization("c")]);
    expect(offered.map((choice) => choice.id)).toEqual(["b", "a", "c"]);
  });

  it("never loses or repeats an identity, and always ranks the personal identity last, for any mix", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seededRandom(seed);
      const kinds = pieces(random, ["p", "o", "m"], 0, 30, ",").split(",").filter(Boolean);
      const choices = kinds.map((kind, index) =>
        kind === "p" ? personal(`p${index}`) : organization(`o${index}`, kind === "m" ? "A" : null),
      );
      const offered = orderedForChoice(choices);
      expect(offered.map((choice) => choice.id).sort()).toEqual(choices.map((choice) => choice.id).sort());
      const firstPersonal = offered.findIndex((choice) => !choice.organizationId);
      if (firstPersonal >= 0) expect(offered.slice(firstPersonal).every((choice) => !choice.organizationId)).toBe(true);
    }
  });
});
