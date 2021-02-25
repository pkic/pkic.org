---
authors:
- CA Security Council
date: "2014-08-28T14:07:44+00:00"
dsq_thread_id:
- 2966836432
keywords:
- casc
- chrome
- ssl
- code signing
- google
- microsoft
- attack
- policy
tags:
- CASC
- Chrome
- SSL/TLS
- Code Signing
- Google
- Microsoft
- Attack
- Policy
title: Google Plans to Deprecate SHA-1 Certificates


---
On August 19, [Google announced a new policy][1] that accelerates the deprecation of SHA-1 certificates, potentially causing websites using SHA-1 certificates to display warnings in the near future. With the change, Chrome 39 will show a warning for sites that have a SHA-1 certificate expiring in 2016 and require a click through warning for sites with a SHA-1 certificate expiring in 2017 or later. This proposal is scheduled for Chrome 39, which could be released as early as 12 weeks from now.

Although the CA Security Council (CASC), comprised of the seven largest Certificate Authorities, supports migration to SHA-2, members are concerned about the impact on website users and administrators alike. Considering many users may still use software lacking SHA-2 support, primarily Windows XP SP2, and the still unknown impact on a complete SHA-1 migration, this 12 week timeline is aggressive. In addition, many devices still lack SHA-2 support, making necessary possibly unplanned and expensive upgrades.

With fall shopping season nearly here, this policy may be particularly concerning for small internet stores, which could be impacted just before the holiday rush. Because many large sites have lockdown periods leading up to the end of the year, companies that have not transitioned may find themselves restricted from making the move until January, or beyond, due to lack of SHA-2 support. Although a migration to SHA-2 is necessary as computing power increases, because of the significant impact in migration and the lack of a practical attack until [2018][2], the CASC members recommends the [timelines announced by Microsoft][3] in November 2013, which deprecate SHA-1 in code signing certificates by January 1, 2016 and in SSL certificates by January 1, 2017.

To avoid warnings, the CASC recommends that all website operators accelerate their SHA-2 deployment where possible. At the same time, the CASC urges Google to consider the circumstances of website operators and adjust its implementation timelines to match the January 1, 2017 deprecation dates. CASC members remain committed to helping their customers fully migrate to SHA-2 as needed to support the customer’s operations.

 [1]: https://groups.google.com/a/chromium.org/d/msg/security-dev/2-R4XziFc7A/NDI8cOwMGRQJ
 [2]: https://www.schneier.com/blog/archives/2012/10/when_will_we_se.html
 [3]: https://casecurity.org/2014/01/30/why-we-need-to-move-to-sha-2/