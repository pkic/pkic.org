---
title: "PKI Consortium Launches the CBOM Profiles Working Group"
summary: |
    The PKI Consortium has established a new CBOM Profiles Working Group to develop a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles. Chaired by Michael Osborne (IBM) and Vice-Chaired by William (Bill) Turner (Independent), the group will produce mapping guidance to SPDX and CycloneDX and publish reference profiles — including PKI-focused examples — so any industry can define its own CBOM profile in a consistent, repeatable way.
authors:
- Paul van Brouwershaven
- Michael Osborne
- William (Bill) Turner
date: 2026-06-08T07:00:00+00:00
keywords: [CBOM, Cryptographic Bill of Materials, BOM, SPDX, CycloneDX, PKI, PQC, crypto-agility, profile, working group, IBM, Michael Osborne]
tags: [CBOM, PKI, PQC, Working Group]
---

The PKI Consortium is pleased to announce the launch of the [CBOM Profiles Working Group](/wg/cbom/) — a new initiative to bring neutral, open guidance to one of the most pressing gaps in the cryptographic asset management landscape.

## The Problem

A Cryptographic Bill of Materials (CBOM) describes the cryptographic assets present within a system, product, or organization. As CBOM adoption accelerates — driven by post-quantum migration requirements, supply chain transparency mandates, and regulatory pressure — a recurring problem has emerged: there is no shared, neutral guidance on how to define a *profile*.

A profile is a constrained, use-case-specific specification of what a CBOM should contain, how its fields should be interpreted, and what validation rules apply. Today, profile definition happens implicitly inside individual standards efforts. This couples profile design decisions to the ontology, governance, and release cadence of whichever standard hosts them. The result is inconsistency across industries, duplicated effort, and profile design decisions entangled in the politics of individual standards bodies.

> "We observed various global standards bodies independently attempting to map cryptographic metadata, which risked fragmenting digital supply chain trust. The CBOM Profiles Working Group was established to provide an impartial, centralized venue where this critical mapping can be executed once with high precision, and made universally accessible. The PKI Consortium is the ideal forum to anchor this global, vendor-agnostic baseline."
>
> — **William (Bill) Turner**, Vice Chair, CBOM Profiles Working Group

## The Solution

The CBOM Profiles Working Group will develop a **clear, neutral methodology for defining CBOM profiles** — independent of any single base standard. The methodology is deliberately designed so that a profile defined using PKIC guidance maps simply onto industry BOM standards such as **SPDX** and **CycloneDX**, rather than competing with them.

The PKIC output is intended to become the reference any industry consults when it wants to create a CBOM profile for a particular use case. To ensure the methodology can be supported by practical tooling, the Working Group will explore cooperation with relevant open-source and standards initiatives, including the **Linux Foundation** (PQCA, SPDX) and the **OWASP Foundation** (CycloneDX).

> "As the post-quantum migration moves from planning to execution, organizations are discovering that knowing *what* cryptography you have is just as important as knowing *how* to replace it. A CBOM is the foundation of that inventory — but only if everyone defines it the same way. This Working Group fills that gap in a way that is neutral, open, and practical."
>
> — **Paul van Brouwershaven**, Chair, PKI Consortium

## Deliverables

The Working Group's initial deliverables are:

- A **documented methodology** for defining CBOM profiles
- **Standards mapping guidance** describing how profiles are expressed in SPDX, CycloneDX, and other relevant BOM standards
- **Reference profiles** — including at least one PKI-focused profile — as worked examples
- **Profile authoring guidelines** for organizations that want to define their own profiles

All deliverables will be licensed under CC BY 4.0 or MIT and published in a public repository under the PKIC GitHub organization.

## Leadership

The Working Group is chaired by **Michael Osborne** (IBM), an IBM Distinguished Engineer and global CTO for IBM Quantum Safe who leads cryptographic research at the IBM Research Center in Rüschlikon, Switzerland. Michael has been at the forefront of post-quantum cryptography standardization, contributing to the NIST PQC process that produced ML-KEM, ML-DSA, and SLH-DSA.

**William (Bill) Turner** (Independent) serves as Vice Chair and is the originator of the idea behind this Working Group. An independent cryptography and critical infrastructure architect with 25 years of experience, Bill's work has focused on securing critical infrastructure — including major Canadian financial institutions — and on post-quantum cryptography migration. He participates in NIST working groups, the Cloud Security Alliance, and the Canadian Cyber Forum, and is an active member of several PKI Consortium's working groups.

> "IBM has invested deeply in understanding what it takes to discover, inventory, and migrate cryptographic assets at enterprise scale. A shared, standards-neutral profile methodology is the missing piece that lets organizations actually use a CBOM in practice — not just produce one. I am delighted to chair this effort and bring that experience to the wider community."
>
> — **Michael Osborne**, Chair, CBOM Profiles Working Group; CTO IBM Quantum Safe, IBM Research

## Founding Members

The Working Group launches with a strong and diverse founding membership:

AppViewX, Aprio, CertiPath, Crypto4A, Cyber Quanta, CyberTrust Consulting, Data-Warehouse GmbH, Digitorus, eMudhra, Gola Cyber Security Solutions, i4p informatics, IBM, KIR, NgKore Foundation, OmniTrust, SafeLogic, and SITG Consulting.

## Get Involved

Organizations and individuals interested in participating are welcome to join. Members contribute to working group discussions, help shape the methodology, and review deliverables. Non-members can participate through community discussions on GitHub.

To join, visit [pkic.org/join](/join/) and express your interest in the CBOM Profiles Working Group.

Learn more about the Working Group and its charter at [pkic.org/wg/cbom/](/wg/cbom/).
