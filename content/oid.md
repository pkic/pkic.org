---
date: 2026-04-13T00:00:00Z
draft: false
title: OID Registry

heroTitle: OID Registry
heroDescription: Object Identifier (OID) assignments for the PKI Consortium

menu:
    footer:
        parent: governance
        weight: 24
---

## Overview

The PKI Consortium has been assigned the Private Enterprise Number (PEN) **64279** by IANA under the arc `1.3.6.1.4.1`. This page documents all OID assignments under the PKI Consortium's arc.

## OID Tree

```mermaid
graph TD
    root["1.3.6.1.4.1.64279<br/>PKI Consortium"] --> pkic["1.3.6.1.4.1.64279.1<br/>PKIC"]
    root --> wg["1.3.6.1.4.1.64279.2<br/>Working Groups"]
    wg --> cm["1.3.6.1.4.1.64279.2.1<br/>Cryptographic Module (CM)<br/>Working Group"]
```

## Assignments

| OID | Description |
| --- | --- |
| 1.3.6.1.4.1.64279 | PKI Consortium |
| 1.3.6.1.4.1.64279.1 | PKIC |
| 1.3.6.1.4.1.64279.2 | [Working Groups](/wg/) |
| 1.3.6.1.4.1.64279.2.1 | [Cryptographic Module (CM) Working Group](/wg/cm/) |

## References

- [IANA Private Enterprise Numbers](https://www.iana.org/assignments/enterprise-numbers/)
