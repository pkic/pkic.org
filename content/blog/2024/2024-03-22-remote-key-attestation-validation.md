---
title: A list of cryptographic devices that includes support for remote key attestations
summary: The PKI Consortium is managing a a list of cryptographic devices that includes support for remote key attestations, without endorsing their implementation or quality.
authors: 
- Tomas Gustavsson
date: 2024-03-22T12:00:00+00:00
categories:
keyword: [cryptography, hardware, solutions, software]
tags: [Remote Key Attestation]

---

## Remote Key Attestation at the PKI Consortium

Remote key attestation is the capability for a remote party to prove that a key pair of an end entity is generated and secured inside an approved cryptographic module. While key attestation has been around for some time, it has only recently gained wider public and industry attention. Despite having advocates for decades, it has often been overshadowed by more immediate cybersecurity concerns. However, with the ongoing digitization of society and our increased reliance on digital trust for both human and machine operations, the need for robust cybersecurity measures, including remote key attestation, is on the rise.

Hardware cryptographic modules play a crucial role in addressing the challenges posed by large-scale automated threat vectors. With the proliferation of these modules, there is a growing interest in remote key attestation.

Several examples of remote key attestation include:

* Trusted Platform Modules (TPMs) and smart cards, where critical digital signature keys are stored separately to prevent malware from stealing keys and enabling impersonation in activities like contract signing.
* Mobile phones, which are used for a wide range of activities from accessing critical data to online banking. Protecting these devices from malware is essential to prevent theft of keys and unauthorized access to users' accounts.
* Code signing, which requires a digital signature from original software vendors to prevent the easy installation of malware on users' computers. Protecting code signing keys from theft is crucial in maintaining the integrity of legitimate software.

For the PKI Consortium, the emphasis on hardware cryptographic devices for code signing keys, as enforced by the CA/B Forum1 and Microsoft, has triggered significant activity. The shift towards hardware tokens for code signing, such as USB tokens or smart cards, presents challenges in scalability for organizations due to increased automation, distributed teams, and a surge in the number of signatures performed.

## Addressing Challenges

To address these challenges, many organizations are exploring network-connected signature solutions and hardware security modules (HSMs). However, a crucial question arises: How can a user prove to a Certificate Authority (CA) that an HSM is indeed being used, without relying on manual labor? This is where remote key attestation becomes pivotal. Due to the lack of a standardized approach for performing remote key attestation, the PKI Consortium is spearheading the Remote Key Attestation project to compile resources on how this process can be carried out across various hardware security modules.

The project focuses on two main aspects:

* A list of implementations indicating whether modules have remote attestation capabilities, are in development, or are on the roadmap.
* A validation section providing information on how to perform basic validation of required attributes for hardware security modules.

Additionally, the project links to ongoing standardization efforts in the field.

## Call to Action

This post encourages a Call to Action:
Contribute your knowledge of hardware security modules, processed and technical details, to make this free and open list as comprehensive as possible. This collaborative effort benefits both users and CAs and becomes more valuable as more modules are described, and more details are included in the descriptions.


## Contributing

We encourage everyone (including non-members) to participate in our Remote Key Attestation project. Contributions can be of any size, such as simply [creating an issue](https://github.com/pkic/pkic.org/issues) to make us aware of a specific implementation or vendor. Adding detailed information about an implementation, standard or by [financially sponsoring our activities](/sponsors/sponsor/) would be greatly appreciated.

### Join the discussion

We also welcome you to join the PKI Consortium and to start or participate in a topic in our [community discussions](https://github.com/pkic/community/discussions).

