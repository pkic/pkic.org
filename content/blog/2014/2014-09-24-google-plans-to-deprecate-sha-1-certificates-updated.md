---
title: Google Plans to Deprecate SHA-1 Certificates – Updated
authors: [CA Security Council]
date: 2014-09-24T18:26:09+00:00
dsq_thread_id:
  - 3050286741
tags: [Google, SHA1]

---
{{< figure src="/uploads/2014/09/sha1-certificates.png" >}}

UPDATED September 23, 2014: The following blog post has been updated with action taken in recent weeks, as well as to reflect helpful user comments left on our [August 28 blog post][1] on this topic.

On August 19, [Google announced a new policy][2] that accelerates the deprecation of SHA-1 certificates, potentially causing websites using SHA-1 certificates to display warnings in the near future. While keeping with an earlier Microsoft announcement to accept SHA-1 certificates with an expiration date before Jan. 1, 2017, the Google policy will provide new &ldquo;untrusted&rdquo; warnings in regards to such certificates as early as this November.

Beginning with the release of Chrome 39, expected to be stable by this November, and then with Chrome 40 and 41 releases beginning after the holidays, sites using SHA-1 certificates will display the following &ldquo;untrusted&rdquo; warnings.

  * Chrome 39 &ndash; stable by November 2014 
      * SHA-1 certs expiring Jan 1, 2017 or later receive yellow triangle warning to indicate, per Google, a &ldquo;secure, but with minor errors&rdquo; site
  * Chrome 40 &ndash; stable in December 2014 
      * SHA-1 certs expiring between June 1, 2016-December 31, 2016 receive yellow triangle warning
      * SHA-1 certs expiring after Jan 1, 2017 receive neutral warning (shows https in grey instead of green, indicating, per Google, a &ldquo;neutral, lacking security&rdquo; site)
  * Chrome 41 &ndash; stable in Q1 2015 
      * SHA-1 certs expiring Jan 1, 2016-Dec 31, 2016 receive yellow triangle warning
      * SHA-1 certs expiring Jan 1, 2017 or later receive red strike-through warning to indicate, per Google, an &ldquo;affirmatively insecure&rdquo; site

A detailed explanation of Google&rsquo;s plans and related UI downgrades is available on [the official Chromium blog][3].

Although the CA Security Council (CASC), comprised of the seven largest Certificate Authorities, supports migration to SHA-2, members are concerned about the impact on website users and administrators alike. Considering many users may still use software and devices (such as feature phones) lacking SHA-2 support, and the still unknown impact on a complete SHA-1 migration, this 12-week timeline is aggressive. In addition to leading to some confusing &ldquo;untrusted&rdquo; experiences for users, these changes could lead many website operators to either risk their users receiving &ldquo;untrusted&rdquo; warnings or try to quickly make unplanned and possibly expensive upgrades that they otherwise may have intended to make in 2015 or beyond.

With fall shopping season nearly here, this policy may be particularly concerning for small internet stores, which could be impacted just before the holiday rush. Because many large sites have lockdown periods leading up to the end of the year, Companies that have not transitioned may find themselves restricted from making the move until January, or beyond, due to lack of SHA-2 support. Although a migration to SHA-2 is necessary as computing power increases, because of the significant impact in migration and the lack of a currently known practical attack, the CASC members recommend that UI treatments be consistent with the [timelines announced by Microsoft][4] in November 2013, which deprecate SHA-1 in code signing certificates by January 1, 2016 and in SSL certificates by January 1, 2017.

To avoid warnings, the CASC recommends that all website operators accelerate their SHA-2 deployment where possible. All major CAs support SHA-2 hashes and are able to handle the demand of web administrators who are able and ready to make the transition. Another option for those unable to make the migration currently is to ensure that all SHA-1 certificates have a &ldquo;notAfter&rdquo; date of 2015-12-31 or earlier. This will avoid all browser warnings and give site operators a year to make the transition. 

The CASC still urges Google to consider the circumstances of website operators and adjust its UI degradation implementation timelines to match the January 1, 2017 SHA-1 deprecation dates, though Google has not indicated any change in its position in recent weeks. CASC members remain committed to helping their customers fully migrate to SHA-2 as needed to support the customer&rsquo;s operations.

 [1]: https://casecurity.org/2014/08/28/google-plans-to-deprecate-sha-1-certificates/
 [2]: https://groups.google.com/a/chromium.org/d/msg/security-dev/2-R4XziFc7A/NDI8cOwMGRQJ
 [3]: http://blog.chromium.org/2014/09/gradually-sunsetting-sha-1.html
 [4]: https://casecurity.org/2014/01/30/why-we-need-to-move-to-sha-2/