---
authors:
- Bruce Morton
date: "2013-12-16T20:00:27+00:00"
dsq_thread_id:
- 2054334092
keywords:
- pki
- ssl
- code signing
- microsoft
- sha1
- policy
tags:
- PKI
- SSL/TLS
- Code Signing
- Microsoft
- SHA1
- Policy
title: SHA-1 Deprecation, On to SHA-2


---
We have previously reviewed [implementation of SHA-2][1], but with [Bruce Schneier stating the need to migrate away from SHA-1][2] and the [SHA-1 deprecation policy from Microsoft][3], the industry must make more progress in 2014.

Web server administrators will have to make plans to move from SSL and code signing certificates signed with the [SHA-1 hashing algorithm][4] to certificates signed with [SHA-2][5]. This is the result of the new [Microsoft Root Certificate Policy][6] where Microsoft deprecates SHA-1 and imposes the following requirements:

  * Certification Authorities (CAs) must stop issuing new SHA-1 SSL and Code Signing end-entity certificates by January 1, 2016.
  * For SSL certificates, Windows will stop accepting SHA-1 end-entity certificates by January 1, 2017. __$1__
  * For code signing certificates, Windows will stop accepting SHA-1 code signing certificates without time stamps after January 1, 2016. 

The good news is that Windows and Internet Explorer support SHA-2. In fact, new versions of Mac OSX, Firefox, Chrome, Opera, Safari, Java and Adobe Acrobat/Reader all support SHA-2.

The bad news? Some enterprises might be running a non-browser application that does not support SHA-2. If you are unaware, you need to do some investigation or testing to see if your system supports SHA-2 and consider your migration plan.

That said, it is not over. Microsoft plans to review the deadlines in July 2015 and consider whether SHA-1 is still resistant to pre-image attacks and whether a significant portion of the ecosystem is still not capable of switching to SHA-2.

In the short term you will likely see your CA take some action, such as:

  * Re-setting the default signing algorithm from SHA-1 to SHA-2
  * Providing warnings on existing SHA-1 signed certificates that expire after 2016
  * Imposing date restrictions, so you will not have a SHA-1 certificate that is not supported by Windows in 2017
  * Providing advice to time-stamp during code signing

If you perform some testing and find that your application does not support SHA-2, then it would be advisable to inform your CA or Microsoft.

 [1]: https://www.entrust.com/should-you-use-sha-2/
 [2]: https://www.schneier.com/blog/archives/2012/10/when_will_we_se.html
 [3]: https://blogs.technet.com/b/pki/archive/2013/11/12/sha1-deprecation-policy.aspx
 [4]: https://en.wikipedia.org/wiki/SHA-1
 [5]: https://en.wikipedia.org/wiki/SHA-2
 [6]: http://technet.microsoft.com/en-us/security/advisory/2880823