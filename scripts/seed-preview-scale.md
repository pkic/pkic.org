# Production-scale preview data

`pnpm seed:preview-scale` fills one event with synthetic data at production scale and creates test accounts for the team. Running it again changes nothing that is already in place.

## What it writes

- About 6,000 invented attendees (`…@scale-test.invalid`) across 900 invented organizations: registrations, day attendance, badges, saved sessions and organization identities, shaped like production's largest event. Names mix many languages, accents, hyphens, apostrophes and double surnames.
- A three-day agenda: 8 rooms, about 140 sessions and breaks, and 120 speakers with approved profiles and initials headshots. Titles run from two words to about 250 characters; abstracts and biographies come from a small hand-written pool and are sometimes empty. A room the event already has under the same name is reused.
- 12 event sponsorships.
- Test accounts: one per team member per role, at `first.last+<role>@pkic.org`. The roles are `organizer`, `committee`, `moderator`, `volunteer` and `studio`, plus `attendee`, which holds a registration. Each role is granted on the seeded event only, never site-wide.
- The event's earlier agenda becomes private. It is kept, not deleted.

## Run it

Review first. This reads preview, writes nothing, and reports how many existing public agenda items would become private:

```sh
pnpm seed:preview-scale --preview --sql-out /tmp/preview-scale.sql
```

Then apply it. Every preview branch shares this database, so the owner must agree first:

```sh
pnpm seed:preview-scale --preview --apply
```

Options:

- `--event <slug>`: the event to fill (default `pqc-conference-amsterdam-nl`).
- `--attendees <n>` and `--speakers <n>`: change the volume.
- `--person <email>`: add a team member who has no account yet. Repeat it for each person.
- `--roster target|production|none`: where to find the team. `target`, the default, reads accounts on the database being seeded. `production` reads them from production and copies only their names and addresses into preview. Use it only with the owner's approval.
- `--skip-headshots`: skip the R2 uploads; speakers then have no headshot.

A re-run converges on the same agenda and speakers. Raising a volume later adds people; lowering it leaves the extra people in place.

Without `--preview`, the script seeds the local database (`--persist-to <dir>` picks the state directory). It cannot target production.

## After seeding

1. Sign in as `first.last+organizer@pkic.org`. The link arrives in your own mailbox. On the first sign-in, choose PKI Consortium and enter a job title.
2. Pre-existing preview speakers may still need a profile review. A site admin approves them under Agenda › Revisions › Review.
3. The organizer selects **Approve for publication**. The scanner, studio and public agenda use the published agenda.
4. To test a badge, issue the attendee account's badge at the desk. Seeded badges scan through offline sync but cannot be reprinted.

## Cautions

- Never send an email campaign to the synthetic attendees. Preview delivers real email, and `scale-test.invalid` addresses only produce bounces.
- The `studio` account appears only once the migration that adds the studio operator role is on preview.
- The seed leaves the event's day capacities unchanged.
