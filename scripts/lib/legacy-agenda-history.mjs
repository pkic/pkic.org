/** Historical credits use explicit canonical mappings; employer text is never inferred from a title. */
export function legacyAgendaPeople(source, names, mappings, context) {
  const current = mappings.mode === "current";
  const people = [],
    appearances = [],
    archivalCredits = [],
    candidates = [],
    unresolved = [];
  for (const name of names) {
    const authoredMatches = (source.speakers ?? []).filter((speaker) => speaker.name === name);
    const authored = authoredMatches.length === 1 ? authoredMatches[0] : null;
    const selected = current ? mappings.people?.[name] : mappings.historicalPeople?.[name];
    const userId = selected?.userId ?? (current ? null : mappings.speakerUserIds?.[name]) ?? null;
    const actingIdentityId = selected?.actingIdentityId ?? null;
    people.push({
      ref: name,
      label: name,
      canonicalUserId: userId,
      actingIdentityId,
      role: selected?.role ?? mappings.sourceRoles?.[name] ?? "speaker",
    });
    // Current imports reference live identities; the authored profile grants no appearance approval.
    if (current) {
      if (!userId) unresolved.push({ ...context, kind: "speaker", value: name });
      continue;
    }
    const reviewedSourceCredit = mappings.sourceCreditDecisions?.[name]?.decision === "retain_source_credit";
    const preserveSource =
      !userId &&
      mappings.archivePublicSource === true &&
      (authoredMatches.length === 1 || (reviewedSourceCredit && authoredMatches.length === 0));
    if (!userId && !preserveSource) unresolved.push({ ...context, kind: "speaker", value: name });
    if (preserveSource)
      archivalCredits.push({
        sourceRef: name,
        role: selected?.role ?? mappings.sourceRoles?.[name] ?? "speaker",
        sourcePath: mappings.sourcePath,
        sourceDigest: mappings.sourceDigest,
        provenance: "authored_public",
        displayName: authored?.name ?? name,
        jobTitle: authored?.title ?? null,
        organizationName: null,
        biography: authored?.bio ?? "",
        photoUrl: selected?.photoUrl ?? mappings.photoUrls?.[name] ?? null,
      });
    if (authoredMatches.length > 1)
      unresolved.push({
        ...context,
        kind: "historical_person",
        value: name,
        message: "Resolve duplicate authored speaker records explicitly.",
      });
    if (!authored && !selected) continue;
    const appearance = {
      userId,
      displayName: selected?.displayName ?? authored?.name ?? name,
      affiliations: historicalAffiliations(selected, actingIdentityId, authored),
      biography: selected?.biography ?? authored?.bio ?? "",
      photoUrl: selected?.photoUrl ?? mappings.photoUrls?.[name] ?? null,
      approvedAt: selected?.approvedAt ?? null,
    };
    candidates.push({ ...context, ref: name, authored: authored ?? null, appearance });
    if (preserveSource) continue;
    if (!selected || !Object.hasOwn(selected, "actingIdentityId") || !selected.approvedAt || !userId) {
      unresolved.push({
        ...context,
        kind: "historical_representation",
        value: name,
        message: "Explicitly map the canonical person, acting identity (or null) and historical-credit approval time.",
      });
      continue;
    }
    appearances.push(appearance);
  }
  return { people, appearances, archivalCredits, candidates, unresolved };
}

/**
 * The approved historical capacities, primary first: an explicit `affiliations` list, or the single
 * acting identity with its title and organization. A title alone never implies an employer.
 */
function historicalAffiliations(selected, actingIdentityId, authored) {
  if (Array.isArray(selected?.affiliations)) return selected.affiliations;
  const title = selected?.jobTitle ?? authored?.title ?? null;
  const organizationName = selected?.organizationName ?? null;
  if (!actingIdentityId && !title && !organizationName) return [];
  return [
    {
      identityId: actingIdentityId,
      title,
      organizationId: selected?.organizationId ?? null,
      organizationName,
    },
  ];
}
