---
date: 2026-02-24T08:00:00Z
title: Post-Quantum Cryptography Conference - December 1 - 3, 2026 - Amsterdam, The Netherlands
linkTitle: Overview
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
    heroSponsorLevel: 5
    sectionNav: true
    sponsoring: "Post-Quantum Cryptography Conference Amsterdam 2026"

params:
  eventType: conference
  eventDate: 2026-12-01T00:00:00Z
  eventDuration: 3
  heroHeight: 65vh
  heroButton:
    label: "Secure your seat →"
    link: register/
  heroTitle: Post-Quantum Cryptography Conference

data:
  name: Post-Quantum Cryptography Conference
  timezone: Europe/Amsterdam
  draft: true

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
        Paul van Brouwershaven is a distinguished leader in cybersecurity with over two decades of experience specializing in Public Key Infrastructure (PKI). He is the owner and CEO of Digitorus and chairs the PKI Consortium and leads its Post-Quantum Cryptography (PQC) Working Group, driving collaboration and innovation in digital trust and cryptographic agility.
      social:
        linkedin: https://www.linkedin.com/in/pvanbrouwershaven/
        x: https://x.com/vanbroup
        github: https://github.com/vanbroup

    - name: Albert de Ruiter
      title: Vice Chair PKI Consortium and Policy Authority PKI Dutch Government (Logius)
      bio: |
        Albert de Ruiter operates the Policy Authority at Logius, the digital government service organization of the Netherlands. He is also a member of the QvC (Quantum Secure Cryptography) working group of the Dutch government, a board member of HAPKIDO, and the Vice Chair of the PKI Consortium.

    - name: NIST Representative (TBC)
      title: Invited Speaker
      bio: |
        A frequent contributor to the PKI Consortium’s PQC conferences, NIST remains instrumental in shaping the cryptographic landscape. We are pleased to invite representatives from their Standardization and NCCoE programs to discuss the next phases of PQC development and deployment (pending final confirmation).

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
  # - 30-min breaks are intentional networking windows; do not shorten them.
  # - Session blocks: 45 min (30 talk + 10 Q&A + 5 changeover). Panels: 60 min (55 + 5).
  # - Lunch: 90 min.
  agenda:
    2026-12-01:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
        sessions:
          - title: Opening
            description: |
              Welcome to the 2026 PQC Conference. The chairs open the conference, set
              the agenda for the three days ahead, and invite some attending sponsors for
              a one-minute pitch (the only commercial message allowed at this conference).
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "09:30"
        sessions:
          - title: "The state of quantum computing and cryptographic threats"
            description: |
              An overview of where quantum computing stands today and what it means
              for cryptographic security. Speaker to be confirmed.
            track: Keynote
            locations:
              - plenary

      - time: "10:15"
        title: Break

      - time: "11:00"
        sessions:
          - title: "NIST PQC standardization: status update"
            description: |
              A status update from NIST on the post-quantum cryptography
              standardization process. Speaker to be confirmed.
            speakers:
              - NIST Representative (TBC)
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "11:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "12:45"
        title: Lunch

      - time: "13:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "14:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_a

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_b

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

      - time: "15:30"
        title: Break

      - time: "16:00"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
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

      - time: "17:05"
        title: End of day one

    2026-12-02:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
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
          - title: "Cryptographic module vendors"
            description: |
              The famous HSM panel — a panel discussion with leading cryptographic
              module vendors covering the current state of PQC support in hardware
              security modules and related products. Moderators and panellists to
              be confirmed.
            track: Panel discussion
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "10:15"
        title: Break

      - time: "11:00"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "11:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "12:45"
        title: Lunch

      - time: "13:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "14:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_a

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_b

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

      - time: "15:30"
        title: Break

      - time: "16:00"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
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

      - time: "17:05"
        title: "Networking & drinks"

      - time: "18:30"
        title: "End of day two"

    2026-12-03:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
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
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: "Cryptographic module interoperability"
            description: |
              A technical panel exploring PQC interoperability across cryptographic
              modules — covering HSMs, smartcards, tokens, and related hardware.
              Moderators and panellists to be confirmed.
            track: Panel discussion
            locations:
              - blue_hall

      - time: "10:15"
        title: Break

      - time: "11:00"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "11:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "12:45"
        title: Lunch

      - time: "13:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "14:30"
        sessions:
          - title: "Government representatives and regulators"
            description: |
              A panel discussion with government representatives and regulators from
              around the world on PQC policy, mandates, and migration timelines.
              Panellists to be confirmed.
            track: Panel discussion
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_a

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_b

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e

      - time: "15:30"
        title: Break

      - time: "16:00"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "16:45"
        noTransition: true
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

      - time: "17:00"
        title: "End of day three — thank you for joining us!"
