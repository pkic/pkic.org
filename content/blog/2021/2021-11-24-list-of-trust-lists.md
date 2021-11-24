---
title: Creating a global List of Trust Lists
Summary: The PKI Consortium is curating a global List of Trust Lists (a curated list of root, intermediate or issuing CA certificates accepted by a public, private, industry, or solution-specific PKI), one that is not limited to a specific purpose, region, or size, and is open to anyone to contribute.
authors: [Paul van Brouwershaven]
date: 2021-11-24T15:00:00+00:00
categories:
keyword: [trust list, trusted list, ltl, lotl, root store, pki]
tags: [LTL]

---

## List of Trust Lists

The PKI Consortium is curating a global List of Trust Lists (a curated list of root, intermediate or issuing CA certificates accepted by a public, private, industry, or solution-specific PKI), one that is not limited to a specific purpose, region, or size, and is open to anyone to contribute.

The status, work in progress, can be followed on our web page.
https://pkic.org/activities/list-of-trust-lists/ 

## What is a Trust List

In the PKI world, “trust lists” used by applications are the cornerstone of a working PKI infrastructure. Trust lists on which applications rely tell members of a PKI community whether they can trust a certificate and its issuer within the context.

The information and format of a trust list can be standardized, but often the list is not much more than a curated list of root, intermediate or issuing CA certificates that have agreed and sometimes been audited to a specific Certificate Policy (CP).

### Trust List Standard

ETSI TS 119 612 provides a specification for trusted lists created by European Union Member States and non-EU countries or international organizations that follow the specification in the context of the eIDAS regulation. The technical specification defines a trusted list as:

> “list that provides information about the status and the status history of the trust services from trust service providers regarding compliance with the applicable requirements and the relevant provisions of the applicable legislation”

Another ETSI specification, TS 119 615 defines procedures for using and interpreting European Union Member States national trusted lists.

## Creating a List of Trust Lists

There are many trust lists and often there is little overlap or interoperability. The best-known implementation of a PKI that relies on trust lists is the ‘WebPKI’, allowing Certificate Authorities (CAs) to issue certificates with the `serverAuth` Extended Key Usage (EKU) so that browsers (the client, used by relying parties) can validate the certificate chain and establish a Transport Layer Security (TLS) connection with the server. While browsers often rely on a trust list managed by the individual browser's root program, they do not trust each other’s lists.

As stated above, trust lists are designed and curated for one or more purposes, but what if you have designed an application that relies on PKI and you do not want or can’t operate your own CA, be a single point of failure or you simply don’t have the capabilities, funds, or contacts to establish and maintain your own trust list and related policy framework? In those scenarios, applications [might inappropriately rely on a third-party trust list](https://blog.mozilla.org/security/2021/05/10/beware-of-applications-misusing-root-stores/), exposing the application and relying party to significant risk. For example, a trust list maintained by a third party might change its policies which could unintendedly hurt your use case or include several inappropriate or untrustworthy trusted parties based on your own criteria.

### Certificate Policies

The IETF standard [RFC 5280](https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.4) includes a certificate policies extension. This extension can indicate or limit the policy under which a certificate is issued and the purposes for which the certificate may be used or issue other certificates. This allowed Certificate Authorities to rely on a minimal root embedding and client applications to be configured to only trust one or more certificate policies. By including certificate policies within an intermediate certificate CAs can restrict a part of the hierarchy to a specific set of policies, but as each use-case and thus policy has a different risk exposure, conflicting requirements for any parent or root certificates could have an indirect and unintended impact on other parts of the hierarchy. 

The CA/Browser Forum requires CAs to include a specific certificate policy to identify under which policies and processes the certificate was issued. The approved certificate policies are based on the same framework and are intended to indicate the exact requirements for certificates sharing the same Extended Key Usage.

### Different communities

A PKI might rely on certificates sharing the same profile but in a constrained or controlled environment with different requirements. For example, a certificate with a `serverAuth` EKU used to host a public website on TLS for the internet at large might look the same as a certificate used by an API that is used over TLS from an IoT device. 

That IoT device is much more constrained on its crypto capabilities, less frequently updated and might not support newer technologies. 

Issues like this impacted the WebPKI migration to 2048-bit keys and again when deprecating SHA-1 and could have been avoided with a dedicated trust list.

### Included information

At this stage we are only collecting some basic information, the name of the list and a link with more information are the minimal requirements but more data can be provided, see the [supported field in the contribution guidelines](https://github.com/pkic/ltl/blob/main/.github/CONTRIBUTING.md#supported-fields) or the [data model itself](https://github.com/pkic/ltl/blob/main/ltl/model.go).

## Goals

With this project the PKI Consortium is not only building a comprehensive list of trust lists but also a place where the industry can find each other, engage, share knowledge, policies, and best practices to improve security, interoperability, and mutual trust.

## Contributing

We encourage everyone (including non-members) to participate in our List of Trust Lists project. Contributions can be of any size, such as simply [creating an issue](https://github.com/pkic/ltl/issues) to make us aware of a specific trust list. Adding detailed information about a trust list and its corresponding program, or by [financially sponsoring our activities](https://pkic.org/sponsors/sponsor/) would be greatly appreciated.

https://github.com/pkic/ltl/contribute 

### Join the discussion

The PKI Consortium welcomes Trust List operators or CAs included on these lists to [join us](https://pkic.org/join) and would like to engage in related activities from other organizations or stakeholders.

If you are interested to join the discussion, please consider joining the PKI Consortium, start or participate on a topic in our [community discussions](https://github.com/pkic/community/discussions).
