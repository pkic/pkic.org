---
date: 2021-06-21T7:55:00Z
draft: false
title: Improving quality of address information in certificates
description: A linter to improve address validation, using authoritative sources to support the linter and avoid errors and inconsistencies.
keywords: ["address","validation","pki","x509","iso3166-2"]

heroTitle: Quality of address information in certificates
heroDescription: A linter that is using authoritative sources and verifiable contributions to avoid errors and inconsistencies of address information included in certificates.

---

To improve the quality of address information in digital certificates the PKI Consortium is collecting authoritative data and engaging with organizations such as the [Universal Postal Union](https://www.upu.int/) (a United Nations specialized agency and the postal sector's primary forum for international cooperation) to better understand the local addressing systems and to validate data that is not generally available.

We’re starting with the state or province data field and will then extend the reach of our linter to other address fields such as street address, locality, and postal code.

## Data Sources

Data is obtained directly from the European Union and combined with data from the ISO 3166-2. Sources that could be added might include the United Nations Code for Trade and Transport Locations (UN/LOCODE) and others with a similar status.

The architecture supports additional sources, including a manual source, but the process for manually adding and reviewing entries has not been defined at this stage. The intent is that members of the PKI Consortium act as region owners to verify changes with the official government data before approving.

https://github.com/pkic/regions

