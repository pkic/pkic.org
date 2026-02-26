---
date: 2025-07-04T00:00:00Z
draft: false
menu:
    main:
        parent: working-groups
        name: "Cryptographic Module (CM)"
        weight: 20
title: Cryptographic Module Working Group
description: A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.
summary: A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.
keywords: ["cryptographic", "module", "hsm", "tpm", "kms", "pki", "crypto", "public key cryptography", "public key infrastructure"]

heroTitle: Cryptographic Module Working Group
heroDescription: Addressing cryptographic module, HSM, and TPM topics to strengthen the PKI ecosystem.

heroButton:
  label: Join the CM Working Group
  link: /join/

wgID: CM
color: orange

chair:
  name: Zsolt Rózsahegyi
  viceChair: Daniel Cervera

card:
  icon: cm
  order: 3
  gradient: ["#8b3200", "#4a1a00"]
  description: "Addressing cryptographic module, hardware security module (HSM), and TPM topics to strengthen the PKI ecosystem."
  links:
    - text: "Remote Key Attestation"
      url: "/wg/cm/remote-key-attestation/"
      chip: primary
    - text: "Charter"
      url: "/wg/cm/charter/"
      chip: muted

intro: |
  The **Cryptographic Module (CM)** Working Group is a central forum for addressing topics related to cryptographic modules, hardware security modules (HSMs), and trusted platform modules (TPMs) within the PKI ecosystem.
  The group collaborates on interoperability challenges, standards alignment, and practical guidance for deploying and managing cryptographic hardware.

focus:
  - title: HSM Interoperability
    description: Improving interoperability between hardware security modules, cryptographic modules, and the broader PKI ecosystem.
    icon: "🔗"
  - title: Key Management
    description: Best practices for secure key lifecycle management in HSMs, TPMs, and key management systems.
    icon: "🗝️"

deliverables:
  - title: Remote Key Attestation
    menuTitle: Key Attestation
    description: A curated list of cryptographic devices and their support for remote key attestation, enabling organizations to verify key hardware security remotely.
    url: /wg/cm/remote-key-attestation/
    status: active
  - title: Vendor Independent Key Backup
    description: A practical guide for securely backing up cryptographic keys in a vendor-agnostic manner, ensuring resilience and continuity in PKI operations.
    status: development

resources:
  - title: NIST FIPS 140-3
    url: https://csrc.nist.gov/publications/detail/fips/140/3/final
    description: Security requirements for cryptographic modules used in federal systems.
  - title: PKCS#11 Specification
    url: https://www.oasis-open.org/committees/pkcs11/
    description: OASIS standard for a cryptographic token interface.
  - title: CMVP - Cryptographic Module Validation Program
    url: https://csrc.nist.gov/projects/cryptographic-module-validation-program
    description: NIST/CCCS program for validating cryptographic modules against FIPS 140 standards.
---
