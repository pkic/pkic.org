/**
 * Renders the structured migration report (built by the orchestrator while
 * walking YAML records) into the human-readable Markdown summary. No SQL,
 * no reconciliation logic — just formatting already-decided data.
 */

/** Full detail (not just a name) for a representative dropped from the
 * import — used in the report so staff completing them via the Interim
 * Admin Tool don't have to re-derive LinkedIn/role/bio from the YAML. */
export function repSummary(r) {
  return {
    name: r.name,
    role: r.role ?? null,
    linkedin: r.social?.linkedin || null,
    bio: r.description ?? null,
  };
}

export function formatRep(rep) {
  const bits = [];
  if (rep.role) bits.push(rep.role);
  if (rep.linkedin) bits.push(rep.linkedin);
  return bits.length ? `${rep.name} (${bits.join(", ")})` : rep.name;
}

export function renderMarkdownReport(report) {
  const lines = [];
  lines.push(`# Member migration report (${report.generatedAt})`);
  lines.push("");
  lines.push(`- YAML files processed: ${report.totals.yamlFiles}`);
  lines.push(`- Organizations/individuals with at least one domain-matched email: ${report.totals.matchedOrgs}`);
  lines.push(
    `- Org-less individuals created with a placeholder email (needs a real email attached via Users → Edit): ${report.totals.sentinelIndividuals}`,
  );
  lines.push(
    `- Unmatched org-tied representatives (no domain match at all — needs the Interim Admin Tool): ${report.totals.unmatched.length}`,
  );
  lines.push(`- Bare roster users (no attributable YAML org): ${report.bareRosterUsers.length}`);
  lines.push(
    `- WG-only roster users (subscribed to a WG list but absent from pkic.csv): ${report.wgOnlyRosterUsers.length}`,
  );
  lines.push(`- Missing membership category (\`memberType\` blank in YAML): ${report.totals.missingCategory.length}`);
  lines.push(
    `- Ambiguous representative/email pairing (needs staff confirmation): ${report.totals.ambiguousPairing.length}`,
  );
  lines.push(
    `- Event sponsorships with an unrecognized event name (needs an EVENT_NAME_ALIASES entry): ${report.unmatchedEventSponsorships.length}`,
  );
  lines.push(
    `- Non-member sponsorships created from data/sponsors.yaml (consortium + event rows): ${report.nonMemberSponsorships.created}`,
  );
  lines.push(
    `- Invalid links dropped (failed canonical URL/protocol validation, or a duplicate — see linksSchema): ${report.invalidLinks.length}`,
  );
  lines.push("");
  lines.push("## Working group roster membership counts");
  for (const [slug, count] of Object.entries(report.workingGroupCounts)) {
    lines.push(`- ${slug}: ${count}`);
  }
  lines.push("");
  lines.push("## Unmatched — finish via `POST /api/v1/admin/members` (Interim Admin Tool)");
  for (const item of report.totals.unmatched) {
    lines.push(
      `- **${item.name}** (\`${item.file}\`, category ${item.memberType || "unknown"}) — ${item.reason}. Representatives: ${item.representatives.map(formatRep).join("; ") || "(none listed)"}${item.workingGroupsHint?.length ? `. WG hint: ${item.workingGroupsHint.join(", ")}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Org-less individuals created with a placeholder email — attach a real email via Users → Edit");
  for (const item of report.needsEmailIndividuals) {
    lines.push(
      `- **${item.name}** (\`${item.file}\`, category ${item.memberType || "unknown"}) — created as \`${item.sentinelEmail}\`. ${item.reason}${item.workingGroupsHint?.length ? `. WG hint: ${item.workingGroupsHint.join(", ")}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Missing membership category — staff must set before launch");
  for (const item of report.totals.missingCategory) {
    lines.push(`- ${item.name} (\`${item.file}\`)`);
  }
  lines.push("");
  lines.push("## Ambiguous pairing — confirm representative ↔ email assignment");
  for (const item of report.totals.ambiguousPairing) {
    if (item.note) {
      lines.push(`- **${item.name}** (\`${item.file}\`) — ${item.note}: ${item.unpaired.map(formatRep).join("; ")}`);
    } else {
      lines.push(
        `- **${item.name}** (\`${item.file}\`) — representatives [${item.representatives.join(", ")}] paired best-effort (listed order) against emails [${item.candidateEmails.join(", ")}]`,
      );
    }
  }
  lines.push("");
  lines.push(
    "## Bare roster users (no YAML organization match) — working groups shown are where staff can look to reconcile identity manually",
  );
  for (const { email, workingGroups } of report.bareRosterUsers) {
    lines.push(`- ${email}${workingGroups.length ? ` — WGs: ${workingGroups.join(", ")}` : " — no WG membership"}`);
  }
  lines.push("");
  lines.push("## WG-only roster users (not in pkic.csv at all)");
  for (const { email, workingGroups } of report.wgOnlyRosterUsers) {
    lines.push(`- ${email}${workingGroups.length ? ` — WGs: ${workingGroups.join(", ")}` : ""}`);
  }
  lines.push("");
  lines.push("## Event sponsorships with an unrecognized event name — add an EVENT_NAME_ALIASES entry in the script");
  for (const item of report.unmatchedEventSponsorships) {
    lines.push(`- **${item.name}** (\`${item.file}\`) — \`${item.eventName}\` (tier ${item.tier})`);
  }
  lines.push("");
  lines.push(
    "## Non-member event sponsorships with an unrecognized event name (data/sponsors.yaml) — add an EVENT_NAME_ALIASES entry",
  );
  for (const item of report.nonMemberSponsorships.unmatchedEvents) {
    lines.push(`- **${item.name}** — \`${item.eventName}\` (tier ${item.tier})`);
  }
  lines.push("");
  lines.push("## Invalid links dropped — fix the source YAML and rerun");
  for (const item of report.invalidLinks) {
    lines.push(`- **${item.name}** (\`${item.file}\`) — \`${item.url}\``);
  }
  return lines.join("\n");
}
