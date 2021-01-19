---
title: POODLE for TLS
authors: [Bruce Morton]
date: 2014-12-16T16:10:34+00:00
dsq_thread_id:
  - 3329883282


---
The [POODLE attack on SSL 3.0][1] has now been extended to some implementations of TLS. POODLE for TLS can be tracked through [CVE-2014-8730][2].

POODLE is not a flaw with the certificate authority (CA), SSL certificates or certificate management system. POODLE is a TLS implementation bug.

[Adam Langley states][3] that &ldquo;TLS&#8217;s padding is a _subset_ of SSLv3&#8217;s padding so, technically, you could use an SSLv3 decoding function with TLS and it would still work fine. It wouldn&#8217;t check the padding bytes but that wouldn&#8217;t cause any problems in normal operation. However, if an SSLv3 decoding function was used with TLS, then the POODLE attack would work, even against TLS connections.&rdquo;

[Ivan Risti&#263; advises][4] &ldquo;The main target are browsers, because the attacker must inject malicious JavaScript to initiate the attack. A successful attack will use about 256 requests to uncover one cookie character, or only 4096 requests for a 16-character cookie. This makes the attack quite practical.&rdquo;

Tests have shown that the [F5][5] and A10 devices are vulnerable to POODLE for TLS. Qualys SSL Labs has extended their [SSL Server Test to cover POODLE for TLS][6], so you can test your site. If the site is vulnerable it will receive an F grade.

Unlike POODLE for SSL 3.0, the industry is not in a position to turn off all of TLS to mitigate POODLE for TLS. As such vendors must patch to mitigate the vulnerability.

 [1]: https://www.entrust.com/poodle-kill-ssl-3-0/
 [2]: https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2014-8730
 [3]: https://www.imperialviolet.org/2014/12/08/poodleagain.html
 [4]: http://blog.ivanristic.com/2014/12/poodle-bites-tls.html
 [5]: https://support.f5.com/kb/en-us/solutions/public/15000/800/sol15882.html
 [6]: https://www.ssllabs.com/ssltest/index.html