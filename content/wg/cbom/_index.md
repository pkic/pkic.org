---
date: 2026-06-08T00:00:00Z
draft: false
menu:
    main:
        parent: working-groups
        name: "CBOM Profiles"
        weight: 50

title: CBOM Profiles Working Group
description: Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.
summary: Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.
keywords: ["cbom", "cryptographic bill of materials", "bom", "spdx", "cyclonedx", "pki", "crypto", "profile", "pqc", "post-quantum"]

heroTitle: CBOM Profiles Working Group
heroDescription: A neutral methodology for defining Cryptographic Bill of Materials profiles.

heroButton:
  label: Join the CBOM Profiles Working Group
  link: /join/

wgID: CBOM
color: teal
sectionNav: true

cascade:
  params:
    sectionNav: true

chair:
  name: Michael Osborne
  affiliation: IBM
  viceChair: William (Bill) Turner

card:
  icon: cbom
  order: 5
  gradient: ["#006a6a", "#003333"]
  description: "Providing a neutral, open methodology for defining CBOM profiles that map cleanly onto SPDX, CycloneDX, and other BOM standards."
  links:
    - text: "Charter"
      url: "/wg/cbom/charter/"
      chip: muted

intro: |
  The **CBOM Profiles** Working Group develops a clear, neutral methodology for defining profiles of a Cryptographic Bill of Materials (CBOM) — independently of any single base standard. A profile is a constrained, use-case-specific specification of what a CBOM should contain, how its fields should be interpreted, and what validation rules apply.

  The Working Group designs its methodology so that profiles map simply onto industry BOM standards such as SPDX and CycloneDX, rather than competing with them. The PKIC output is intended to become the reference any industry consults when creating a CBOM profile for a particular use case.

focus:
  - title: Profile Methodology
    description: Defining and maintaining a neutral methodology for specifying CBOM profiles, independent of any single base BOM standard.
    icon: "📋"
  - title: Standards Mapping
    description: Developing mapping guidance so that profiles can be expressed in SPDX, CycloneDX, and other relevant BOM standards.
    icon: "🗺️"
  - title: Reference Profiles
    description: Authoring reference profiles — including PKI-focused profiles — as worked examples that demonstrate the methodology.
    icon: "📄"
  - title: PKI Domain Expertise
    description: Applying the PKIC's core domain knowledge to define PKI-focused CBOM profiles as exemplary use cases.
    icon: "🔑"
  - title: Tooling Cooperation
    description: Exploring cooperation with relevant open-source and standards initiatives — including the Linux Foundation (PQCA, SPDX) and the OWASP Foundation (CycloneDX) — so that the methodology can be supported by practical tooling.
    icon: "🔧"
  - title: Openness & Adoption
    description: Ensuring the methodology is easy to adopt, freely available, and understandable across different cryptographic environments and industries.
    icon: "🌐"

keyDeliverables:
  - title: CBOM Profile Methodology
    description: A documented, neutral methodology for defining CBOM profiles — allowing any industry or organization to specify a CBOM profile in a consistent, repeatable way.
    icon: cbom
    cta: Coming Soon
    badge: Development
  - title: Standards Mapping Guidance
    description: Documented mapping guidance describing how profiles defined with the methodology are expressed in SPDX, CycloneDX, and other relevant BOM standards — ensuring profiles are immediately actionable.
    icon: cbom
    cta: Coming Soon
    badge: Development

deliverables:
  - title: CBOM Profile Methodology
    description: A documented methodology for defining CBOM profiles, independent of any single base BOM standard.
    status: development
  - title: Standards Mapping Guidance
    description: Documented mapping guidance describing how profiles defined with the methodology are expressed in SPDX, CycloneDX, and other relevant BOM standards.
    status: development
  - title: Reference Profiles
    description: One or two documented reference profiles demonstrating the methodology, including at least one PKI-focused profile.
    status: development
  - title: Profile Authoring Guidelines
    description: Documented guidelines on how to use the methodology to author a new CBOM profile.
    status: development

resources:
  - title: CycloneDX CBOM Standard
    url: https://cyclonedx.org/capabilities/cbom/
    description: CycloneDX Cryptographic Bill of Materials (CBOM) specification for documenting cryptographic assets.
  - title: SPDX Specification
    url: https://spdx.dev/
    description: Linux Foundation SPDX standard for software bill of materials, one of the primary CBOM mapping targets.
  - title: Linux Foundation PQCA
    url: https://pqca.org/
    description: Post-Quantum Cryptography Alliance — a cooperation partner for tooling support of the CBOM profile methodology.
  - title: NIST Software Supply Chain Security Guidance
    url: https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-supply-chain-security-guidance-20
    description: NIST guidance on software supply chain security under Executive Order 14028, covering SBOM and related bill of materials concepts.
  - title: CISA SBOM Resources
    url: https://www.cisa.gov/sbom
    description: US CISA resources on software bill of materials, relevant background for CBOM profile design.
---
