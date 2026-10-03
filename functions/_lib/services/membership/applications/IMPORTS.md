# Membership application imports

Imports are operational actions requiring separate approval from schema rollout. Deploying this code does not apply migration 0037, import applications, activate processing, or change GitHub issues.

Apply the additive migration through the repository's approved environment migration script. Rehearse with synthetic records only in preview. Never configure private GitHub source access or copy production application data into preview.

## Reconciliation and import

1. With authorized GitHub access, page through all issues with the exact `Membership application` label, then all comments and timeline events. Keep exports and reconciliation manifests in a restricted directory outside the repository. Resolve the label's numeric identity, final closure, effective duplicate disposition, source fields, attachment references, and exact portal identity matches. `applicationImportEligibility` and `historicalApplicationFields` define the reusable eligibility and field parsing policies.
2. Assign every excluded or unresolved source an explicit reason and a staff owner. `completed` is a GitHub disposition, not a membership decision. Map uncertain eligible history to `closed_unknown`. Do not infer consent, category, approval dates, completed requirements, or identity from similar names.
3. Review each mapping against its source. Historical records can retain null fields. An active application needs the current form's validated answers, category, applicant identity, and a published workflow. Missing active evidence stays in reconciliation instead of bypassing live validation. Set `manualHold: true` when the reviewed source must remain indefinitely held, and explain the decision in `mappingReason`; the decision is retained in the import audit. Map pending consultations and executive reviews to consensus requirements with their existing audiences. Completed requirements and objections reference source event IDs; preserve source notice opening times and deadlines.
4. After production import approval, configure `GITHUB_MEMBERS_IMPORT_TOKEN` with read-only access to `pkic/members` in production only. The import endpoint remains disabled without it. Authenticate as a user with `membership:approve` and send one `POST /api/v1/members/applications/imports` per reviewed mapping. Its canonical contract is `membershipApplicationImportRequestSchema`: a UUID `runId`, `sourceIssueNumber`, normalized `expectedUpdatedAt`, and `mapping`. The server independently resolves the label and rereads all issue, comment, and timeline pages before writing.
5. Record each returned ID. A source's immutable issue ID is unique, reruns never overwrite its first import, and each issue's application, form, workflow, source snapshot, identity guards, and audit commit in one atomic D1 batch. Exact existing application matches are refused for explicit reconciliation. Attachment URLs stay private references; their availability must be reviewed separately.
6. Compare the final source inventory with imported, already-present, excluded, and unresolved counts. Review a fresh dry run before declaring migration complete. Do not publish the private report in a public PR.

## Controlled continuation

Open imports initially have no evaluation deadline and cannot transition, send messages, restart workflows, or advance through the scheduler. Importing produces no accounts, memberships, invitations, outbox messages, or onboarding effects.

After reconciling previous requirements, objections, review eligibility, timing, and portal processing ownership, an authorized approver can `POST /api/v1/members/applications/:id/activation` with a descriptive `reason`. Activation is an audited command that schedules subsequent normal processing; it does not send a notice or advance the workflow. Source notices use their preserved opening time and deadline rather than synthetic outbox messages. An elapsed or missing source review window blocks activation and requires further reconciliation; elapsed time is never itself approval authority.

Shared source policy requires issue 795's reviewed mapping to explicitly set `manualHold: true`; a first import without that acknowledgment is rejected. Other sources can use the same mapping flag for an indefinite manual hold. Ordinary activation refuses it. Only after the requester explicitly releases it may the approver submit `releaseManualHold: true` and document that instruction and the reconciled timing in `reason`. Release is recorded in the application timeline. Import reruns cannot restore or release a later hold decision.

GitHub commenting or closure remains a separately authorized action. Preserve every original source issue and link. Remove the production source credential when the import is complete.

## Recovery

A failed issue batch leaves no partial source, form, application, workflow, or audit rows; retry that issue with fresh source evidence. Completed batches are resumable by stable source identity. Keep the run ID and per-issue results in the restricted report.

For an erroneous committed mapping, stop cutover activation, remove the source credential to stop further imports, and retain the restricted snapshot and audit evidence. Identify affected records through `membership_application_sources.run_id`. Do not restore a whole-database backup or rerun an import with a different identity: either can damage preexisting records or subsequent portal edits. Prepare a separately reviewed, guarded correction for only the affected records, checking their current revision, activation state, communications, documents, and identity links. Preserve all later decisions and evidence. Activated records require normal authorized workflow recovery rather than deletion or reimport.

## Manual verification

- Submit a synthetic application for an example organization and user through the current form. In Active applications, search and filter it, open the detail, and complete or decline it. After refresh it appears only in Application history.
- Search, sort, filter, and page through History. Open a record and use browser Back; the query and page are restored. Active and History use independent URL namespaces.
- Inspect synthetic imported approval, rejection, withdrawal, and unknown-outcome records. Confirm source attribution, original body, discussion, closure dates, and the original issue link. Unknown fields stay unknown and imported history offers no processing controls.
- Import a synthetic active application in a Worker test, rerun it, and run reminder and workflow schedulers before activation. Confirm no notices or onboarding. Verify source review windows are preserved after activation and no source notices are replayed.
- Exercise issue 795's manual-hold fixture across scheduler runs, failed activation, explicit release, and reruns. It must remain held until the explicit audited release.
