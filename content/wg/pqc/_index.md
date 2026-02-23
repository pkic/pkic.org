---
date: 2023-06-13T08:00:00Z
draft: false
menu:
    main:
        parent: working-groups
        name: "Post-Quantum Cryptography (PQC)"
        weight: 10
title: Post-Quantum Cryptography Working Group
description: Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.
summary: Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.
keywords: ["pqc", "qsc","quantum","cryptography","pki","post-quantum","nist","migration"]

heroTitle: Post-Quantum Cryptography Working Group
heroDescription: Preparing the PKI ecosystem for the quantum computing era.

heroButton:
  label: Join the PQC Working Group
  link: /join/

wgID: PQC
color: blue
icon: "⚛️"

intro: >
  The **Post-Quantum Cryptography (PQC)** Working Group brings together PKI practitioners,
  researchers, and algorithm experts to prepare the broader ecosystem for the quantum computing era.
  We publish practical guidance, host the annual PQC Conference, and actively track NIST
  standardization efforts to help organizations plan and execute their cryptographic migrations.

chair:
  name: Paul van Brouwershaven
  viceChair: Ralph Poore

focus:
  - title: Algorithm Migration
    description: Guiding organizations through the transition from classical to NIST-standardized post-quantum algorithms (ML-KEM, ML-DSA, SLH-DSA).
    icon: "🔄"
  - title: Standards Tracking
    description: Monitoring and contributing to NIST, IETF, ETSI, and ISO post-quantum cryptography standards as they evolve.
    icon: "📋"
  - title: Industry Readiness
    description: Assessing PQC readiness across the PKI ecosystem through living documents like the PQC Capabilities Matrix.
    icon: "📊"
  - title: Cryptographic Agility
    description: Promoting architectures that can support multiple algorithms simultaneously and allow seamless future transitions.
    icon: "🔀"
  - title: Education & Awareness
    description: Building knowledge and awareness about quantum threats, timelines, and the urgency of cryptographic migration.
    icon: "🎓"
  - title: Interoperability
    description: Facilitating testing and interoperability of PQC implementations across vendors and across protocols.
    icon: "🔗"

deliverables:
  - title: PQC Capabilities Matrix
    description: A living document tracking support for post-quantum cryptography algorithms across vendors and products.
    url: /pqccm/
    status: active
  - title: PQC Migration Playbook
    description: Step-by-step guidance for organizations planning their migration from classical to post-quantum cryptography.
    url: /resources/
    status: active
  - title: PQC Terminology Guide
    description: Common definitions to ensure consistent communication across the industry about post-quantum cryptography.
    url: /resources/
    status: active
  - title: Harvest-Now-Decrypt-Later Threat Analysis
    description: Analysis and guidance on the "store now, decrypt later" threat model that makes migration time-sensitive.
    url: /resources/
    status: active
  - title: Algorithm Selection Guide
    description: Practical guidance helping PKI practitioners choose the right NIST-standardized algorithms for their specific use cases.
    url: /resources/
    status: planned
  - title: Hybrid Certificate Profiles
    description: Draft profiles for dual-algorithm (classical + PQC) X.509 certificates to support gradual migration.
    url: /resources/
    status: planned

resources:
  - title: NIST Post-Quantum Cryptography Standards
    url: https://csrc.nist.gov/projects/post-quantum-cryptography
    description: NIST's PQC standardization project — home of ML-KEM (FIPS 203), ML-DSA (FIPS 204), and SLH-DSA (FIPS 205).
  - title: IETF Post-Quantum Use in Protocols (PQUIP)
    url: https://datatracker.ietf.org/wg/pquip/about/
    description: IETF working group coordinating PQC integration across all IETF protocols.
  - title: ETSI Quantum-Safe Cryptography
    url: https://www.etsi.org/technologies/quantum-safe-cryptography
    description: ETSI QSC specifications and technical reports for network security.
  - title: BSI PQC Migration Guidance
    url: https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Quantentechnologien-und-Post-Quanten-Kryptografie/
    description: German Federal Office for Information Security recommendations for transitioning to PQC.
  - title: NSA CNSA 2.0
    url: https://media.defense.gov/2022/Sep/07/2003071834/-1/-1/0/CSA_CNSA_2.0_ALGORITHMS_.PDF
    description: NSA's Commercial National Security Algorithm Suite 2.0 — mandatory PQC algorithms for National Security Systems.
  - title: CISA PQC Guidance
    url: https://www.cisa.gov/quantum
    description: US CISA resources and guidance on preparing for post-quantum cryptography.
---
