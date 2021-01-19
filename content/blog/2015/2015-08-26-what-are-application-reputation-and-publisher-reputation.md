---
title: What Are “Application Reputation” and “Publisher Reputation”?
authors: [Ben Wilson]
date: 2015-08-27T02:13:49+00:00
dsq_thread_id:
  - 4070477842


---
As one dog says to the other in Peter Steiner&#8217;s classic New Yorker cartoon&#8211; &#8220;On the Internet, nobody knows you&#8217;re a dog.&#8221;

Software downloaded from the Internet is similar to people on the Internet&#8211;it is hard to tell which ones are dogs&#8211;without help, which is what &#8220;application reputation&#8221; technology provides.    &#8220;Application reputation&#8221; and “publisher reputation” are methods employed by Microsoft&#8217;s SmartScreen and other systems to distinguish good software from bad software as it is downloaded from the Internet.  Reputation works similar to the way that we develop trust in other people&#8211; we study them over the course of multiple encounters or, if we don&#8217;t have prior experience with them, then we rely on others for information about reputation.

One way to tell if an application has a bad reputation is to check whether its fingerprint is on a blacklist.  Just like the FBI, most anti-virus (AV) systems maintain databases of fingerprints belonging to malicious software.  Whenever a new bad actor appears, its fingerprint is added to the AV database.  This works in most cases.  However, just like in the movies, some bad actors change their faces and fingerprints to escape detection.  How do they do this?  They make a slight change or variation in code in order to hide it from AV programs.  Some of these are referred to as &#8220;polymorphic&#8221;, meaning that they can change their appearance in multiple ways.  Just like a mutating virus, each time they run, they can potentially spawn into up to a million different varieties.  Thus, blacklisting bad code quickly becomes a losing battle for polymorphic malware.

A whitelist is another technique for determining application reputation.   Well-known code that has proven itself harmless over the years can be whitelisted.  When known software with a good reputation tries to install or run on a machine where it has been whitelisted, the system can allow it.  But what about new software?  How do these application reputation systems identify whether new software is good or bad?

SmartScreen&#8217;s Application Reputation engine looks at whether the software has been blacklisted or whitelisted.  It evaluates whether the software has been previously encountered by checking a large database of code that has been encountered using telemetry enabled on Windows machines.  New, not-before-seen code will prompt an alert to the end user that the software has not established a reputation (i.e. not commonly downloaded from the Internet).  A similar warning appears if the software has been signed with a code signing certificate, but the author or publisher has not yet established a reputation of trust.  This latter concept is known as “publisher reputation.”  As a software publisher gains better reputation, the likelihood of a warning diminishes.   Application reputation for unsigned software is based on fingerprints while publisher reputation is based on signed software associated with a code signing certificate.

## How Do Publicly Trusted Code Signing Certificates Enable Publisher Reputation?

One software publisher with a code signing certificate can digitally sign hundreds if not thousands of pieces of malware, so whitelists and blacklists can only go so far.  Digital certificates can be revoked when signed malware is discovered, but how do they enable publisher reputation.  Without getting into too much detail, the &#8220;subject name&#8221; in a code signing certificate identifies the Trusted Publisher of software that has been digitally signed.    For an illustration of this, if a code signing certificate happens to have been saved on your Windows computer, then you can examine it by looking under &#8220;Trusted Publishers&#8221; in your certificate store.   The name of a software publisher is listed in the &#8220;Subject&#8221; field of the certificate    Publisher reputation systems use this certificate information to track the reputation of trusted publishers and the CAs that issue code signing certificates.   Previously unknown publishers have zero reputation, while consistently good publishers can have a good reputation, based on prior history.   CAs also earn reputation based on how well they do in screening out malware publishers to prevent them from obtaining code signing certificates.

## Some Final Thoughts

In the short format of this blog post I haven&#8217;t had the time or space to address all aspects of application reputation and publisher reputation, so here are some final thoughts:

  * No single technology or strategy can provide 100% security, but your security should be based on the concept of “defense in depth”
  * While code signing certificates, application reputation, and publisher reputation help screen out bad actors, they don’t mean that any given publisher is trustworthy, honest, reputable in its business dealings, complies with the law, or is otherwise “safe”
  * Your ultimate protection from risk associated with downloading and installing malware depends on you

Hopefully this post has provided you with a little bit of information about code signing certificates, application reputation, and publisher reputation, which are just a few of many ways that CAs and application software providers are improving Internet security.

Read more about the topic here:

[https://wiki.mozilla.org/Security/Features/Application\_Reputation\_Design_Doc][1]

[http://static.googleusercontent.com/media/research.google.com/en//pubs/archive/42546.pdf][2]

<http://blogs.msdn.com/b/ie/archive/2011/03/22/smartscreen-174-application-reputation-building-reputation.aspx>

<http://blogs.msdn.com/b/ie/archive/2012/08/14/microsoft-smartscreen-amp-extended-validation-ev-code-signing-certificates.aspx>

 [1]: https://wiki.mozilla.org/Security/Features/Application_Reputation_Design_Doc
 [2]: http://static.googleusercontent.com/media/research.google.com/en/pubs/archive/42546.pdf