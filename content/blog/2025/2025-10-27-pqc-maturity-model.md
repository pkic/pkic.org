---
title: "Defining Quantum-Readiness: Introducing the Post Quantum Cryptography Maturity Model"
summary: |
    As the industry moves toward a post-quantum future, terms like "quantum-ready" and "quantum-safe" are everywhere; but what do they actually mean in practice? The PKI Consortium PQC Working Group has developed a draft Post Quantum Cryptography Maturity Model (PQCMM) to provide clarity for organizations and vendors alike. This model defines maturity levels for PQC adoption across all products and solutions that rely on cryptography. We invite feedback to refine this framework before it becomes an industry reference.
authors:
- Paul van Brouwershaven
date: 2025-10-27T08:00:00+00:00
keywords: [Post-Quantum Cryptography, PQC, PQC Maturity Model, PQCMM, Quantum-Ready, Quantum-Safe, Cryptography, PKI Consortium] 
tags: [PQC, Post-Quantum Cryptography, PQC Maturity Model]
--- 

As the industry moves toward a post-quantum future, terms like *quantum-ready* and *quantum-safe* are everywhere; but what do they actually mean in practice? While the [Post-Quantum Cryptography Capability Matrix (PQCCM)](https://pkic.org/pqccm/) provides a great overview of where vendors stand, it doesn’t always tell the full story. Organizations need clarity on what to expect from products and features, and vendors need a consistent way to communicate their capabilities.

That’s why the PKI Consortium **PQC Working Group** has developed a **draft PQC Maturity Model (PQCMM)**, and we want your feedback.

## Why a Maturity Model?

The goal is simple: provide a clear, structured framework that defines what “maturity” looks like for PQC adoption across **all products and solutions that rely on cryptography**. This helps:

* **Organizations** evaluate PQC readiness during procurement and plan their own transition journey.  
* **Vendors** self-assess and communicate their progress transparently.  
* **The industry** move toward consistent expectations and terminology.

This model is **not tied to a single feature or product category**; it is designed to be **universal**, supporting everything from software libraries to hardware devices, cloud services, and enterprise platforms.

## The Draft PQC Maturity Levels

### Level 1: Initial

Quantum-safe algorithms/features:

* Are **available for testing and evaluation**.  
* Can be configured, typically **manually or via beta options**.

### Level 2: Basic

Quantum-safe algorithms/features:

* Are **supported in core functionality** and production ready.  
* Demonstrate **compatibility with relevant standards**.

### Level 3: Advanced

Includes everything in Level 2, plus:

* A **full inventory** of all cryptographic use cases is maintained.  
* Non-quantum-safe features are **formally documented and flagged** for risk acceptance or mitigation.  
* A **Software Bill of Materials (SBOM)** or equivalent component inventory is produced and maintained.  
* **Crypto-agility mechanisms** exist for key features, enabling algorithm updates without major redesign.

### Level 4: Managed

Includes everything in Level 3, plus:

* A **Cryptographic Bill of Materials (CBOM)** is maintained, detailing algorithms, key sizes, and usage context.  
* **Zero-Legacy Capability:** The solution can be configured to **disable all non-quantum-safe algorithms** while remaining functional.  
* Clearly indicate if **hybrid** and/or **composite** algorithms and/or modes are supported.

### Level 5: Optimized

Includes everything in Level 4, plus:

* Quantum-safe algorithms are the **default/preferred setting**; legacy options require explicit enablement.  
* Algorithms are **benchmarked and tuned** to meet or exceed operational performance requirements.  
* Algorithms primarily follow **NIST-approved PQC standards**, with support for other internationally recognized standards.  
* Cryptographic components use **independently verified or certified implementations** (e.g., FIPS, Common Criteria, or widely scrutinized open-source libraries).

## Key Definitions

* **Quantum-Safe:** Security cannot be compromised by a cryptographically relevant quantum computer (CRQC).  
* **Crypto Agility:** Ability to securely update algorithms and features using quantum-safe methods without hardware refresh.

## Our Role in Certification

While the PQC Maturity Model is currently self-reported, we recognize the value of independent validation, and we look forward to this Maturity Model becoming the basis of an industry certification process. However, we don’t want certification bodies to create their own interpretations of this model in isolation. Instead, we aim to **actively collaborate** with certification bodies to ensure that:

* The **certification process aligns with the intent and expectations** of the PQC Maturity Model.  
* The **criteria for assessing maturity are consistent and transparent** across the industry.

This collaborative approach ensures that any formal certification based on the model truly reflects the principles we’ve established, rather than diverging into fragmented standards.

## We Need Your Input

Does this model provide the clarity you need? Are the levels and definitions practical? What’s missing? Your feedback will help us refine this framework before it becomes an industry reference.

👉 [**Share your feedback here**](http://pkic.org/discussions)
