---
date: 2026-06-08T00:00:00Z
draft: false
title: CBOM Profiles Working Group Charter
summary: Charter of the CBOM Profiles Working Group
keywords: ["cbom", "cryptographic bill of materials", "profile", "spdx", "cyclonedx", "pki", "pkic"]

heroTitle: CBOM Profiles Working Group Charter
heroDescription: Charter of the CBOM Profiles Working Group

---

This Working Group Charter has been created according to the ["Working Groups"](/bylaws/#9-working-groups) section of the Bylaws of the PKI Consortium ("PKIC"). In the event of a conflict between this Charter and any provision in either the Bylaws or the IPR Policy, the provision in the [Bylaws](/bylaws/) or [IPR Policy](/ipr/) shall take precedence.

## Summary of the Working Group

| | Summary |
|-|-|
| **Name** | CBOM Profiles |
| **Abbreviation** | CBOM |
| **Chair(s)** | Michael Osborne (IBM) |
| **Vice Chair** | William (Bill) Turner (Independent) |
| **Communication** | Private mailing list, Virtual meetings, [Community discussions](https://github.com/pkic/community/discussions), [GitHub](https://github.com/pkic/) |
| **Meeting schedule** | Virtual meetings: approximately 1 per month |
| **Membership eligibility** | All Member types of the PKIC that express the interest in this Working Group |
| **Voting structure** | According to the PKIC Bylaws |
| **Expiration** | This Working Group is chartered indefinitely until it is dissolved |
| **Members** | {{< wgmembers CBOM >}} |

## Introduction

A Cryptographic Bill of Materials (CBOM) describes the cryptographic assets present within a system, product, or organization. As CBOM adoption grows, a recurring problem emerges: there is no shared, neutral guidance on how to define a *profile* — a constrained, use-case-specific specification of what a CBOM should contain, how its fields should be interpreted, and what validation rules apply.

Today, profile definition happens implicitly inside individual standards efforts. This couples the act of defining a profile to the ontology, governance, and release cadence of whichever standard hosts it. The result is inconsistency across industries, duplicated effort, and profile design decisions becoming entangled in the politics of standards bodies.

The goal of this Working Group is to develop a clear, neutral approach to defining CBOM profiles — independent of any single base standard. The approach is deliberately designed so that a profile defined using PKIC guidance maps simply onto industry BOM standards such as SPDX and CycloneDX, rather than competing with them. The PKIC output is intended to become the reference any industry consults when it wants to create a profile for a particular use case.

The CBOM profile methodology must be easy to adopt. It must be clear and understandable across different cryptographic environments, use cases, and industries, and it must be open and freely available to anyone.

## Scope

**The scope of this Working Group is to:**

- Define and maintain a methodology for specifying CBOM profiles, independent of any single base BOM standard
- Define and maintain mapping guidance that ensures profiles can be expressed simply in industry BOM standards, with SPDX and CycloneDX as the initial mapping targets
- Develop one or two reference profiles as worked examples that demonstrate the methodology
- Define relevant PKI-focused CBOM profiles, as a domain in which the PKIC holds direct subject matter expertise
- Explore cooperation with relevant open-source and standards initiatives — including the Linux Foundation (PQCA, SPDX) and the OWASP Foundation (CycloneDX) — so that the profile methodology can be supported by practical tooling
- Collect feedback from participants and interested parties regarding the methodology, mapping guidance, and reference profiles
- Collaborate on reviews and revisions of the methodology and reference profiles

**Out of scope is:**

- Developing or maintaining a base BOM standard or cryptographic ontology — the Working Group builds on existing standards rather than replacing them
- Defining profiles for every possible industry use case — the Working Group provides the method and examples; industries author their own profiles using it
- Certifying or validating third-party profiles

## Objectives and goals

The objective is to provide a documented, neutral methodology for defining CBOM profiles, together with mapping guidance to industry BOM standards and a small set of reference profiles that demonstrate the method in practice.

The methodology should achieve the following:

- Allow any industry or organization to define a CBOM profile for its use case in a consistent, repeatable way
- Keep profile definition simple by separating it from complex base-standard ontologies
- Ensure that a profile, once defined, maps cleanly onto SPDX, CycloneDX, and potentially other BOM standards
- Promote consistency in profile design across industries, reducing duplicated and divergent effort
- Provide a neutral venue for profile methodology, insulating design decisions from the governance politics of any single standards body
- Establish reference PKI profiles that reflect the PKIC's core domain expertise
- Enable the methodology to be supported by tooling through cooperation with external initiatives, rather than requiring the Working Group to develop and maintain tooling itself

## Summary of the planned activities

To achieve the objectives and goals, the Working Group will gather feedback from its Members, participants, and interested parties on the structure of the profile methodology, leading to a robust and recognized approach.

Activities carried out by the Members of this Working Group include:

- Regular meetings and discussions on the development of the profile methodology and related changes
- Collecting information and feedback from interested parties regarding the methodology, mapping guidance, and reference profiles
- Contributing to the definition of the profile methodology, including its structure, required elements, and validation conventions
- Developing mapping guidance to SPDX, CycloneDX, and other relevant BOM standards
- Authoring one or two reference profiles, including PKI-focused profiles, as worked examples
- Liaising with relevant standards bodies and open-source initiatives — including the Linux Foundation (PQCA, SPDX) and the OWASP Foundation (CycloneDX) — to keep mapping guidance current and to enable tooling support for the methodology
- Creating awareness about the CBOM profile methodology, its adoption, and how to use it
- Preparing and publishing the deliverables of this Working Group

Change in activities described in this Working Group Charter must follow the "Decision process" described in this document.

## Summary of the deliverables

Based on the objectives, goals, and planned activities of this Working Group, the initial deliverables are:

- A documented methodology for defining CBOM profiles
- Documented mapping guidance describing how profiles defined with the methodology are expressed in SPDX, CycloneDX, and other relevant BOM standards
- One or two documented reference profiles demonstrating the methodology, including at least one PKI-focused profile
- Documented guidelines on how to use the methodology to author a new profile
- Blog posts and articles to create better awareness about the methodology, its adoption, and how to use it

Where the Working Group identifies tooling needs, it will seek to address them through cooperation with relevant external initiatives, rather than maintaining tooling directly. Any tooling produced through such cooperation will be published under the same licensing terms as the other deliverables.

All deliverables are licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) or MIT license and hosted within a public repository under the PKIC GitHub organization.

The change in deliverables described in this Working Group Charter must follow the "Decision process" described in this document.

## Means of communication

A private mailing list is used for communication between Working Group Members.

Interested parties can contribute using the [community discussions](https://github.com/pkic/community/discussions) on GitHub, and Working Group Members will actively participate in those discussions.

Planning and action items are managed as issues within the same repository where the deliverables are published.

## Membership and participation

Organizations that are eligible to join this Working Group follow the membership process as described in the [Bylaws](https://pkic.org/bylaws) of the PKIC, section "Membership".

In accordance with the IPR policy, Members that choose to participate in this Working Group must declare their participation prior to participating by contacting the Chair of this Working Group.

The Chair of this Working Group must establish a list for declarations of participation and manage it in accordance with the PKIC Bylaws and the IPR policy and agreement.

Non-members can participate using the [community discussions](https://github.com/pkic/community/discussions).

## Decision process

The decision process follows [Bylaws](https://pkic.org/bylaws) of the PKIC, with reference to sections "Voting" and "Working Group".

All decisions in this Working Group shall be made by substantial consensus (as determined by the Working Group Chair) of all PKIC Members including interested parties. If substantial consensus cannot be reached (or upon the request of any three PKIC Members), the matter will be submitted for decision by the Executive Council.

## IPR policy

This Working Group is subject to the [Intellectual Property Rights Agreement](https://pkic.org/ipr), [Code of Conduct](https://pkic.org/code-of-conduct) and [Bylaws](https://pkic.org/bylaws) of the PKIC, including the Antitrust Policy.

## Antitrust policy

In accordance with the PKIC antitrust policy, as stated by the PKIC Bylaws, an antitrust statement should be applied and read at the start of all Working Group meetings, in substantially the form written in PKIC Bylaws, chapter "Antitrust Policy".

## Other applicable policies

Any relevant PKIC policies defined by the Bylaws must be followed if not specifically excluded by this Working Group Charter.