---

Quantum computers will soon break the cryptographic foundation of the modern enterprise. This is no longer a theoretical risk for cryptography experts to debate—it is an imminent business continuity crisis that every digital organisation must solve.

The **PQC Conference Amsterdam 2026** is the definitive global gathering for the post-quantum transition. The rules from NIST are finalized. The deployment phase is here. The question is no longer *if* you should migrate, but *how fast* and *what breaks* along the way.

This isn't just an awareness event. This is where the organisations leading the transition share **exactly how they are doing it**, what problem they have run into, and how they have addressed them. Three days of practitioner-level experience: actionable migration blueprints, off-the-record discussions, and the connections that will cut months off your delivery timeline.

{{< stat-grid class="my-5" >}}
stats:
  - number: "2,600+"
    label: "Prior Attendees"
  - number: "~75"
    label: "Speakers"
  - number: "50+"
    label: "Sessions"
  - number: "5th"
    label: "Edition"
{{< /stat-grid >}}

> **Join the community.** The conference is open to every organization preparing for the quantum transition and is completely free to attend. It is not limited to members of the PKI Consortium.
{.callout-info}

## A Conference Designed for the Entire Enterprise

Migrating an enterprise to post-quantum cryptography requires more than just engineers writing code. It requires budget, risk mandates, policy alignment, and technology procurement.

We have structured the 2026 agenda to serve the two distinct halves of a successful migration:

{{< cards >}}
card_style: bento
cards:
  - color: "bento-dark"
    image: "photos/ASP_1760.jpg"
    icon: compass
    title: "The Strategic Track"
    text: |
      For the C-Suite, Risk Officers, and PMOs. The Strategic Track focuses entirely on the *business* of migration.
      
      - **Regulatory Compliance:** Navigate NIS2, DORA, and evolving mandates.
      - **Budget & Scoping:** Estimate the true cost of a multi-year migration.
      - **Vendor Assessments:** Which platforms and HSMs are actually ready?
      - **Timeline Strategy:** Sequencing without breaking legacy applications.
      
      **Plenary / Red Hall**
  - color: "bento-darker"
    image: "photos/AME_0934.jpg"
    icon: terminal
    title: "The Technical Track"
    text: |
      For Architects, DevOps, and Implementers. Deep-dive sessions on the actual implementation of the new NIST standards.
      
      - **Crypto-Agility in CI/CD:** Pipelines that allow algorithm swapping.
      - **Hybrid Key Exchange:** Classical/PQC TLS handshakes.
      - **Certificate Automation:** Managing the collision of PQC sizes with 47-day limits.
      - **Hands-on Tooling:** Libraries ready for use today.
      
      **Parallel / Blue Hall**
{{< /cards >}}

## Why You Cannot Afford to Wait

{{< cards >}}
card_style: bento
cards:
  - color: bento-orange-pale
    icon: alert-triangle
    title: "The rules are finalized"
    text: "NIST has officially published ML-KEM, ML-DSA, and SLH-DSA. The deployment phase has begun. The blueprint is set."
  - color: bento-teal-pale
    icon: cloud
    title: "Harvest now, decrypt later"
    text: "Adversaries are collecting your encrypted traffic today. Every day you delay is another day of sensitive data permanently exposed to future quantum attacks."
  - color: bento-red-pale
    icon: gavel
    title: "Regulatory countdowns"
    text: "Auditors and regulators are turning guidance into mandates. Failing to demonstrate a cryptographic agility plan risks severe penalties."
  - color: bento-purple-pale
    icon: cpu
    title: "The automation collision"
    text: "Moving to 47-day certificate lifespans while manually handling complex PQC migrations is a recipe for catastrophic infrastructure outages."
{{< /cards >}}

