---
authors:
- Bruce Morton
date: "2017-05-03T15:42:21+00:00"
dsq_thread_id:
- 5782832850
keywords:
- google
- policy
- tls
- ietf
- chrome
tags:
- Google
- Policy
- SSL/TLS
- IETF
- Chrome
title: Certificate Transparency Deadline Moved to April 2018


---
[Google just announced][1] they will not be enforcing certificate transparency (CT) logging for all new TLS certificates until April 2018. In a previous [blog post][2], we advised that Google provided a new policy, which required new TLS certificates to be published to the CT logs in order for the domain to be trusted by Chrome.

The reason for the delay was not clear, but Google needs to consider the following:

  * Overall CT policy discussions with the major stakeholders are underway, but we are still far away from a conclusion.
  * Other browsers appear to be supporting CT, but have yet to determine their policies or advance their browser code.
  * The CT deployment document, [RFC 6962-bis][3], tracked by IETF standards has not been released.
  * The proposed document for [CT Domain Label Redaction][4] that addresses privacy has started, but has not been adopted or completed by the IETF.
  * Sufficient, scalable, and reliable CT logs have not been deployed by the ecosystem to address the increase in requirements.

Certification authorities (CAs) as well as TLS certificate subscribers will welcome the extra time to help ensure that deployment of CT logging is efficient and seamless.

 [1]: https://groups.google.com/a/chromium.org/forum/#!msg/ct-policy/sz_3W_xKBNY/6jq2ghJXBAAJ
 [2]: https://casecurity.org/2016/11/08/google-certificate-transparency-ct-to-expand-to-all-certificates-types/
 [3]: https://tools.ietf.org/html/draft-ietf-trans-rfc6962-bis
 [4]: https://tools.ietf.org/html/draft-strad-trans-redaction