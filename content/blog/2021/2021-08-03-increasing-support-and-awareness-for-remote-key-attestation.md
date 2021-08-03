---
title: Increasing support and awareness for Remote Key Attestation
summary: The PKI Consortium is collecting information (and looking for contributions) on how or if solutions provide a method to prove to a remote party that a private key was generated, managed inside, and not exportable from, a hardware cryptographic module.
authors: 
- Tomas Gustavsson
- Giuseppe Damiano
- Paul van Brouwershaven
date: 2021-08-03T12:00:00+00:00
categories:
keyword: [hsm, token, tpm, secure-enclave, smart-card, private key, attestation, pki, crypto]
tags: [HSM, Token, Smart-card, TPM, Secure Enclave, Key Attestation]

---

## Remote Key Attestation

The PKI Consortium is collecting information (and looking for contributions) on how or if solutions provide a method to prove to a remote party that a private key was generated, managed inside, and not exportable from, a hardware cryptographic module.

The current status, work in progress, can be followed on our web page.
https://pkic.org/activities/remote-key-attestation/


## Why Key Attestation?

### Software vs Hardware protected keys

The value of a private key strongly depends on how well it is protected from copying and malicious use, something that strongly depends on the security of the environment the key is generated and used in. A key located on a general file system or database can easily be copied without the knowledge of the owner of that key, which is the reason that hardware cryptographic modules are increasingly recommended or even required, for purposes as diverse as mobile phones, IoT devices and secure signature creation devices.

### Requirements for Hardware protected keys

The policy of a PKI might require stronger assurance on the authenticity, integrity and non-repudiation of a digital signature that a certificate in software can guarantee. Therefore the CA issuing the certificate wants a cryptographically verifiable attestation that the public key in a Certificate Signing Request (CSR) is for a private key that is generated, managed, and marked as not exportable by a hardware cryptographic module. Remote Key Attestation also gives stronger confidence to users that their keys are securely generated and stored in a secure hardware protected keystore. In small scale, or in local environments, this has been handled physically, i.e. by handing out cards and tokens or performing audits. On a large scale in distributed environments there is a need to automate this process in order to make it secure and cost effective.

### Random Number Generator

The uniqueness of a private key, and thus the difficulty of guessing the key, ultimately depends on the unpredictability of random numbers generated in the key generation process. A certified hardware cryptographic module contains a certified Random Number Generator (RNG). This RNG is used to generate secure random data, required to generate a cryptographic key, seed, or other entropy. Attesting that the key was generated inside the hardware security module also attests that the certified RNG was used in the key generation process.

## Methods for Key Attestation

The method for key attestation usually consists of a vendor defined attestation key, securely provisioned in a hardware security module during manufacturing. The hardware security module can use the attestation key to sign data linking a public/private key to it’s attributes in the hardware security module. If one trusts the manufacturer of the hardware security module it is then possible to remotely and securely verify the key attributes of any key generated in the module after manufacturing.

## Contributing

We encourage everyone (including non-members) to participate in our Remote Key Attestation project. Contributions can be of any size, such as simply [creating an issue](https://github.com/pkic/remote-key-attestation/issues) to make us aware of a specific implementation or vendor. Adding detailed information about an implementation, standard or by [financially sponsoring our activities](/sponsors/sponsor/) would be greatly appreciated.

https://github.com/pkic/remote-key-attestation 

### Join the discussion

Some hardware cryptographic module vendors such as [Utimaco](/members/utimaco/), [Entrust](/members/entrust/) and [TrustSec](/members/trustsec/) are already members of the PKI Consortium and we would welcome other vendors of hardware cryptographic modules or organizations that rely on the key attestations to join us.

If you are interested to join the discussion, please consider joining the PKI Consortium, start or participate on a topic in our [community discussions](/discussions/).
