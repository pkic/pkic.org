---
title: The Insecurity of Mobile Applications
authors: [Rick Andrews]
date: 2015-06-11T18:30:23+00:00
dsq_thread_id:
  - 3838882351


---
Recently, we read about lots of SSL/TLS-related vulnerabilities found in mobile apps, which should come as no surprise. We were warned about this back in 2012 (see [these][1] [studies][2]). More warnings came in 2014 from [CERT][3] and [FireEye][4]. The Open Web Application Security Project (OWASP) listed “insufficient transport layer protection” as number three (#3) in its [top 10 list][5] of mobile security problems of 2014. Apps that don’t use SSL/TLS are particularly vulnerable, given the ease of reading and modifying unsecured traffic at Wi-Fi hot spots, for example. But even apps that use SSL/TLS must be careful to implement proper checking to ensure that attackers can’t exploit weaknesses.

[One recent study][6] found that thousands of mobile apps still use an old version of the OpenSSL library that was vulnerable to the [FREAK attack][7]. A similar problem was revealed by the creators of a popular mobile networking library called AFNetworking, when they disclosed [a serious bug][8] in their library that bypassed all SSL/TLS security checks. Although this bug and the one in OpenSSL were quickly corrected, thousands of mobile apps remain vulnerable until their developers recompile with the fixed version of AFNetworking or OpenSSL, and users upgrade to the fixed version of each app. Because these bugs were in application libraries and not in the operating system, phone vendors cannot automatically apply a patch. Given the slow rate at which users upgrade mobile apps, these vulnerable apps are likely to be with us for a long time.

Failure to properly write and test SSL/TLS-related code might be due to ignorance, or an erroneous assumption that the platform or library will “get it right”. Sometimes SSL/TLS checks are disabled during development and debugging. App creators intend to re-enable these critical certificate-processing checks before the app is shipped, but they forget. That’s apparently what happened with Fandango and Credit Karma, who were [cited last year][9] by the FTC for SSL/TLS failures in their mobile apps.

Developers don’t have to use blind faith; some good tools are now available for testing how an app works in the presence of a Man-in-the-Middle (MITM) like [CERT’s Tapioca][10].

An app or library that validates SSL/TLS certificates should perform a number of checks to ensure strong authentication, confidentiality and integrity. See our [implementation web page][11] for details.

Properly implemented, SSL/TLS protocols provide strong confidentiality, authentication and integrity for communications between endpoints. Yet unless certain checks are performed, data can be intercepted and modified without detection. All SSL/TLS client non-browser applications should follow all the practices in [this document][11] to ensure the promises of SSL/TLS.

 [1]: http://www2.dcsec.uni-hannover.de/files/android/p50-fahl.pdf
 [2]: http://www.cs.utexas.edu/~shmat/shmat_ccs12.pdf
 [3]: http://www.kb.cert.org/vuls/id/582497
 [4]: https://www.fireeye.com/blog/threat-research/2014/08/ssl-vulnerabilities-who-listens-when-android-applications-talk.html
 [5]: https://www.owasp.org/index.php/Projects/OWASP_Mobile_Security_Project_-_Top_Ten_Mobile_Risks
 [6]: http://www.cnet.com/news/more-than-1200-android-apps-still-vulnerable-to-freak/#!
 [7]: https://en.wikipedia.org/wiki/FREAK
 [8]: https://threatpost.com/ios-os-x-library-afnetwork-patches-mitm-vulnerability/111870
 [9]: https://www.ftc.gov/news-events/press-releases/2014/03/fandango-credit-karma-settle-ftc-charges-they-deceived-consumers
 [10]: http://cert.org/blogs/certcc/post.cfm?EntryID=204
 [11]: /uploads/2015/06/SSL-TLS-Chain-Validation-2015-06-10.pdf