## Free to Attend, Supported by the Community

The PKI Consortium believes that securing the world's digital infrastructure against quantum threats shouldn't be hidden behind expensive paywalls. 

**Attendance to the PQC Conference—whether in-person in Amsterdam or virtual—is 100% free.**

{{< cards >}}
card_style: bento
cards:
  - title: "Support the Mission"
    color: bento-green-pale
    image: "photos/ANN04967.jpg"
    icon: landmark
    text: |
      While tickets are free, running a global technical conference is not. While our main room can hold 800 attendees and the total venue many more, our total attendee capacity will depend on the available budget. If your organization finds value in our work, please consider making a voluntary donation or sponsoring the PKI Consortium.

      *Please note: Donations are entirely voluntary and are strictly separated from event attendance. A donation is a contribution to our ongoing mission, not a fee or payment for conference access.*
    links:
      - text: "Donate to the Consortium →"
        url: "/donate/"
        class: "btn-primary shadow-sm"
{{< /cards >}}

## Registration and Format

We offer two ways to experience PQC Amsterdam 2026. Register early, as our in-person capacity is strictly capped to the venue limits.

{{< cards >}}
card_style: bento
cards:
  - color: bento-blue-pale
    image: "photos/ANN05834.jpg"
    icon: users
    title: "In-Person (Amsterdam)"
    text: |
      Join us at the Meervaart. **For three days, the entire venue is ours.**
      
      - **Full 3-day venue access**
      - **7 capped breakout rooms** for off-the-record discussions
      - Direct, 1:1 networking sessions with regulators and peers
      - Catered lunches, coffee, and networking drinks
      - *Registration is Free. Seats are strictly limited.*
    links:
      - text: "Reserve In-Person Seat →"
        url: "register/"
        class: "btn-primary shadow-sm"
  - color: bento-blue-pale
    image: "photos/AME_0009.jpg"
    icon: globe
    title: "Virtual / On-Demand"
    text: |
      Can't make it to Amsterdam? Follow the transition globally.
      
      - **Live global livestreams** of Plenary and Technical tracks
      - Participate in real-time chat and Q&A
      - Post-event access to all recorded main-stage sessions
      - Download shared presentation decks and resources
      - *Registration is Free. Global access.*
    links:
      - text: "Register for Virtual Access →"
        url: "register/"
        class: "btn-outline-primary"
{{< /cards >}}

## Supported By

{{< sponsors-level sponsoring="Post-Quantum Cryptography Conference Amsterdam 2026" level="all" >}}

## Programme & Speakers

We don't select speakers based on marketing budgets. We select based on **depth of implementation experience**. You will hear directly from national cybersecurity agencies, NIST/ETSI members, enterprise architects running hybrid setups, and cloud security teams.

{{< cards >}}
card_style: bento
cards:
  - color: bento-teal-pale
    icon: calendar
    title: "The Agenda"
    text: "Our three-day agenda follows a deliberate arc: framing keynote → parallel workshops → synthesis panel. Session titles and confirmed speakers are updated progressively as the programme is finalised."
    links:
      - text: "View the full agenda →"
        url: "/events/2026/pqc-conference-amsterdam-nl/agenda/"
        class: "btn-primary shadow-sm"
  - color: bento-orange-pale
    icon: mic
    title: "Call for Proposals (CFP)"
    text: "Share practical migration experience, implementation lessons, and real-world outcomes. Early submissions have a significantly higher chance of selection. All accepted speakers are subject to our strict **Zero Product Promotion Guarantee**—ensuring authentic insights, not sales pitches."
    links:
      - text: "Submit your proposal →"
        url: "/events/2026/pqc-conference-amsterdam-nl/propose/"
        class: "btn-outline-primary"
{{< /cards >}}
