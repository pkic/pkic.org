# Production-scale preview data

`pnpm seed:preview-scale` fills one event with synthetic data at production scale and creates test accounts for the team. Running it again changes nothing that is already in place.

## What it writes

- About 6,000 invented attendees (`…@scale-test.invalid`) across 900 invented organizations: registrations, day attendance, badges, saved sessions and organization identities, shaped like production's largest event. Names mix many languages, accents, hyphens, apostrophes and double surnames.
- A three-day agenda: 8 rooms, about 140 sessions and breaks, and 120 speakers with approved profiles and initials headshots. Titles run from two words to about 250 characters; abstracts and biographies come from a small hand-written pool and are sometimes empty. A room the event already has under the same name is reused.
- 12 event sponsorships.
- Test accounts: one per team member per role, at `first.last+<role>@pkic.org`. The roles are `organizer`, `committee`, `moderator`, `volunteer` and `studio`. Each role is granted on the seeded event only, never site-wide. `attendee` holds a registration. `sponsor` is the contact for one of the sponsorships and works at that sponsor.
- Every test account already works at PKI Consortium (the sponsor account at its sponsor) and has a job title, so the first sign-in asks nothing.
- The event's earlier agenda becomes private. It is kept, not deleted.
- Several events can be seeded on one database. They share the invented people, organizations and test accounts; registrations, badges, agenda and roles belong to each event.

## Run it

Review first. This reads preview, writes nothing, and reports how many existing public agenda items would become private:

```sh
pnpm seed:preview-scale --preview --sql-out /tmp/preview-scale.sql
```

To fill a fresh event instead of an existing one, which leaves the existing agenda alone:

```sh
pnpm seed:preview-scale --preview --event scale-test-event --create-event --name "Scale test event" --start 2027-03-02
```

Then apply the same command with `--apply`. Every preview branch shares this database, so the owner must agree first:

```sh
pnpm seed:preview-scale --preview --apply
pnpm seed:preview-scale --preview --apply --event scale-test-event --create-event --name "Scale test event" --start 2027-03-02
```

The first fills the existing event; the second creates and fills the new one.

Options:

- `--event <slug>`: the event to fill (default `pqc-conference-amsterdam-nl`).
- `--create-event --name <name> --start <YYYY-MM-DD>`: create the event first when no event has that slug. `--days <n>` (default 3) and `--timezone <IANA zone>` (default `Europe/Amsterdam`) shape it. The new event is invitation-only, so it stays off the public event list. Running it again reuses the event.
- `--attendees <n>` and `--speakers <n>`: change the volume.
- `--person <email>`: add a team member who has no account yet. Repeat it for each person.
- `--roster target|production|none`: where to find the team. `target`, the default, reads accounts on the database being seeded. `production` reads them from production and copies only their names and addresses into preview. Use it only with the owner's approval.
- `--skip-headshots`: skip the R2 uploads; speakers then have no headshot, including speakers that had one from an earlier run.
- `--passkeys <file>`: give every test account a software passkey. The file holds the private keys, so keep it outside the repository, for example `/Volumes/ScanDisk/preview-test-passkeys.json`. The script refuses a path inside the repository. Running it again reuses the keys in the file.
- `--publish`: after seeding, sign in as the first `organizer` account with its passkey and publish the agenda through the real endpoint, like **Approve for publication**. It needs `--passkeys`. `--base <url>` picks the preview it calls (default `https://stable.preview.pkic.org`, or `http://localhost:8788` locally). The first publication emails nobody. A later one emails people who saved a session whose title, time or room changed.

A re-run converges on the same agenda and speakers. Raising a volume later adds people; lowering it leaves the extra people in place.

Without `--preview`, the script seeds the local database (`--persist-to <dir>` picks the state directory). It cannot target production.

## After seeding

1. Sign in as `first.last+organizer@pkic.org` with an email link; it arrives in your own mailbox. Or, with the passkey file, get a session cookie without email:

   ```sh
   pnpm preview:sign-in --passkeys /Volumes/ScanDisk/preview-test-passkeys.json --email first.last+moderator@pkic.org
   ```

   It prints the cookie for `stable.preview.pkic.org`; `--base` picks another preview or the local Worker. It refuses production.
2. Without `--publish`, the organizer selects **Approve for publication**. The scanner, studio, moderation and public agenda use the published agenda. Pre-existing preview speakers may first need a profile review by a site admin under Agenda › Revisions › Review.
3. What each role sees: the organizer and committee get the agenda and settings; the moderator gets moderation and the scanner, but not the studio; the volunteer and studio accounts get the studio and the scanner. The sponsor account gets the sponsor workspace, leads and the lead scanner.
4. To test a badge, issue the attendee account's badge at the desk. Seeded badges scan through offline sync but cannot be reprinted.

## Cautions

- Never send an email campaign to the synthetic attendees. Preview delivers real email, and `scale-test.invalid` addresses only produce bounces.
- The `studio` account appears only once the migration that adds the studio operator role is on preview.
- The seed leaves the event's day capacities unchanged.
