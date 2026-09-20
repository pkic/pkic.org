/**
 * Renders the structured migration report (built by the orchestrator while
 * walking YAML records) into the human-readable Markdown summary. No SQL,
 * no reconciliation logic — just formatting already-decided data.
 */
import { RESERVATION_REASONS } from "./email-reservations.mjs";

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
  lines.push("This report describes generated SQL, not proof that it has been applied to a database.");
  lines.push("");
  lines.push(`- Organizations to upsert: ${report.totals.organizations ?? "not recorded"}`);
  lines.push(`- YAML files processed: ${report.totals.yamlFiles}`);
  lines.push(`- Organizations/individuals with a roster match or confirmed manual email: ${report.totals.matchedOrgs}`);
  lines.push(
    `- Org-less individuals created with a placeholder email (needs a real email attached via Users → Edit): ${report.totals.sentinelIndividuals}`,
  );
  lines.push(
    `- Unmatched org-tied representatives (no domain match at all — needs the Interim Admin Tool): ${report.totals.unmatched.length}`,
  );
  lines.push(`- Bare roster users (no attributable YAML org): ${report.bareRosterUsers.length}`);
  lines.push(
    `- Group-only roster users (subscribed to a group list but absent from pkic.csv): ${report.groupOnlyRosterUsers.length}`,
  );
  lines.push(`- Missing membership category (\`memberType\` blank in YAML): ${report.totals.missingCategory.length}`);
  lines.push(
    `- Identity review entries (automatic guesses and unpaired representatives): ${report.totals.ambiguousPairing.length}`,
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
  lines.push("## Manual mapping decisions");
  if (!report.manualMappings?.length) lines.push("No manual mapping file supplied.");
  for (const row of report.manualMappings ?? []) {
    lines.push(
      `- **${row.name}** (\`${row.file}\`) — ${row.decision}${row.email ? `: ${row.email}` : ""}${row.decision === "unresolved" ? "; no identity guessed" : ""}`,
    );
  }
  lines.push("");
  lines.push("## Group roster membership counts");
  for (const [slug, count] of Object.entries(report.groupRosterCounts)) {
    lines.push(`- ${slug}: ${count}`);
  }
  for (const filename of report.missingOptionalRosters) {
    lines.push(`- Missing optional roster: ${filename}. No memberships generated from this source.`);
  }
  lines.push("");
  lines.push("## Unmatched — finish via canonical `POST /api/v1/members` membership provisioning");
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
  lines.push("## Identity review — confirm every automatic name ↔ email assignment");
  lines.push(
    "Every automatic assignment below is unconfirmed, including name matches and single-candidate matches. Review each guess and add or update its person decision in the manual mapping CSV. Use confirmed only after verifying the email; use unresolved to prevent guessing. Rerun with --manual-mapping before applying SQL. These flags do not prevent SQL generation.",
  );
  for (const item of report.totals.ambiguousPairing) {
    if (item.note) {
      lines.push(`- **${item.name}** (\`${item.file}\`) — ${item.note}: ${item.unpaired.map(formatRep).join("; ")}`);
    } else {
      for (const guess of item.guesses) {
        lines.push(
          `- **${item.name}** (\`${item.file}\`) — ${guess.representative} → \`${guess.email}\` — **unconfirmed ${guess.method}**. Candidate emails: [${item.candidateEmails.join(", ")}]`,
        );
      }
    }
  }
  lines.push("");
  lines.push(
    "## Bare roster users (no YAML organization match) — groups shown are where staff can look to reconcile identity manually",
  );
  for (const { email, groups } of report.bareRosterUsers) {
    lines.push(`- ${email}${groups.length ? ` — Groups: ${groups.join(", ")}` : " — no group membership"}`);
  }
  lines.push("");
  lines.push("## Group-only roster users (not in pkic.csv at all)");
  for (const { email, groups } of report.groupOnlyRosterUsers) {
    lines.push(`- ${email}${groups.length ? ` — Groups: ${groups.join(", ")}` : ""}`);
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
  lines.push("## Addresses reserved elsewhere — settle the reservation, then rerun the importer");
  if (report.emailReservationConflicts === null || report.emailReservationConflicts === undefined) {
    lines.push("Not checked: no SQL was applied to a database in this run.");
  } else if (report.emailReservationConflicts.length === 0) {
    lines.push("None: every imported address belongs to a live account.");
  } else {
    lines.push(
      "One address is one reservation across primary, alternate, and pending account addresses. These member addresses were already claimed, so no member account was created for them. The importer is idempotent — rerun it once the reservation is settled.",
    );
    for (const conflict of report.emailReservationConflicts) {
      const reason = RESERVATION_REASONS[conflict.reason] ?? conflict.reason;
      lines.push(`- \`${conflict.email}\` — ${reason}${conflict.reservedBy ? ` (\`${conflict.reservedBy}\`)` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Invalid links dropped — fix the source YAML and rerun");
  for (const item of report.invalidLinks) {
    lines.push(`- **${item.name}** (\`${item.file}\`) — \`${item.url}\``);
  }
  return lines.join("\n");
}
