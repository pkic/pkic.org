---
date: 2021-06-21T7:55:00Z
draft: false
title: Remote Key Attestation
description: Being able to remotely prove that a key pair was generated and is managed inside a hardware security module by a user will be critical to expanding the use and security of PKI in a cloud-based world.
keywords: ["pki", "key attestation", "hsm", "qscd", "sscd"]

heroTitle: Remote Key Attestation
heroDescription: Being able to remotely prove that a key pair was generated and is managed inside a hardware security module by a user will be critical to expanding the use and security of PKI in a cloud-based world.
---

Key attestation, in this context, is the technical ability to prove to a remote party that a private key was generated inside, and is managed inside, and not exportable from, a hardware cryptographic module.

While several vendors offer remote key generation services, they all do it differently. This makes it hard or even impossible to scale usage of remote key attestation and create trust across the ecosystem.

## Remote Key Attestation Survey

The PKI Consortium has created a simple market survey, to make a list of the different available key attestation solutions being used by different vendors (including questions on how they work and are used technically). Once we have useful data, we can consider developing common standards that the industry may want to adopt.

{{< button link="https://forms.gle/rUj2J5BshrN4zxG46" label="Click here to complete the remote key attestation survey" >}}

## GitHub

We are using GitHub to host and track the project artifacts.

https://github.com/pkic/remote-key-attestation


