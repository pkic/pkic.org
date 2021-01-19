---
title: What Will Happen With SHA-1 and Browser Users on January 1st, 2016?
authors: [Bruce Morton]
date: 2016-01-05T19:50:25+00:00
dsq_thread_id:
  - 4464620153


---
On January 1, 2016, the public trust certification authorities (CAs) will stop issuing SHA-1 signed SSL/TLS certificates. What will happen?

Will all websites using SHA-1 fail? No. SHA-1 will be supported by browsers and operating systems through 2016. Microsoft and Mozilla have announced that Windows and Firefox will not support SHA-1 in 2017, but no change for 2016. We expect Apple to follow the same protocol.

What about Chrome? Chrome will still provide warning indications in the browser status bar for SHA-1 signed certificates which expire in 2016 and in 2017 or later. No change.

What if you have an operating system or browser which does not support SHA-1? [CloudFlare has reported that SHA-2 is supported by at least 98.31 per cent of browsers][1]; therefore, 1.69 per cent do not support SHA-2. That could be over 37 million people; however, nothing much will change in 2016 for these people either.

The “1.69 per cent” people are already suffering from SHA-1 deprecation. [SSL Pulse][2] indicates in their December 2015 publication that of the top 200,000 sites, 84.1 per cent already support SHA-2. This number will jump by the end of 2015, as some sites are waiting to the deadline to upgrade to SHA-2. This includes the Google sites.

So why will there be no real change for the “1.69 per cent” people? For the most part, these people are using Windows XP SP2 and older versions of Android and Symbian on smartphones.

Windows XP SP2 and some other old operating systems do not support SHA-2, so they have been already impacted by 84.1 per cent of the largest sites. What have they done? Simply, they have installed bowsers which support SHA-2. For instance, [Firefox supports SHA-2 and still supports Windows XP SP2][3]. Some older versions of Opera or Opera mini may also be used. Due to many other security vulnerabilities this is not the best practice, but is the reality if you continue to use unsupported operating systems.

CloudFlare and [Facebook][4] are trying to continue to support SHA-1 certificates and have proposed the adoption of “Legacy Verified (LV) certificates.” This proposal does not appear to have browser or operating vendor support for adoption, so there will likely be no adoption of LV certificates.

The bottom line is SHA-1 is vulnerable. [New studies][5] have shown that the safety factor is decreasing. Continuing to issue SHA-1 signed certificates could compromise a CA or could compromise a legitimate website.

Unfortunately for old browser and operating users, the servers must continue to move to SHA-2 signed certificates. These users should try to move to supported systems.

For server administrators, please continue to move to SHA-2 signed certificates.

 [1]: https://blog.cloudflare.com/sha-1-deprecation-no-browser-left-behind/
 [2]: https://www.trustworthyinternet.org/ssl-pulse/
 [3]: https://www.mozilla.org/en-US/firefox/43.0/system-requirements/
 [4]: https://www.facebook.com/notes/alex-stamos/the-sha-1-sunset/10153782990367929
 [5]: https://www.entrust.com/keep-moving-to-sha-2-leading-browsers-fast-track-sha-1-deprecation/