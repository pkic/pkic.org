---
date: 2026-02-24T08:00:00Z
title: Post-Quantum Cryptography Conference - December 1 - 3, 2026 - Amsterdam, The Netherlands
summary: |
  The PKI Consortium will host the next Post-Quantum Cryptography (PQC) Conference in Amsterdam. Over three days, we will bring together public- and private-sector leaders, standards bodies, and implementers to share practical migration experience and to accelerate real-world post-quantum readiness.

aliases:
 - /pqcc

layout: single
outputs:
 - html
 - og-card
 - event-data
 - event-overlays
 - event-session
 - event-speakers
 - event-speakers2
 - event-agenda

cascade:
  params:
    heroImage: amsterdam-nl.png
    heroDescription: December 1 - 3, 2026 - Amsterdam, The Netherlands | Hybrid

params:
  eventType: conference
  eventDate: 2026-12-01T00:00:00Z
  eventDuration: 3
  heroButton:
    label: Request an invite / registration updates
    link: register/
  heroTitle: Post-Quantum Cryptography Conference

data:
  name: Post-Quantum Cryptography Conference
  timezone: Europe/Amsterdam
  # Locations with sessions in parallel ---------------------------------------
  # Notes:
  # - Plenary runs in the main red hall (~800 capacity). LIVE STREAMED.
  # - The parallel track runs in the blue (former main) hall (~270 capacity). LIVE STREAMED.
  # - During theme blocks, one of the two livestreamed halls leads (hosts the
  #   intro, a featured breakout, and the synthesis panel); the other runs a
  #   featured breakout in parallel.
  # - Rooms A–E are small-group breakout rooms, NOT livestreamed. Sessions are
  #   moderated by a subject matter expert and capped at ~30 participants.
  # - Remaining rooms: quiet work/call space, organizer office, up to 2 sponsor suites.
  locations:
    order: [plenary, blue_hall, room_a, room_b, room_c, room_d, room_e]
    plenary:
      color: black
    blue_hall:
      color: navy
    room_a:
      color: teal
    room_b:
      color: teal
    room_c:
      color: teal
    room_d:
      color: teal
    room_e:
      color: teal

  # Speakers ------------------------------------------------------------------
  speakers:
    - name: Paul van Brouwershaven
      title: Chair PKI Consortium
      bio: |
        Paul van Brouwershaven is a distinguished leader in cybersecurity with over two decades of experience specializing in Public Key Infrastructure (PKI). He chairs the PKI Consortium and leads its Post-Quantum Cryptography (PQC) Working Group, driving collaboration and innovation in digital trust and cryptographic agility.
      social:
        linkedin: https://www.linkedin.com/in/pvanbrouwershaven/
        x: https://x.com/vanbroup
        github: https://github.com/vanbroup

    - name: Albert de Ruiter
      title: Vice Chair PKI Consortium and Policy Authority PKI Dutch Government (Logius)
      bio: |
        Albert de Ruiter operates the Policy Authority at Logius, the digital government service organization of the Netherlands. He is also a member of the QvC (Quantum Secure Cryptography) working group of the Dutch government, a board member of HAPKIDO, and a member of the PKI Consortium.

    - name: NIST Representative (TBD)
      title: Keynote speaker (invited)
      bio: |
        We are aiming to host a keynote on the current state of quantum computing and post-quantum cryptography standardization, ideally delivered by a representative from NIST.

  # Agenda --------------------------------------------------------------------
  # Design rationale:
  # - Psychological rhythm per day: Energize → Focus → Collaborate → Recharge → Apply → Connect → Celebrate.
  # - Both halls in continuous use EXCEPT Blue hall during Day 1 Opening + Keynote (09:00–10:30),
  #   keeping the full audience together for the conference launch.
  # - Day 2 & 3 opens: 15 min simultaneously — Paul in Red hall, Albert in Blue hall.
  # - Day 2 & 3 closes: 15 min simultaneously — Paul in Red hall, Albert in Blue hall.
  # - Day 3 final close: Paul + Albert together in Red hall for the conference finale.
  # - Red hall (strategic / policy / leadership track): keynotes, panels, case studies, debates.
  # - Blue hall (technical / implementation track): deep dives, workshops, tooling, architecture.
  # - During the breakout hour Rooms A-E run small-group SME-led sessions; Blue hall runs
  #   a larger featured workshop on the same theme for attendees who prefer a bigger-room format.
  # - Post-lunch uses high-interactivity formats (fishbowl, workshop) to counter the energy dip.
  # - 45-min breaks are intentional networking windows; do not shorten them.
  # - Session blocks: 45 min (30 talk + 10 Q&A + 5 changeover). Panels: 60 min (55 + 5).
  # - Lunch: 90 min.
  agenda:
    2026-12-01:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        sessions:
          - title: Opening
            description: |
              Welcome to the 2026 PQC Conference. The chairs open the conference, set
              the agenda for the three days ahead, and invite attending sponsors for
              a one-minute introduction.
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "09:45"
        sessions:
          - title: "Keynote: The state of quantum computing and PQC standardisation"
            description: |
              Where does the quantum threat stand today, and what does the completion
              of NIST standardisation actually mean for your organisation? This keynote
              cuts through the noise and sets the scene for the three days ahead.

              _Target speaker: a NIST representative (TBD)._
            track: Keynote
            speakers:
              - NIST Representative (TBD)
            locations:
              - plenary

      - time: "10:30"
        title: Break

      - time: "11:15"
        sessions:
          - title: "Are you actually ready? The honest PQC migration readiness check"
            description: |
              A candid look at where organisations really stand: what is working, what is
              stalling, and what the most advanced adopters have in common. Not a roadmap
              slide deck — an honest conversation about the gap between planning and doing.
            locations:
              - plenary

          - title: "Cryptographic discovery: how do you find what you don't know you have?"
            description: |
              You cannot migrate what you have not inventoried. This session covers the
              practical realities of cryptographic discovery — the tooling, the surprises,
              the gaps, and what a meaningful inventory actually looks like in production.
            locations:
              - blue_hall

      - time: "12:00"
        sessions:
          - title: "Migration planning: where to start, what to prioritise, and how to avoid common pitfalls"
            description: |
              You know you need to migrate — but where do you actually start? This session
              covers how to build a realistic migration plan, how to prioritise across
              your inventory, and the common pitfalls that can stall or derail your progress.
            locations:
              - plenary

          - title: "Hybrid and composite signatures: what to deploy now and what to wait for"
            description: |
              The standards are here — but which hybrid and composite approaches are actually
              interoperable and safe to deploy today? A practical, opinionated session on
              navigating the current landscape without painting yourself into a corner.
            track: Workshop
            locations:
              - blue_hall

          - title: "Breakout A: Migration planning — governance, ownership, and accountability"
            description: |
              Who owns PQC migration in your organisation, and how do you hold progress
              accountable across teams, vendors, and timelines?
            locations:
              - room_a

          - title: "Breakout B: Inventories and discovery — keeping them current"
            description: |
              Building a cryptographic inventory is one challenge; keeping it accurate
              as systems evolve is another. This session focuses on the operational side.
            locations:
              - room_b

          - title: "Breakout C: PKI migration — certificates, CAs, and trust anchors"
            description: |
              Certificate lifecycle, CA migration paths, trust store changes, and the
              awkward question of what to do with long-lived certificates.
            locations:
              - room_c

          - title: "Breakout D: Crypto agility — architecture that doesn't lock you in"
            description: |
              Designing systems that can swap algorithms without a full rebuild. Lessons
              from teams that got it right — and teams that didn't.
            locations:
              - room_d

          - title: "Breakout E: Sector perspectives — regulated industries and critical infrastructure"
            description: |
              Banking, energy, healthcare, aviation: every sector has its own migration
              constraints. Share your sector's specific challenges and learn from peers.
            locations:
              - room_e

      - time: "13:00"
        title: Lunch

      - time: "14:30"
        sessions:
          - title: "Migration planning under pressure — a fishbowl debate"
            description: |
              A small group of practitioners debate migration strategy in the centre of
              the room. Audience members can swap in at any point. Expect disagreement,
              hard questions, and more honesty than a standard panel.
            track: Panel discussion
            locations:
              - plenary

          - title: "Crypto agility in practice: building systems ready for the next algorithm change"
            description: |
              Hands-on workshop exploring real architectures: what crypto agility actually
              requires at the code, infrastructure, and process level — and where the
              shortcuts come back to bite you.
            track: Workshop
            locations:
              - blue_hall

      - time: "15:30"
        title: Break

      - time: "16:15"
        sessions:
          - title: "Three migrations, three lessons: rapid-fire case studies"
            description: |
              Three organisations present their PQC migration experience in 12 minutes
              each — no slides beyond a single diagram, no marketing, just what happened.
              Followed by a joint Q&A.
            track: Case studies
            locations:
              - plenary

          - title: "PQC tooling showcase: live demos from migration and testing tools"
            description: |
              Side-by-side live demonstrations of leading PQC migration, discovery, and
              testing tools. See what they can and cannot do — then ask the hard questions.
            locations:
              - blue_hall

      - time: "17:00"
        sessions:
          - title: Closing (Day 1)
            description: |
              Brief closing remarks and a preview of Day 2.
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: Closing (Day 1)
            description: |
              Brief closing remarks for the blue hall audience and a preview of Day 2.
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "17:15"
        title: "Networking & drinks"

    2026-12-02:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        sessions:
          - title: "Welcome back — Day 2"
            description: |
              A quick look at what is on today and how to get the most out of it.
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: "Welcome back — Day 2"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "09:15"
        sessions:
          - title: "The supply chain blind spot: why most organisations don't know what they depend on"
            description: |
              Vendor-provided libraries, hardware chips, cloud services, open-source
              components — your cryptography is distributed across a supply chain you
              probably cannot fully see yet. This session frames why that matters and
              what the most exposed organisations are doing about it.
            locations:
              - plenary

          - title: "CBOM: building and using your Cryptographic Bill of Materials"
            description: |
              What is a CBOM, how does it relate to an SBOM, and what do you actually
              do with one? A technical session on structure, tooling, and integration
              into existing security and procurement workflows.
            locations:
              - blue_hall

      - time: "10:00"
        sessions:
          - title: "Vendor readiness reality check: separating marketing from product"
            description: |
              A frank panel with enterprise buyers and vendors. Which products are
              genuinely PQC-ready, which are shipping promises, and what contractual
              and technical levers do buyers have?
            track: Panel discussion
            locations:
              - plenary

          - title: "Automated crypto discovery: tools, methods, and the things they miss"
            description: |
              A comparative look at automated discovery approaches — SAST, DAST,
              network scanning, agent-based monitoring — covering what each finds,
              what each misses, and how to combine them effectively.
            locations:
              - blue_hall

      - time: "10:45"
        title: Break

      - time: "11:30"
        sessions:
          - title: "Supply chain readiness & crypto discovery: setting the scene"
            description: |
              Framing of the day's theme for the afternoon breakout sessions: the key
              tensions, open questions, and what good looks like for each topic.
            locations:
              - plenary

          - title: "From inventory to action: prioritising your cryptographic findings"
            description: |
              Having a complete inventory is only useful if you know what to fix first.
              This session covers risk-based prioritisation, dependency mapping, and
              turning discovery output into a credible remediation plan.
            locations:
              - blue_hall

      - time: "12:15"
        sessions:
          - title: "Continuous crypto monitoring: treating cryptography as a first-class security control"
            description: |
              Cryptographic posture drifts the moment you stop watching. This workshop
              covers monitoring architecture, alerting strategies, and how to integrate
              crypto visibility into your existing security operations.
            track: Workshop
            locations:
              - blue_hall

          - title: "Breakout A: Vendor constraints and procurement timelines"
            description: |
              How do you negotiate PQC readiness into vendor contracts? What timelines
              are realistic, and what happens when a critical supplier is not ready?
            locations:
              - room_a

          - title: "Breakout B: Crypto discovery — methods, tooling, and pitfalls"
            description: |
              Hands-on discussion of what works (and what doesn't) for discovery
              at scale — from small teams to large enterprises.
            locations:
              - room_b

          - title: "Breakout C: Crypto agility — architecture and phased rollout"
            description: |
              Moving from monolithic cryptographic dependencies to agile, swappable
              implementations. Patterns, anti-patterns, and hard-won lessons.
            locations:
              - room_c

          - title: "Breakout D: Sector deep dive (TBA)"
            description: |
              An in-depth discussion focused on the supply chain and discovery challenges
              specific to one industry sector. Sector and facilitator to be announced.
            locations:
              - room_d

          - title: "Breakout E: Implementation clinic — bring your challenges"
            description: |
              Stuck on something? Bring your real implementation problem and work through
              it with a small group of peers and an experienced facilitator.
            locations:
              - room_e

      - time: "13:15"
        title: Lunch

      - time: "14:45"
        sessions:
          - title: "What have we learned? Supply chain and discovery synthesis"
            description: |
              A fishbowl-format synthesis panel drawing on the morning sessions and
              breakout discussions. What are the common patterns? Where do people
              disagree? What should you take back to your organisation this week?
            track: Panel discussion
            locations:
              - plenary

          - title: "Securing the delivery pipeline: PQC for code signing, containers, and CI/CD"
            description: |
              Software supply chain security meets post-quantum cryptography. This
              workshop covers code signing migration, container image trust, pipeline
              integrity, and the intersection with SBOM and CBOM requirements.
            track: Workshop
            locations:
              - blue_hall

      - time: "15:45"
        title: Break

      - time: "16:30"
        sessions:
          - title: "When your vendor isn't ready: alternative strategies and contractual levers"
            description: |
              What do you do when a critical supplier cannot give you a credible PQC
              roadmap? This session covers compensating controls, risk acceptance
              frameworks, and how to use procurement as a forcing function.
            locations:
              - plenary

          - title: "Post-quantum TLS in practice: deployment, interoperability, and what breaks"
            description: |
              Real deployment experience with PQC-enabled TLS: which stacks are ready,
              which middleboxes fail, how to test at scale, and what hybrid configurations
              are safe to run in production today.
            locations:
              - blue_hall

      - time: "17:15"
        sessions:
          - title: Closing (Day 2)
            description: |
              Brief closing remarks and a preview of Day 3.
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: Closing (Day 2)
            description: |
              Brief closing remarks for the blue hall audience and a preview of Day 3.
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "17:30"
        title: "Networking & drinks"

    2026-12-03:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        sessions:
          - title: "Welcome back — Day 3"
            description: |
              Final day framing: what is ahead, and how to make the most of the
              last day before heading back into the real world.
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: "Welcome back — Day 3"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "09:15"
        sessions:
          - title: "National mandates lightning round: six countries, six updates, 45 minutes"
            description: |
              Brief structured updates from national programme representatives: what
              is mandated, what is funded, where progress has stalled, and what the
              rest of the world can learn from each experience.
            track: Lightning talks
            locations:
              - plenary

          - title: "PQC in hardware: HSMs, TPMs, secure enclaves, and legacy appliances"
            description: |
              Not everything runs on software you can patch. This session covers the
              practical realities of PQC migration in hardware-bound environments —
              support matrices, firmware update realities, and long-lifecycle strategies.
            locations:
              - blue_hall

      - time: "10:00"
        sessions:
          - title: "Coordinating across borders: EU, ETSI, ISO, and the standards maze"
            description: |
              When national mandates, EU regulations, and international standards pull
              in different directions, which requirements take precedence? A practical
              guide to navigating the overlapping landscape without losing your mind.
            locations:
              - plenary

          - title: "Open-source PQC libraries: what is production-ready and what needs maturity"
            description: |
              liboqs, the NIST reference implementations, language-native libraries —
              a frank assessment of what is ready to deploy, what still lacks audit
              coverage or performance, and where contributions are most needed.
            locations:
              - blue_hall

      - time: "10:45"
        title: Break

      - time: "11:30"
        sessions:
          - title: "National approaches to PQC: updates and lessons from the front line"
            description: |
              Representatives from national cybersecurity agencies and government
              programmes share their latest updates, practical lessons, and the
              challenges that no one quite anticipated.
            locations:
              - plenary

          - title: "Regulatory obligations for PQC: DORA, NIS2, and sector-specific requirements"
            description: |
              Which regulations create binding PQC obligations, on what timeline, and
              for whom? A practical session on compliance gaps, regulatory expectations,
              and how to document your migration progress for auditors and regulators.
            locations:
              - blue_hall

      - time: "12:15"
        sessions:
          - title: "National programme leads open forum: ask us anything"
            description: |
              An open Q&A with national programme representatives. Submit questions
              in advance or ask live. The conversation that doesn't happen in the
              formal session — direct, frank, and on the record.
            track: Open forum
            locations:
              - blue_hall

          - title: "Roundtable A: Policy coordination and cross-agency alignment"
            description: |
              How do national programmes align standards, timelines, and mandates
              across departments, agencies, and regulated sectors?
            locations:
              - room_a

          - title: "Roundtable B: Critical infrastructure — the hardest migration challenges"
            description: |
              Long-lived systems, safety-critical environments, and the specific
              constraints that make PQC migration in critical infrastructure uniquely difficult.
            locations:
              - room_b

          - title: "Roundtable C: Finance and payments — regulatory pressure and migration timelines"
            description: |
              How are financial institutions approaching PQC under overlapping regulatory
              timelines? Where is the industry aligned, and where is it fragmented?
            locations:
              - room_c

          - title: "Roundtable D: Telecom and IoT — scale, devices, and long lifecycle systems"
            description: |
              Billions of devices, multi-decade lifespans, distributed update mechanisms.
              The particular challenges of PQC at telecom and IoT scale.
            locations:
              - room_d

          - title: "Roundtable E: Implementation realities — staffing, procurement, and measuring progress"
            description: |
              The operational realities of running a PQC programme: building internal
              expertise, engaging the right vendors, and demonstrating progress to leadership.
            locations:
              - room_e

      - time: "13:15"
        title: Lunch

      - time: "14:45"
        sessions:
          - title: "What would it take to get every organisation on track? A synthesis"
            description: |
              Pulling together the threads from all three days and from the national
              roundtables: what are the systemic blockers, who needs to move first,
              and what commitments can this community make before we leave Amsterdam?
            track: Panel discussion
            locations:
              - plenary

          - title: "War stories: real implementation failures and what we learned"
            description: |
              An unfiltered session from practitioners who have been through it.
              No vendor content. No success theatre. Just what went wrong, why,
              and what they would do differently — so you don't have to repeat it.
            locations:
              - blue_hall

      - time: "15:45"
        title: Break

      - time: "16:30"
        sessions:
          - title: "The road ahead: from migration to crypto-agile operations"
            description: |
              After the migration sprint is over, what does sustainable cryptographic
              agility look like? A forward-looking session on where the field is heading
              — new threats, new standards, and the organisational capability you will
              need to stay ahead.
            locations:
              - plenary

          - title: "What does the PQC community need next?"
            description: |
              An open community discussion: what is missing from the ecosystem in terms
              of standards, tooling, education, guidance, or coordination — and what
              can this community commit to building together?
            track: Open forum
            locations:
              - blue_hall

      - time: "17:15"
        sessions:
          - title: Conference closing
            description: |
              The chairs bring the conference to a close with key takeaways, a call to
              action, and what comes next for the PKI Consortium's PQC work.
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "17:30"
        title: "Farewell networking & drinks"
---

## Conference details

The PKI Consortium will host the next Post-Quantum Cryptography (PQC) Conference on **Tuesday, December 1 to Thursday, December 3, 2026** in **Amsterdam, the Netherlands**.

This conference is designed for executives, technical leaders, and practitioners from the public and private sector who are actively preparing for post-quantum migration.

> The conference is open to anyone interested in preparing for Post-Quantum Cryptography and is **not limited** to members of the PKI Consortium.
{.callout-info}

## Date and location

**Date:** Tuesday, December 1 to Thursday, December 3, 2026  
**Venue:** Meervaart, Amsterdam, the Netherlands

While we initially planned to host the event in Germany, we have decided to return to the Meervaart in Amsterdam, the same venue we used in 2023.

This time we have secured the entire venue for three days, which significantly expands what we can do:

- Main hall capacity of up to 800 attendees, compared to 270 in 2023
- The former main hall (270 attendees) repurposed for the parallel track
- Nine additional rooms (+/- 25-100 attendees) available for breakout sessions and workshops

## Program format (preliminary)

We are planning:

- **45-minute session blocks** (30 minute presentation + 10 minute Q&A + 5 minutes to switch rooms)
- **60-minute panel blocks** (55 minutes + 5 minutes to switch rooms)
- **Lunch:** 90 minutes (1.5 hours)
- **Breaks:** 45 minutes

Each day includes a structured, experience-driven theme block:

- A short plenary introduction to frame the theme and set practical objectives
- Expert-led breakout sessions, where each group examines the same theme from different perspectives
- A reconvened plenary panel to synthesize insights and distill practical takeaways

## Sponsors

Interested in sponsoring the conference? Please reach out via our [sponsorship page](/sponsors/) or contact us at contact (at) pkic.org.

{{< sponsors-level sponsoring="Post-Quantum Cryptography Conference Amsterdam 2026" level="all" >}}

## Agenda

> This is a **preliminary** agenda framework. Session titles and speakers will be added as the program is finalized.
{.callout-warning}

{{< agenda default="2026-12-01" >}}

For more information about this conference, please contact the PKI Consortium at contact (at) pkic.org.
