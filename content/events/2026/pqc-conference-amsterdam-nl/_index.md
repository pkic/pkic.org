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
# TODO: Resolve the og-card<>event-overlays random display conflict 
#  - event-overlays
#  - event-session
#  - event-speakers
#  - event-speakers2
#  - event-agenda

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
  location: Amsterdam, The Netherlands
  attendanceMode: https://schema.org/MixedEventAttendanceMode
  registrationUrl: register/
  participationUrl: propose/
  sponsorshipUrl: sponsors/

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
  # This list is fed by the CFP/proposal system (PKI Consortium admin API).
  # - Sessions from a solo self-submitted proposal are published as soon as the
  #   proposal is formally accepted (submitting *is* the acceptance).
  # - Panel/co-speaker slots added by someone else (a moderator or organizer)
  #   stay commented out until that individual's status flips to "confirmed".
  #   Uploaded headshots always take precedence over any local file of the same
  #   name — replace speakers/<slug>.jpg when a newer one is available upstream.
  speakers:
    - name: Paul van Brouwershaven
      title: Chair PKI Consortium and CEO of Digitorus
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

    - name: Sven Rajala
      title: Vice Chair, PQC Working Group, PKI Consortium and International PKI Man of Mystery, Keyfactor
      bio: |
        Sven is an award-winning cybersecurity consultant with over 18 years of experience in PKI, automation of PKI and signing solutions, and containerized deployments, currently International PKI Man of Mystery at Keyfactor. His career has spanned both the private sector and federal government, helping organizations design, modernize, and secure their digital trust infrastructure. Recognized for his subject matter expertise in PKI and DevSecOps, he serves as Vice Chair of the PKI Consortium's Post-Quantum Cryptography (PQC) Working Group and hosts The Key Master series by Keyfactor on the Keyfactor Developers YouTube channel.
      social:
        linkedin: https://www.linkedin.com/in/international-pki-man-of-mystery/
        github: https://github.com/svenska-primekey

    # --- Accepted CFP speakers (confirmed) --------------------------------------

    - name: Dustin Moody
      title: Mathematician, NIST
      bio: |
        Dr. Dustin Moody is a mathematician in the Computer Security Division of the National Institute of Standards and Technology. Dr. Moody leads the Post-Quantum Cryptography project at NIST. He received his Ph.D. from the University of Washington in 2009. His area of research deals with elliptic curves, and their applications in cryptography.

    - name: Michael Osborne
      title: CTO IBM Quantum Safe
      bio: |
        Michael Osborne is an IBM Distinguished Engineer and the global CTO for IBM Quantum Safe. He leads the cryptographic research activities at the IBM Research Center in Rüschlikon, Switzerland. His current focus includes advancing new generations of advanced cryptography, such as those selected by NIST as the next generation of PQC algorithms. He also leads the development of methods and technologies to help organizations migrate to use new Quantum-Safe standards.

    - name: Tomas Gustavsson
      title: Chief PKI Officer, Keyfactor
      bio: |
        Tomas Gustavsson is the chief public key infrastructure (PKI) officer at Keyfactor. He pioneered open-source public key infrastructure with EJBCA, now embraced by thousands of organizations. With a background in computer science, Tomas established EJBCA to fortify trusted digital identities globally. He advocates for cybersecurity through innovation, collaboration, and open-source principles.

    - name: Mike Ounsworth
      title: Open source maintainer, Bouncy Castle / OpenSSL
      bio: |
        Mike Ounsworth is a software security architect, cryptographer, and cryptographic protocol designer. He is deeply involved in the Post-Quantum transition, particularly in re-designing IETF networking protocols to accommodate the new PQC algorithms, dual-algorithm hybrids, and mechanisms to ease migration barriers. Mike is the founder of Cryptic Forest Software, Adjunct Professor at the Pôle d'expertises en cybersécurité (Cybersecurity Expertise Centre) at the université de Sherbrooke, and lead maintainer of the Bouncy Castle Rust cryptographic library.
      social:
        github: https://github.com/ounsworth

    - name: Abdel Fane
      title: Co-Founder, CryptoServe
      bio: |
        Abdel Fane is co-founder of CryptoServe and co-creator of QRAMM, the Quantum Readiness Assurance Maturity Model, presented at DEF CON 2025. He led the cross-ecosystem cryptographic census of 2.8 million packages presented in this session, building the scanning methodology and 357-library classification catalog from the ground up. He has 20 years of security experience across healthcare, financial services, and government, including engagements with Booz Allen Hamilton, Protiviti, Allstate, and the U.S. Department of Veterans Affairs. He holds a Master's in Cyber Forensics and Security, and is Executive Director of CyberSecurity NonProfit, a 501(c)(3) with 13,000+ members across 16 global chapters.
      social:
        github: https://github.com/thebenignhacker

    - name: Marin Ivezic
      title: Founder and CEO, Applied Quantum
      bio: |
        Marin Ivezic has spent three decades leading national and large-enterprise IT/OT transformation programs of up to $500M, including turnarounds of failing ones. A former quantum entrepreneur, he has served as a Fortune Global 500 CISO and CTO and led global and regional cybersecurity practices at Accenture, IBM, and Big 4 firms. He is now founder and CEO of Applied Quantum, advising governments and enterprises on post-quantum migration, and writes the personal blog PostQuantum.com, which draws more than a million unique visitors a month.

    - name: Louise Davey
      title: President, LDIQ
      bio: |
        Louise Davey is a Business Transformation Architect and Leader specializing in organizational readiness for emerging technologies. She helps large institutions develop new operational capabilities, protect against systemic risk, and strengthen data and technology governance. With 30+ years of executive and advisory experience in large, complex organizations, Louise translates advanced technological concepts (data, cybersecurity, AI, quantum) into measurable business outcomes, resilience, and agility. A former CTO and COO, an active board member and advisor, with an M.Sc. in Physics from McGill, she bridges two worlds: engaging deeply with scientists and engineers on technical concepts, and translating urgency into strategic implications and actions for CEOs, boards, and regulators. She is the author of "Quantum How: What every board member and executive needs to know to lead in the quantum era" and a member of the PKI Consortium.
      website: https://ldiq.ca/
      social:
        linkedin: https://www.linkedin.com/in/louisedavey/

    - name: Daniel Apon
      title: Director of Cryptography, Anduril Industries
      bio: |
        Daniel Apon is the Director of Cryptography at Anduril Industries. He previously was a Lead Cryptographer at the MITRE Corporation, working on advancing the broader industry's efforts in Post-Quantum Cryptography migration. Prior to that, he was a Cryptographer on the NIST PQC team during its PQC standardization process, where he was the NIST subject matter expert in lattice-based cryptography.

    - name: Fred Roos
      title: Security Architect, ING
      bio: |
        Fred Roos is a Security Architect in the Global CISO team of ING. For more than 20 years he has been closely involved with PKI, key management, and applied cryptography within ING, combining operational excellence and ongoing developments with strategic approaches and a focus on improving ING's security posture and compliance.
      social:
        linkedin: https://www.linkedin.com/in/fred-roos-8978488/

    - name: Lory Thorpe
      title: Quantum Safe Strategy Advisor, IBM
      bio: |
        Lory Thorpe is an executive technology leader and board advisor with more than 20 years of experience shaping the strategy, commercialization, and adoption of emerging technologies across global industries. Her expertise spans advanced connectivity and communication, quantum readiness, cybersecurity, and deep tech. As a Senior Strategy Advisor within IBM, Lory leads the Quantum Safe agenda for industries, helping organizations prepare for the risks and opportunities of the quantum era. She is the Chair of the GSMA Post Quantum Telco Network Task Force, the first global telecom industry forum dedicated to post-quantum cryptography adoption.

    - name: Rieck Manfred
      title: Head of Quantum Tech / Co-Founder, Deutsche Bahn / Federal Quantum Alliance
      bio: |
        Manfred Rieck is Co-founder of the German Federal Quantum Alliance, a partnership of government-owned organizations and federal authorities including Deutsche Bahn/DB Systel, Bundesdruckerei, the Federal Office for Information Security (BSI), the German Federal Intelligence Service (BND), the Federal Employment Agency (BA), the German pension insurance, and BWI, the IT service provider for the German Armed Forces. The group focuses on the progress of quantum computing, quantum sensing, and quantum cybersecurity (PQC, QKD), acting as a think tank for the German government and supporting the structured introduction of PQC in government and industry. Manfred has worked in IT departments for more than 20 years in senior management positions at Deutsche Bahn, IBM, and BASF.

    - name: Olivier Couillard
      title: Technical Product Manager, Crypto4A Technologies Inc.
      bio: |
        Olivier joined Crypto4A eight years ago and has since contributed to nearly every facet of the HSM platform. His work spans from RNG design and entropy assessment to firmware development, key management applications, and even web UI implementation. In addition to his technical expertise, Olivier has collaborated with a wide range of customers and has been actively involved in the FIPS 140-2 and 140-3 certification processes.

    - name: Dmitry Belyavskiy
      title: Principal Software Engineer, Red Hat
      bio: |
        Dmitry has worked with OpenSSL code for 20+ years, the last 5+ of them at Red Hat, where he serves as an OpenSSL maintainer and OpenSSH co-maintainer. He is involved in the OpenSSL community as a distribution community representative on the OpenSSL Corporation Technical Advisory Committee.
      social:
        linkedin: https://www.linkedin.com/in/dmitry-belyavskiy-34b45494/
        github: https://github.com/beldmit

    - name: Roman Cinkais
      title: SVP Enterprise Products, OmniTrust
      bio: |
        Roman holds a master's degree in Mathematical Methods of Information Security from Charles University in Prague. He has over 15 years of professional experience in information security across financial, retail, banking, telco, and postal industries. Roman is a co-founder of 3Key Company — now OmniTrust Security following its 2026 merger with ISS — where he serves as SVP Enterprise Products. In 2021 he founded the open-source project originally named CZERTAINLY, today known as ILM, a cloud-native trust lifecycle management platform. Roman chairs the PKI Maturity Model Working Group at the PKI Consortium, where he leads work on the PKIMM Extension Framework.
      social:
        linkedin: https://www.linkedin.com/in/roman-cinkais/

    - name: Kennedy Nwup
      title: Principal Consultant, Afield AB
      bio: |
        Kennedy Nwup is Vice Chair of the PKI Consortium's PKI Maturity Model Working Group and author of the PQC Readiness Extension for PKI, the first published extension to the PKI Maturity Model Extension Framework.

    - name: Thalia Laing
      title: Principal Cryptographer and Security Researcher, HP Security Lab
      bio: |
        Thalia Laing is a Principal Cryptographer and Security Researcher in HP Security Lab, where her work focuses on applying cryptography to security-critical systems and the migration of products to quantum-resistant cryptography. She has played a leading role in the design and deployment of quantum-resistant firmware integrity protections for commercial endpoint devices. Thalia holds a PhD in Cryptography from the Information Security Group at Royal Holloway, University of London.

    - name: Antonio Javier Cabrera Gutierrez
      title: Staff System Architect, Infineon Technologies AG
      bio: |
        Antonio Javier Cabrera Gutierrez received his B.Eng. and M.Eng. degrees in Computer Engineering from the University of Granada, Spain, and joined Infineon Technologies AG in Neubiberg, Germany, in 2019 as a Ph.D. candidate in collaboration with the University of Granada, researching secure and reliable communication protocols in Industrial IoT networks. Since earning his Ph.D. in 2023, he has worked as a Security Architect for the TPM in the Edge Systems division, where he drives product requirements and innovations in collaboration with customers and standardization bodies, including the Trusted Computing Group (TCG). In TCG, he chairs the Internet of Things Work Group, extending TCG security standards and technologies into resource-constrained embedded devices.
      social:
        linkedin: https://www.linkedin.com/in/antoniojaviercabreragutierrez/

    - name: Rumen Doynov
      title: Assistant Professor, Technical University of Sofia
      bio: |
        Rumen is an engineer and researcher working at the intersection of mechatronics, telecommunications, and next-generation cybersecurity, focused on bridging emerging cryptographic standards and their practical application in Industrial IoT (IIoT) and industrial communication systems. He is currently engaged in applied work on Post-Quantum Cryptography, centered on the real-world deployment of PQC within complex network architectures, including hybrid TLS 1.3 and end-to-end post-quantum mutual authentication frameworks.
      social:
        linkedin: https://www.linkedin.com/in/rumen-doynov-2041851b3/

    - name: Alexander Shestakov
      title: Researcher, Technical University of Sofia
      bio: |
        Alexander is a software and infrastructure engineer focused on building secure architectures and adapting networks for post-quantum standards. He recently graduated from a specialized technical high school in Bulgaria with a professional degree in System Programming, and continues his engineering studies at the Technical University of Sofia (Faculty of Telecommunications).
      social:
        linkedin: https://www.linkedin.com/in/shestakov-dev
        github: https://github.com/shestakov-dev

    - name: Akane Suzuki
      title: Chief Researcher, Hitachi, Ltd.
      bio: |
        Akane Suzuki is a Chief Researcher at Hitachi, Ltd., specializing in information security, electronic authentication, and digital identity. Leveraging hands-on experience in cryptographic migration for public key infrastructure during Japan's "2010 Cryptographic Algorithm Transition," Suzuki currently focuses on analyzing post-quantum cryptography (PQC) trends and designing migration approaches, and contributed to the CRYPTREC external evaluation report in FY2025, "Survey on Technical Trends in the Migration to Post Quantum Cryptography."

    - name: Jaime Gómez García
      id: jaime-gomez-garcia
      title: Global Head of Cryptography and Quantum Threat Program, Santander Digital Services
      bio: |
        Jaime Gómez García is a recognized expert in quantum security, with an extensive professional background in the financial sector. He is known for advancing strategic awareness, industry coordination, and practical adoption of quantum-safe cryptography, helping organizations and critical infrastructures prepare for the transition to the quantum era. His influence has been recognized through multiple distinctions, including inclusion in Quantum Security 25: The Top 25 Most Influential People in Quantum Security (2026), the 2025 Quantum Leap Award from Keyfactor, and recognition as LinkedIn Top Voice (2024-2025) and Quantum Top Voices (2022-2024). Jaime serves as the Global Head of the Santander Quantum Threat Program and Chair of the Europol Quantum Safe Financial Forum.

    - name: Antti Ropponen
      title: Executive Partner, Quantum Safe Transformation Services, IBM

    - name: Zygmunt Lozinski
      title: Quantum Safe Networks, IBM
      bio: |
        Zygmunt's mission is to make the world's networks quantum safe. His research is on quantum risk in telecommunications, critical infrastructure, and national security. Zygmunt is one of the co-founders of the GSMA Post Quantum Telco Network Task Force and editor for its publications, and he works with governments on national PQC guidance. He has extensive experience in telecommunications, network cloud / NFV, edge computing, orchestration, and 5G security.

    - name: Sarah McCarthy
      title: SVP Cryptography, Citi

    - name: Sudha Iyer
      title: Chief Engineer - PKI & Cryptography, Citi
      bio: |
        Sudha Iyer is Chief Engineer - PKI & Cryptography at Citi, an international expert and project leader for ISO smart contract security, a member of the ASC X9 Board of Directors, lead of the QSFF Prioritization stream, and a founding member of the FS-ISAC PQC Working Group.

    - name: Michele Mosca
      title: CEO, evolutionQ Inc.
      bio: |
        Michele Mosca is a co-founder and CEO of evolutionQ and a Professor of Mathematics at the University of Waterloo. He is widely recognized as a pioneer in quantum computing and a leading voice on the cybersecurity implications of quantum technologies. He is a co-founder of the Institute for Quantum Computing and a founding member of the Perimeter Institute for Theoretical Physics, and has helped lead international initiatives in quantum-safe security including the Open Quantum Safe project and the ETSI-IQC Quantum-Safe Cryptography Conference. He holds a doctorate in quantum computer algorithms from the University of Oxford.
      social:
        linkedin: https://www.linkedin.com/in/dr-mosca/

    - name: Bruno Couillard
      title: CEO & Co-Founder, Crypto4A
      bio: |
        Bruno Couillard is the Co-Founder and CEO of Crypto4A, a leader in quantum-safe cybersecurity and trusted cryptographic infrastructure. He works at the intersection of advanced cryptography, digital trust, and secure infrastructure modernization, helping organizations prepare for the transition to the post-quantum era.

    - name: Ted Shorter
      title: Chief Technology Officer, Keyfactor
      bio: |
        Ted Shorter is Chief Technology Officer at Keyfactor. Ted has worked in the security arena for over 24 years, in the fields of cryptography, application security, public key infrastructure, and software vulnerability analysis, including 10 years with the U.S. Department of Defense.

    - name: Evgeny Gervis
      title: CEO, SafeLogic
      bio: |
        Evgeny has two decades of experience in the cybersecurity field, spanning startups to large Fortune 500 organizations. Prior to joining SafeLogic, Evgeny spent 15 years at Cigital and then, post-acquisition, at Synopsys, responsible for the firm's software security solutions practice in the broader Mid-Atlantic region.

    # --- Invited but not yet confirmed — keep commented out until status flips to "confirmed" ---
    # - name: Philip Intallura
    #   title: Group Head of Quantum Technologies, HSBC
    #   bio: |
    #     Dr. Philip Intallura is Group Head of Quantum Technologies at HSBC, where he leads the bank's
    #     quantum computing effort and quantum-safe migration programme. He serves as a Quantum Adviser
    #     to the UK Government on the DSIT Quantum Strategic Advisory Board, and is a regular voice on
    #     quantum technology in Bloomberg, Reuters, the Wall Street Journal, and Forbes.
    #   # Committee note: the "Scaling Quantum Safe" (HSBC) session was accepted with the intent that
    #   # Intallura is the lead/visible speaker and Antti Ropponen (IBM) supports — confirm before publishing.
    # - name: Christopher Czajczyc
    #   title: Partner, Deloitte
    #   # Status: invited, not yet confirmed for the "Your Suppliers Aren't Ready" panel.

  # Agenda --------------------------------------------------------------------
  # Design rationale:
  # - Psychological rhythm per day: Energize → Focus → Collaborate → Recharge → Apply → Connect → Celebrate.
  # - Both halls in continuous use EXCEPT Blue hall during Day 1 Opening + Keynote (09:00–10:45),
  #   keeping the full audience together for the conference launch.
  # - Day 2 & 3 opens/closes: simultaneously — Paul in Red hall, Albert in Blue hall.
  # - Day 3 final close: Paul + Albert together in Red hall for the conference finale.
  # - Red hall (strategic / policy / leadership track): keynotes, panels, case studies, debates.
  # - Blue hall (technical / implementation track): deep dives, workshops, tooling, architecture.
  # - Breakout hour runs TWICE a day (Rooms A-E), in parallel with whatever the two main
  #   halls are doing at the same time — it doesn't dictate the main halls' slot length.
  # - 30-min breaks (AM and PM) are intentional networking windows; do not shorten them.
  # - Base units: sessions = 30 min (25 content + 5 changeover). Panels = 45 min (40 + 5),
  #   except one 60-min "deep" panel each morning (55 + 5). Lunch = 90 min (800 attendees).
  # - The day ends on real content (the PM panel), not a break followed by a lone session.
  # - Day 2 (Wednesday) trials asynchronous hall formats: the AM panel window runs a single
  #   60-min panel in the red hall while the blue hall runs four 15-min lightning talks in
  #   the same window instead. A session can set its own `durationMinutes` to span multiple
  #   of the finer-grained rows this requires (see the red hall entry at 10:45 below); the
  #   other hall's rows just use their own normal duration. `noTransition: true` on a row
  #   means it and the next row are back-to-back with no changeover gap (used here for the
  #   lightning round, and elsewhere for opening/closing pairs).
  #
  # Placement pass (this revision) cross-references the PKI Consortium CFP system directly:
  # only proposals with decision_status = accepted are placed as real sessions below; every
  # other slot stays "To be announced" (22 accepted so far — the rest are still under review).
  # Hall assignment follows the proposal's declared track: Strategy and Roadmaps / Policy and
  # Standards → red (plenary) hall; Technical Deep Dive → blue hall; Deployments and Lessons
  # Learned → whichever hall matches the audience of the talk. Day arcs:
  #   Day 1 — threat framing, standards landing, where adoption actually stands, and the
  #           board/governance close (Davey) so the strategic hall ends on a strong note.
  #   Day 2 — deployment reality: supply chain, hardware roots of trust, real migrations
  #           (Anduril, LMS at scale), breakouts, and the program-scale close (Ivezic).
  #   Day 3 — sector coordination (financial), global regulation, architecture for the long
  #           run (Osborne, Mosca), and the NCCoE collaboration panel as the finale.
  # Balancing rules applied: key speakers are spread across all three days; no speaker
  # presents twice on the same day or in two rooms at once; competing topics are not run
  # head-to-head (e.g. the two "hybrid" talks are on different days, the hardware talks are
  # separated); each day ends on real content in both halls, and Day 3 keeps strong draws
  # (Osborne, HSBC, Mosca, NCCoE panel) to retain attendees. Committee notes honoured:
  #   - Cinkais/Nwup (PKIMM Extension Framework) accepted specifically "as a breakout session".
  #   - O. Couillard (quantum-safe audit log) accepted for a breakout room.
  #   - NCCoE "Collaborative Efforts" panel must stay on Day 3 due to speaker availability.
  #     William Newhouse withdrew (scheduling conflict); a new moderator is being sought.
  #   - HSBC session (Ropponen + Intallura) and Davey's "Board Factor" stay in the strategic
  #     hall per committee instruction (board-level stories).
  #   - Lozinski's regulation tutorial runs in the long single-room roundtable block pending
  #     the committee's panel-vs-roundtable decision.
  #   - Cabrera Gutierrez (TPMs) was asked to cover the hardware refresh cycle; the title may
  #     still be shortened with the speaker.
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

      - time: "10:45"
        sessions:
          - title: "A Quantum Leap: The NIST PQC Standardization Project"
            description: |
              The impending arrival of cryptographically relevant quantum computers poses a transformative threat to current public-key infrastructure, necessitating an urgent transition to post-quantum cryptography (PQC). This talk provides a comprehensive update on the National Institute of Standards and Technology PQC Standardization Project, following the landmark finalization of the first three NIST PQC Standards—FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), and FIPS 205 (SLH-DSA). It also covers the ongoing standardization work of Falcon and HQC. We discuss the technical foundations of these algorithms, the ongoing work to standardize additional signature schemes to diversify the portfolio, and future directions. Crucially, the talk addresses some of the practicalities of migration discussed in NISTIR 8547, in light of the recent Executive Order on "Securing the Nation Against Advanced Cryptographic Attacks," which establishes ambitious deadlines for federal agencies and critical infrastructure.
            speakers:
              - Dustin Moody
            locations:
              - plenary

          - title: "PQC PKI: The Good, the Broken, and the Hybrid"
            description: |
              2025 was a year full of preparations for deploying PQC in practice. Standards, software libraries, HSMs, a lot of everything was updated to support PQC algorithms.
              PQC 2026 started with a lot of PQC capable components and a statement like, "It's OK to have not acted YET. 2026 will be the last time this can be said". At the end of 2025 and the beginning of 2026 was also the time for great confusion. As organizations started to ponder on the next practical steps, they had to make decisions on what algorithms to use, hybrid solutions or not, and in the case of hybrids what type of hybrid PKI. Have companies deployed PQC in production by now? The answer is yes, production deployment have started. Decisions have been made and some earlier thoughts had to be dismissed. This presentation will highlight PQC PKI choices and hierarchies based on some real world decisions.
              Architecture, algorithms, and combinations. What has been chosen and why. And maybe even more interesting, what didn't work and why? The presenters do not claim to have seen all PQC PKI deployments of 2026, but we have seen a few, and this is real world experience from those.
            speakers:
              - Tomas Gustavsson
              - Sven Rajala
            locations:
              - blue_hall

          - title: "Roundtable (topic to be announced)"
            description: |
              A smaller, single-room roundtable — capped at ~30 participants,
              running longer than the standard breakout format to allow for a
              deeper, off-the-record conversation.
            track: Roundtable
            durationMinutes: 105
            locations:
              - room_a

      - time: "11:45"
        sessions:
          - title: "Where the PQC Migration Actually Stands: A Cross-Ecosystem Census of 2.8 Million Packages"
            description: |
              The NIST 2030 deprecation deadline for quantum-vulnerable public-key algorithms is 1,386 days away as of March 2026. Every PKI operator, certificate authority, and security team needs to know how the software supply chain they depend on is responding. No cross-ecosystem measurement existed. We built one. This session presents findings from the first cross-ecosystem cryptographic census, scanning 2,809,479 packages across 11 package ecosystems including npm, PyPI, Go, Maven, crates.io, NuGet, and others. The results reveal the actual state of PQC adoption in the open-source supply chain that PKI infrastructure depends on. Of the 2.8 million packages scanned, 108,145 use cryptographic libraries. Among those, 21,332 depend on weak or deprecated algorithms such as MD5, SHA-1, DES, and RC4. Only 188 packages, or 0.17 percent of crypto-using packages, have any post-quantum cryptography dependency. PQC adoption is concentrated in 5 of 11 ecosystems, with crates.io accounting for 58 percent of all PQC-dependent packages. Six ecosystems show zero PQC adoption. Maven has the worst weak crypto rate at 51.6 percent.
              Beyond the headline numbers, the talk addresses the migration gap that matters most for PKI operators. Dependency-level scanning, the foundation of most software composition analysis tools, misses approximately 4 times the cryptographic surface area visible to source-level analysis. We validated this gap on 20 production projects and found that 30 percent of projects with active cryptographic code show zero dependency-level signal. For PKI operators conducting cryptographic inventories under NIST IR 8547 or OMB M-23-02, this means current tooling systematically undercounts exposure.
              Attendees leave with three actionable outcomes: the current state of PQC adoption in their language ecosystem with named libraries and migration paths; a reproducible census methodology they can apply to internal package registries and vendor assessments; and a clear understanding of why dependency scanning alone fails for cryptographic inventory and what to do about it.
              All scanning tools, the 357-library classification catalog, the full scan dataset, and a live dashboard are released open source.
            speakers:
              - Abdel Fane
            locations:
              - plenary

          - title: "Making ML-DSA Work for Machine-to-Machine mTLS: Field Notes from an End-to-End Post-Quantum PKI"
            description: |
              Most post-quantum migration programs have done the easy part - hybrid key exchange - and then hit a wall at authentication. Getting ML-DSA certificates working for real machine-to-machine identity, with a PKI that can issue, renew, and revoke them, is where timelines slip: the certificates are large, lifecycle tooling is immature, and almost no one has run mutual TLS where both sides authenticate with post-quantum credentials.
              This is a practitioner field report from an organization that has built and now operates exactly that - an end-to-end post-quantum machine-identity stack: an ML-DSA-65 CA hierarchy, post-quantum-only mutual TLS enforced at the edge, automated enrollment and short-lived issuance, and OCSP/CRL revocation that takes effect in real time. We share what it actually took, so teams planning the authentication phase of their own migration know what they are walking into.
              Attendees leave with: a realistic picture of the authentication half of PQC migration - what is production-ready today and what is still blocked on standards (IETF LAMPS composite certificates, post-quantum identity tokens); where ML-DSA certificate and signature sizes actually cause problems - handshake payloads, buffers, issuance throughput - measured against classical TLS 1.3; how to tell a genuinely post-quantum-only deployment from a post-quantum key exchange sitting in front of classical certificates, and how to verify it; a certificate-lifecycle model for machine identity - constrained enrollment, automated issuance, real-time revocation - and the operational decisions that matter; and a practical set of questions to put to your CAs, HSM vendors, and platform teams before committing to an approach.
              The session is for PKI, platform, and security teams responsible for the machine-identity and mTLS portion of their post-quantum migration. It assumes working knowledge of TLS 1.3 and certificate PKI; no prior post-quantum background is required.
            speakers:
              - Rumen Doynov
              - Alexander Shestakov
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
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

      - time: "14:30"
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

      - time: "15:00"
        title: Break

      - time: "15:30"
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

      - time: "16:15"
        sessions:
          - title: "The Board Factor: What Makes PQC Programs Succeed or Stall"
            description: |
              Most PQC programs are structurally set up to fail. Not for lack of standards or technology, but because the complexity of organizational systems is beyond what their programs are designed to control.
              Post-quantum cryptography migration is more than a technology upgrade. It is a multi-year enterprise transformation that cuts across business lines, processes, vendors, data, contracts, procurement, risk appetite, funding, operating models, and executive accountability. These are not technology variables. Yet many organizations are still treating it as a technical remediation exercise. That is a mistake.
              Digital trust is a critical business asset. And the cryptographic infrastructure that supports it is a highly distributed, deeply embedded, complex digital estate with dependencies that span every system, every process, and every layer of the technology stack. In this way, parallels can be made to data governance: fifteen years of CDO mandate cycles rife with failure, trying to govern something that is everywhere, essential, and owned by no one. PQC has a hard 3 to 7-year deadline. We simply cannot afford to make the same mistakes. This is not only a cryptography problem. It is a complex systems problem.
              PQC programs face nearly every structural condition that predicts failure: a long-time horizon, ambiguous impact timing, no single natural owner, deep technical complexity, unclear business prioritization, complex and unmapped dependencies, limited cryptographic literacy, budget uncertainty, and a strategic portfolio process that favours near-term value creation over invisible long-term risk reduction. Add to this a fundamental accountability problem: the executive leaders responsible for taking action today may not be the same as those who face the consequences tomorrow. The usual forcing functions for urgency, ownership, and escalation are weak. In the absence of authoritative action, the cryptographic estate is heading for the same governance failure mode we saw with enterprise data: granular, everywhere, essential, owned by no one, and left in the hands of IT.
              Ashby's Law for complex systems is clear: a system will defeat any controller that underestimates its complexity. Operational budgets, decision rights, and risk acceptance are distributed throughout the system; only the board holds authority over all three.
              The session opens with two questions put directly to attendees: (1) why will your PQC program succeed when so many enterprise-scale programs fail, and (2) who is accountable for its success (or failure)? Participants respond in writing. Many will struggle, exposing the real issue: not whether PQC matters, but whether organizations understand the conditions required to succeed, and who should be held accountable if they don't.
              Drawing on systems theory principles and over 30 years designing, delivering, and remediating large-scale transformations and operating models, this session examines why PQC migration is structurally harder than most organizations currently understand. It shows why cryptographic inventory, technical standards, vendor readiness, and migration planning are necessary but insufficient, and why board engagement is the single most determining factor in a program's success. The session closes by returning to the same two questions, this time providing concrete, practice-tested moves to establish who is ultimately accountable for PQC program success and to secure the board engagement needed to make sure yours does.
              The issues that will stall many PQC programs are visible and navigable. Can you engage your board effectively to overcome them?
            speakers:
              - Louise Davey
            locations:
              - plenary

          - title: "Gaming the Speed-vs-Memory Tradeoff for ML-DSA and ML-KEM"
            description: |
              FIPS is only a suggestion, sortof. Specifically, FIPS only requires "mathematical equivalence" to the listed algorithms, and that gives a surprisingly wide latitude for implementations to play algorithmic games in search of either fast or small implementations.
              This talk will explore speed-vs-memory tradeoff techniques applicable to the ML-DSA and ML-KEM algorithms and the results that they obtain within the Bouncy Castle Rust library. We start with a close look at the "default" implementation, then at what you can do to move around the High Speed <--> Low Memory spectrum. In one direction, you can pre-expand intermediate values at key-load time for faster sign, verify, encaps and decaps operations which gives performance increases in the 40% - 60% range (especially valuable if doing multiple operations against the same key). In the other direction, your in-memory private key representation can consist of only intermediate seed values and you can re-derive the active lattice values one entry at a time as they are needed; you pay a penalty for deriving the same intermediate values multiple times for a dramatic reduction in memory footprint. This technique has a particularly pronounced effect on ML-DSA where ML-DSA-87.sign() can be performed in under 30 kb of peak memory usage, which represents roughly a 7.5x decrease in memory usage in exchange for a 6x increase in runtime; which is a win on heavily-loaded servers where parallelism is gated by RAM not by CPU.
            speakers:
              - Mike Ounsworth
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
            durationMinutes: 5
            speakers:
              - Albert de Ruiter
            locations:
              - plenary

          - title: "Welcome back — Day 2"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            durationMinutes: 5
            speakers:
              - Sven Rajala
            locations:
              - blue_hall

      - time: "09:05"
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

      - time: "09:35"
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

      - time: "10:15"
        title: Break

      - time: "10:45"
        noTransition: true
        sessions:
          - title: "Your Suppliers Aren't Ready: PQC Supply Chain Readiness"
            description: |
              You have mapped your internal cryptographic assets, you have a migration plan, and you know which algorithms you are moving to. Then you open a ticket with your HSM vendor, your cloud key management provider, your identity platform, your network appliance manufacturer — and the answers range from vague to contradictory to silent. Your suppliers are the gap between your migration plan and your migration reality.
              The challenge is not limited to hardware security modules. Every product and service that uses cryptography — software libraries, CAs, signing services, authentication platforms, enterprise SaaS, embedded firmware — is a dependency in your PQC migration. And most of them are somewhere between Level 0 (nothing implemented) and Level 2 (production-ready but no inventory, no agility, no roadmap transparency). This session opens with a ten-minute introduction to how the PKI Consortium's PQC Maturity Model (PQCMM) works in practice, then the panel takes over: what does it actually look like to mandate PQC supplier requirements at a large institution, what do assessors find when they start evaluating products against a structured framework, and what would accelerate adoption of a common standard across the supplier ecosystem.
              Attendees leave with a practical starting point: how to introduce the PQCMM into procurement for high-priority suppliers today, what to put in contracts, and how to handle the inevitable exceptions.
            track: Panel discussion
            durationMinutes: 60
            speakers:
              - Paul van Brouwershaven
              - Fred Roos
              - Rieck Manfred
              - Lory Thorpe
              # - Christopher Czajczyc (Deloitte) — invited, not yet confirmed
            locations:
              - plenary

          - title: "Lightning talk 1"
            description: |
              Speaker and topic to be announced.
            track: Lightning talk
            locations:
              - blue_hall

          - title: "Roundtable (topic to be announced)"
            description: |
              A smaller, single-room roundtable — capped at ~30 participants,
              running longer than the standard breakout format to allow for a
              deeper, off-the-record conversation.
            track: Roundtable
            durationMinutes: 105
            locations:
              - room_a

      - time: "11:00"
        noTransition: true
        sessions:
          - title: "Lightning talk 2"
            description: |
              Speaker and topic to be announced.
            track: Lightning talk
            locations:
              - blue_hall

      - time: "11:15"
        noTransition: true
        sessions:
          - title: "Lightning talk 3"
            description: |
              Speaker and topic to be announced.
            track: Lightning talk
            locations:
              - blue_hall

      - time: "11:30"
        noTransition: true
        sessions:
          - title: "Lightning talk 4"
            description: |
              Speaker and topic to be announced.
            track: Lightning talk
            locations:
              - blue_hall

      - time: "11:45"
        sessions:
          - title: "Post-Quantum Migration at Anduril"
            description: |
              Anduril's post-quantum cryptography (PQC) migration is well underway. Our particular focus is on the most constrained, most possibly complicated signals environments in which to establish secure, modern communications infrastructure. In this talk, I survey the technical roadmap of Anduril Industries from no-PQC to full-PQC, with special emphasis on DDIL (Denied, Disrupted, Intermittent, and Limited) communication scenarios. This talk discusses organizational challenges, engineering roadblocks (and successes), ranging from early planning and implementation, to simulation testing, live field testing, and deployment roll-out. A special emphasis is on interoperability of protocols and cryptographic primitives, and how to effectively handle various international regulation jurisdictions, as well as a call for further, future collaboration in this space, especially on common standards across various standardization bodies.
            speakers:
              - Daniel Apon
            locations:
              - plenary

          - title: "Lessons Learned from Deploying LMS at Scale"
            description: |
              Stateful hash-based signatures such as LMS are standardised and well understood, but translating them into deployable products involves challenges that are often absent from standards and academic literature.
              This talk discusses the practical realities of deploying a stateful hash-based scheme in long-lived hardware-rooted systems. Drawing on experience securing firmware update mechanisms in commercial PCs and printers, it explores how standards guidance, hardware lifecycles, resilience requirements, certification considerations and business constraints influenced key design decisions.
              It covers lessons from adopting the LMS standard into security features deployed at scale, including the challenges of balancing security, resilience, certification and operational requirements, and reflects on how later developments in standards, certification programmes and industry guidance reinforced, challenged or reshaped those decisions — and what this means for future quantum-resistant migrations.
            speakers:
              - Thalia Laing
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
        sessions:
          - title: "PQC Starts at the Root of Trust: The Role of TPMs in Protecting Next-Generation Device Identities"
            description: |
              As organizations prepare for the transition to post-quantum cryptography, much of the conversation focuses on algorithms, certificates, and PKI infrastructure. Yet the success of any migration ultimately depends on where cryptographic keys are generated, stored, and protected. For billions of enterprise and IoT devices, that foundation is the Trusted Platform Module (TPM).
              This session explores the role of TPMs as the hardware root of trust enabling post-quantum migration for device identities and machine credentials. From certificate enrollment and key attestation to secure storage and cryptographic agility, TPMs provide the security foundation that allows PKI ecosystems to evolve without compromising trust.
              We will examine the practical challenges PKI teams face when introducing post-quantum algorithms into existing deployments — including the hardware refresh cycle — and describe how TPM capabilities can support the transition while maintaining compatibility with existing enterprise and IoT infrastructures.
              Attendees will gain a clearer understanding of how hardware-backed key protection intersects with PQC deployment, why device identity should be part of every migration roadmap, and what steps organizations can take today to prepare for a quantum-resilient future.
            speakers:
              - Antonio Javier Cabrera Gutierrez
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: "Quantum-Safe Audit Log Relying on Attestation Procedures"
            description: |
              Last year, we examined how hardware security modules can provide cryptographic attestation, i.e., a signed snapshot of the state of an HSM and/or of its keys. Trust in cryptographic infrastructure, however, often requires more than a snapshot; it requires proof of history. This presentation introduces cryptographically verifiable audit logs for hardware security modules, a mechanism that produces a tamper-evident, independently verifiable record of every operation performed on a cryptographic object over its lifetime. Where attestation tells you what a key looks like today, an audit log tells you everything that was done to it and when. Key ceremonies require a verifiable sequence of authorized operations that no snapshot can reconstruct; key migration requires a temporary export, so the destination device's attestation cannot prove the process was correct, but the combined audit logs of both devices can. The cryptographic architecture behind this relies on event chaining and attested log state, with tooling that runs entirely outside the HSM so that an auditor can verify the record without device access. For long-term validity, all of this must rest on quantum-safe roots of trust provisioned at manufacturing time.
            speakers:
              - Olivier Couillard
            locations:
              - room_a

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_b

          - title: "Measuring PQC Readiness for PKI: Introducing the PKI Maturity Model Extension Framework and Its First Extension"
            description: |
              Most organisations approaching post-quantum migration share the same blind spot: they have a roadmap, but no honest way to measure where their PKI actually stands. This session introduces two published outputs of the PKI Consortium's PKIMM Working Group: the PKI Maturity Model Extension Framework, and the PQC Readiness Extension for PKI built on top of it.
              The PKI Maturity Model already helps organisations benchmark their PKI programmes against an industry reference structured around four modules and fifteen capability categories. The Extension Framework defines a standardised way to overlay targeted, fast-moving maturity criteria — PQC, automation, cryptographic agility — onto the existing categories, with consistent scoring, weighting, and reporting rules. The PQC Readiness Extension, authored by Kennedy Nwup, is the first published extension, giving PKI owners a defensible answer to questions their CISOs, regulators and auditors are starting to ask.
              In this joint session, Roman Cinkais (Chair, PKIMM WG) and Kennedy Nwup (Vice Chair, PKIMM WG, and author of the extension) walk through the design of the Extension Framework, present the PQC Readiness Extension in detail, show how it is intended to be used in practice, and reflect on turning a working group draft into a published, community-endorsed specification.
              Attendees will leave with a published framework and a PQC Readiness Extension they can apply to their PKI programme straight away.
            speakers:
              - Roman Cinkais
              - Kennedy Nwup
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

      - time: "14:30"
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

      - time: "15:00"
        title: Break

      - time: "15:30"
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

      - time: "16:15"
        sessions:
          - title: "120,000 Tasks: The Cryptography Was the Easy Part"
            description: |
              The integrated master schedule for one large enterprise's post-quantum migration grew past 120,000 discrete tasks. It was not a count of devices, certificates, or applications to upgrade. If it were, 120,000 would be small. The direct remediation work, the actual cutovers across every device and application, accounted for fewer than 30,000 tasks (a million-plus devices, systems, and apps grouped into upgrade batches).
              The remaining 90,000 or so tasks are the enablement system: inventory as a living capability, governance and reporting cadence, vendor lifecycle enforcement, testing and assurance, workforce change, ecosystem and partner alignment, and ongoing operations during the long hybrid period.
              Drawing on that 120,000-task plan (illustrative of complexity, not a universal count) and on three decades running high-stakes delivery programs such as national payments systems and federal health-records platforms, the talk turns to what actually governs whether such a program finishes. It is rarely the cryptography. It is the density of interdependencies: vendors waiting on internal teams, shared infrastructure that must be ready before application waves can move, regulatory deadlines colliding with finite engineering capacity. It is ownership, because cryptography is everyone's problem and therefore no one's, so the program needs a single accountable lead with authority across security, IT, engineering, procurement, and OT. It is workforce capacity, since the trained people a program needs at its peak in years four to eight cannot be conjured on demand. And it is funding that has to survive several budget cycles and more than one CISO. PKI realities sit inside this frame: certificate migration planned as waves rather than a single flag day, and PKI and HSM procurement and certification lead times treated as hard scheduling constraints.
              Attendees leave able to right-size and sequence their own program, separate a credible plan from a wishful timeline, argue for a single accountable owner and the governance to back one, build the board case for multi-year funding, and prioritize by risk so the program delivers measurable security gains in years one to three while the longer effort runs on.
            speakers:
              - Marin Ivezic
            locations:
              - plenary

          - title: "Adding PQ Capabilities to SSH Protocol: The Fedora Approach"
            description: |
              OpenSSH and libssh are 2 mostly widespread implementations of SSH protocol. Real-world requirements for PQ crypto causes writing significant patches to OpenSSH because of difference of the upstream and downstream requirements. libssh upstream is more binded to Fedora maintainers and lands the changes upstream.
              The talk covers key downstream changes in OpenSSH: using OpenSSL code, providing extra algorithms support, FIPS compatibility quirks, in OpenSSH, and corresponding changes in libssh.
            speakers:
              - Dmitry Belyavskiy
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
        sessions:
          - title: Closing (Day 2)
            description: |
              Brief closing remarks and a preview of Day 3.
            speakers:
              - Sven Rajala
            locations:
              - plenary

          - title: Closing (Day 2)
            description: |
              Brief closing remarks for the blue hall audience and a preview of Day 3.
            speakers:
              - Paul van Brouwershaven
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
            durationMinutes: 5
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: "Welcome back — Day 3"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            durationMinutes: 5
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "09:05"
        sessions:
          - title: "Towards Coordinated Quantum Security in the Financial Sector: Risks, Priorities, and a Framework for Market Action"
            description: |
              The transition to quantum security in the financial sector is not only a technological undertaking, but also a coordination challenge for a highly interconnected global ecosystem. Misaligned transition efforts may create operational risks, including interoperability tensions across markets, infrastructures, and jurisdictions, prolonged reliance on quantum-vulnerable cryptography, inefficient duplication of effort, and ecosystem fragmentation.
              To address these risks, the Europol Quantum Safe Financial Forum, in collaboration with FS-ISAC and CFDIR, has proposed an operational framework for coordinated action. The framework focuses on identifying and prioritising critical use cases, structuring the transition through shared implementation waves, and defining three use-case-specific milestones to align sequencing and execution.
              This session examines that prioritisation framework and provides an update on the state of quantum security in the financial sector — relevant not only to financial sector professionals, but to the wider community as an early example of ecosystem-wide coordination and its associated challenges.
            speakers:
              - Jaime Gómez García
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "09:35"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: "Hybrid is a Redistribution of Risk, Not a Removal of It"
            description: |
              The post-quantum migration debate routinely flattens "hybrid versus pure PQC" into a security question — one algorithm or two? — when it is really an operational architecture question about which class of failure your organisation is structured to handle.
              This talk reframes the choice. Hybrid for key exchange is largely settled: deploy it now. Hybrid for authentication is harder, and the costs depend on construction. Composite signatures buy atomicity by binding two algorithms into one credential, but the same atomicity removes component-wise recovery and undoes two decades of hash-agility infrastructure. Parallel approaches deliver dual-algorithm assurance without the binding, fitting how PKI has handled every previous algorithm migration.
              Drawing on a failure-mode analysis across twenty-five operational and cryptographic scenarios, the talk argues that for most enterprise authentication deployments, parallel is the better-fitting hybrid — and the conscious choice rarely defaults to it.
            speakers:
              - Michael Osborne
            locations:
              - blue_hall

      - time: "10:15"
        title: Break

      - time: "10:45"
        sessions:
          - title: "Scaling Quantum Safe: How HSBC Transitions from Early Momentum to Enterprise Execution"
            description: |
              Quantum Safe transformation is emerging as a critical strategic priority for financial institutions, though most organisations are still in relatively early stages of structured execution. This session shares HSBC's experience in evolving its Quantum Safe journey from a collection of early initiatives into a structured enterprise programme designed for long-term migration.
              As a global financial institution operating across complex technology landscapes, HSBC recognised that successful cryptographic transformation requires more than identifying vulnerable algorithms or testing new technologies — it requires alignment across business priorities, technology domains, governance structures, third-party ecosystems, operational processes, and future investment decisions. The session explores how HSBC approached this transition by consolidating existing insights, validating readiness, strengthening alignment across stakeholders, and creating the foundations for the next stage of execution: moving from awareness and experimentation into an enterprise transformation mindset, strengthening board-level visibility, and building the governance, ownership, and execution model needed for a multi-year journey.
              Rather than focusing only on technology change, this session highlights the organisational and strategic lessons behind scaling Quantum Safe adoption in a large financial institution.
            speakers:
              - Antti Ropponen
              # - Philip Intallura (HSBC) — invited as lead speaker, not yet confirmed. Per committee
              #   instruction, keep this in the strategic/red hall regardless — it is a board-level story.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: "PQC Regulation and Guidance Globally"
            description: |
              PQC guidance varies by country and by industry. Some countries publish short policy papers, others provide detailed cryptographic recommendations, and even PQC migration handbooks. We are also seeing the development of sovereign PQC algorithms and standards. This tutorial gives an overview of the PQC and cryptographic guidance that is currently available, highlights common themes, and identifies significant differences.
              Designed for managers and technical architects planning for PQC migration, especially those working in multinational organizations. It is also suitable for policy makers and regulators to help them understand the changing global landscape, and developers of cryptographic products and services will also benefit.
            track: Tutorial
            durationMinutes: 105
            speakers:
              - Zygmunt Lozinski
            locations:
              - room_a

      - time: "11:45"
        sessions:
          - title: "Prioritising Financial Sector Use-Cases for Migration"
            description: |
              The intricate web of interbank communications, transaction protocols, and shared infrastructure means no single financial institution can effectively navigate a successful Post-Quantum Cryptography (PQC) migration alone. The Quantum Safe Financial Forum (QSFF) was launched by Europol in 2024 and quickly established itself as the go-to authority for financial institutions grappling with the complexities of quantum-safe migration. The forum comprises experts from leading commercial banks, central banks, regulators and other financial entities.
              A dedicated Working Group within QSFF is actively developing an aligned roadmap: precisely defining the scope of each "use-case" for PQC implementation, establishing criteria for evaluating and prioritizing those use-cases, linking business contexts to the CIA triad, identifying concrete milestones, and balancing dependencies to ensure a synchronized rollout.
              This talk provides an overview of the Working Group's structure, its deliverables to date, planned next steps, and practical ways in which the audience can contribute to this vital initiative.
            speakers:
              - Sarah McCarthy
              - Sudha Iyer
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
        sessions:
          - title: "Beyond the Handshake: Enhancing PKI with Out-of-Band Key Agreement"
            description: |
              Post-quantum cryptography (PQC) migration is accelerating, but it also exposes a deeper reality: cryptography can no longer be treated as a one-time design choice embedded in protocols. As standards evolve, organizations must prepare for a future where multiple cryptographic assumptions coexist and continuously change, while advances in automation and AI shrink the window to respond to emerging cryptographic risks.
              This talk introduces Out-of-Band (OOB) Key Agreement as a practical way to enhance PKI, establishing an independent cryptographic control layer that complements existing protocols such as TLS and IPsec. Rather than replacing in-band key exchange, OOB mechanisms derive additional authenticated symmetric keys through a separate, policy-governed channel rooted in PKI identity, enabling organizations to introduce new cryptographic methods, rotate algorithms, and respond to emerging threats without requiring changes to application or transport layers.
              In this model, PKI evolves from a foundational trust anchor into a central orchestrator of cryptographic policy and lifecycle management across multiple key establishment channels, enabling both resilience through diversity and operational simplicity in a post-quantum world.
            speakers:
              - Michele Mosca
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

      - time: "14:30"
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

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e

      - time: "15:00"
        title: Break

      - time: "15:30"
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

      - time: "16:15"
        sessions:
          - title: "Collaborative Efforts to Support Migration to PQC"
            description: |
              A panel discussion that shares examples of how over 55 different organizations have collaborated within the NCCoE Migration to PQC project — using cryptographic visibility to support risk management decisions for migration actions, and performing demonstrations using PQC for interoperability and benchmarking to inform PKI system owners on starting to use PQC algorithms.
              A panel of NCCoE collaborators who have been working on implementing PQC algorithms in PKI systems (such as the US Government PIV card). Moderator to be announced.
            track: Panel discussion
            speakers:
              # Moderator to be announced — William Newhouse (NIST NCCoE) withdrew due to a scheduling conflict.
              - Bruno Couillard
              - Ted Shorter
              - Evgeny Gervis
            locations:
              - plenary

          - title: "Practical Implementation of Hardware-Separated Composite Signatures for Large-Scale PKI During the PQC Migration Period"
            description: |
              The transition to Post-Quantum Cryptography (PQC) presents a significant challenge for organizations operating large-scale Public Key Infrastructures (PKIs). While PQC standards are becoming available, replacing vast numbers of deployed hardware tokens such as smart cards remains operationally expensive and time-consuming.
              In this session, we present our implementation experience with the IETF LAMPS draft "Composite ML-DSA for Use in X.509 Public Key Infrastructure" in a hardware-separated environment for large-scale PKI migration. The approach combines existing smart cards holding traditional signature keys (e.g., RSA) with server-side Hardware Security Modules (HSMs) providing PQC signature capabilities (e.g., ML-DSA), enabling organizations to begin introducing PQC without requiring immediate replacement of end-user hardware. We discuss three representative risks observed during implementation and evaluation: cross-protocol signature composition, unintended reuse of composite-signature keys for single-algorithm signatures, and device impersonation across separated trust domains, and present a device-binding architecture that addresses them while maintaining compatibility with the IETF LAMPS composite signature framework.
              We also evaluate the potential operational impact of this approach using a large-scale PKI migration model involving tens of millions of certificates, and share architectural considerations, implementation experiences, and validation results from a prototype built using cloud-based HSM services and commercially available PKI smart cards.
            speakers:
              - Akane Suzuki
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
        sessions:
          - title: Conference closing
            description: |
              The chairs bring the conference to a close with key takeaways, a call to
              action, and what comes next for the PKI Consortium's PQC work.
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
              - Sven Rajala
            locations:
              - plenary

      - time: "17:05"
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
    image: "photos/AME_0009.jpg"
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
    image: "photos/ANN05834.jpg"
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

## Main Organizers

This conference was made possible through the support of the Post-Quantum Cryptography Working Group and the following organizations:

{{< figure src="organizational-support.jpg" >}}

## Program & Speakers

We don't select speakers based on marketing budgets. We select based on **depth of implementation experience**. You will hear directly from national cybersecurity agencies, NIST/ETSI members, enterprise architects running hybrid setups, and cloud security teams.

{{< cards >}}
card_style: bento
cards:
  - color: bento-teal-pale
    icon: calendar
    title: "The Agenda"
    text: "Our three-day agenda follows a deliberate arc: framing keynote → parallel workshops → synthesis panel. Session titles and confirmed speakers are updated progressively as the program is finalized."
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
