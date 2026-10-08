import { databaseIdSchema } from "../../assets/shared/schemas/identifiers.ts";
import { utcInstantSchema } from "../../assets/shared/schemas/api-common.ts";
import { sessionSourceDecisionSchema } from "../../assets/shared/schemas/event-session-history.ts";

/** Reviewed decisions address exact source row locators; untouched rows keep their existing keys. */
export function resolveLegacyAgendaRow(session, context, mappings) {
  const sourceLocator = `${context.date}:${context.slotIndex}:${context.sessionIndex}`;
  const selected = mappings.sourceRows?.[sourceLocator];
  const names = (session.speakers ?? []).map((name) => name.replace(/ \*$/u, ""));
  const sourceRoles = Object.fromEntries(
    (session.speakers ?? []).map((name) => [name.replace(/ \*$/u, ""), name.endsWith(" *") ? "moderator" : "speaker"]),
  );
  const unresolved = [],
    decisions = [],
    creditDecisions = {};
  const finding = (message) =>
    unresolved.push({ kind: "source_decision", sourceLocator, sourceKey: context.originalSourceKey, message });
  const valid = selected && selected.sourceDigest === context.sourceDigest;
  if (selected && !valid) finding("Reviewed row decisions require the exact parsed source digest.");
  let sourceKey = context.originalSourceKey,
    title = context.title ?? "";
  const reviewed = (value) => utcInstantSchema.safeParse(value).success && Date.parse(value) <= Date.now();
  const evidence = (kind, authoredValue, decision, resolvedValue, reviewedAt) => ({
    kind,
    sourcePath: context.sourcePath,
    sourceDigest: context.sourceDigest,
    sourceLocator,
    authoredValue,
    decision,
    resolvedValue,
    reviewedAt,
  });
  const record = (...values) => decisions.push(evidence(...values));
  if (valid && selected.sourceKey !== undefined) {
    if (
      !reviewed(selected.reviewedAt) ||
      typeof selected.sourceKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,299}$/u.test(selected.sourceKey)
    )
      finding("Choose a nonempty stable source key of at most 300 safe characters and actual UTC review time.");
    else sourceKey = selected.sourceKey;
  }
  if (valid && selected.title) {
    const choice = selected.title;
    if (
      !reviewed(choice.reviewedAt) ||
      !["reviewed_title", "title_not_recorded"].includes(choice.decision) ||
      (choice.decision === "reviewed_title" &&
        (typeof choice.value !== "string" || !choice.value.trim() || choice.value.trim().length > 300)) ||
      (choice.decision === "title_not_recorded" && context.title != null && String(context.title).trim())
    )
      finding(
        "Title decisions require a reviewed title or an explicit title-not-recorded decision and actual UTC review time.",
      );
    else {
      title = choice.decision === "title_not_recorded" ? "Title not recorded" : choice.value.trim();
      record("title", context.title ?? null, choice.decision, title, choice.reviewedAt);
    }
  }
  if (typeof title !== "string" || !title.trim())
    finding("The authored title is blank; choose an explicit reviewed title decision.");
  const retainedNames = [];
  for (const name of names) {
    const choice = valid ? selected.credits?.[name] : null;
    if (!choice) {
      retainedNames.push(name);
      continue;
    }
    if (
      mappings.archivePublicSource !== true ||
      !reviewed(choice.reviewedAt) ||
      !["credit_not_recorded", "retain_source_credit", "reviewed_credit"].includes(choice.decision)
    ) {
      finding("Credit decisions require explicit public archive selection and actual UTC review time.");
      retainedNames.push(name);
      continue;
    }
    if (mappings.speakerUserIds?.[name] || mappings.historicalPeople?.[name]?.userId) {
      finding("A reviewed source credit decision cannot override the authored credit's canonical person mapping.");
      retainedNames.push(name);
      continue;
    }
    if (choice.decision === "reviewed_credit") {
      const ref = choice.resolvedValue;
      const person = typeof ref === "string" ? mappings.historicalPeople?.[ref] : null;
      if (
        typeof ref !== "string" ||
        !ref.trim() ||
        ref !== ref.trim() ||
        ref.length > 300 ||
        !sessionSourceDecisionSchema.safeParse(evidence("credit", name, choice.decision, ref, choice.reviewedAt))
          .success ||
        !person ||
        !databaseIdSchema.safeParse(person.userId).success ||
        !Object.hasOwn(person, "actingIdentityId") ||
        (person.actingIdentityId !== null && !databaseIdSchema.safeParse(person.actingIdentityId).success) ||
        !reviewed(person.approvedAt)
      ) {
        finding(
          "A reviewed credit requires an exact verified person reference with an explicit canonical user, acting identity (or null), and actual historical approval time.",
        );
        retainedNames.push(name);
        continue;
      }
      record("credit", name, choice.decision, ref, choice.reviewedAt);
      if (sourceRoles[ref] && sourceRoles[ref] !== sourceRoles[name] && !person.role)
        finding("Resolve conflicting authored roles explicitly for this verified person.");
      sourceRoles[ref] = sourceRoles[name];
      retainedNames.push(ref);
      continue;
    }
    record(
      "credit",
      name,
      choice.decision,
      choice.decision === "retain_source_credit" ? name : null,
      choice.reviewedAt,
    );
    creditDecisions[name] = choice;
    if (choice.decision === "retain_source_credit") retainedNames.push(name);
  }
  if (valid)
    for (const name of Object.keys(selected.credits ?? {}))
      if (!names.includes(name)) finding("The reviewed credit is absent from this authored row.");
  return {
    sourceKey,
    title,
    names: [...new Set(retainedNames)],
    sourceRoles,
    decisions,
    creditDecisions,
    unresolved,
    sourceRow: {
      sourceLocator,
      sourceKey,
      originalSourceKey: context.originalSourceKey,
      sourcePath: context.sourcePath,
      sourceDigest: context.sourceDigest,
      ...(valid && sourceKey !== context.originalSourceKey ? { keyReviewedAt: selected.reviewedAt } : {}),
      authoredTitle: context.title ?? null,
      authoredCredits: names,
      authoredSpeakerReferences: session.speakers ?? [],
    },
  };
}
