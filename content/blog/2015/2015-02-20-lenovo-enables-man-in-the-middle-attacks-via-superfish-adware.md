---
authors:
- Doug Beattie
date: "2015-02-20T22:27:36+00:00"
dsq_thread_id:
- 3534027017
- General
keywords:
- malware
- firefox
- mixed content
- ssl
- code signing
- https
- vulnerability
- microsoft
- attack
- mitm
tags:
- Malware
- Firefox
- Mixed Content
- SSL/TLS
- Code Signing
- Vulnerability
- Microsoft
- Attack
- MITM
title: Lenovo Enables Man-in-the-Middle Attacks Via Superfish Adware


---
Lenovo is [selling computers][1] that contain the Superfish application which “supplements” the user’s SSL sessions to enable their adware application to deliver content transparently; however, due to poor security design this leaves users vulnerable to man-in-the-middle attacks.

## How it was supposed to work

Superfish uses the program “Visual Discovery” to process images in browser content and then displays ads for similar goods and services. This sounds like any other adware application, but in order to maintain SSL sessions and not alert users with security warnings, Superfish is serving up these images over https. They were able to do this by creating SSL certificates on the fly that imitate the certificates on the “real” websites they have intercepted and using them in a local SSL proxy to deliver content from the Visual Discovery server over the same apparent domain, without clearly revealing what they have done.  This is a classic “man in the middle” or MITM process.

## How typical MITM attacks work

MITM attacks work by the attacker inserting themselves between the user and the intended web site, <https://www.bank.com> in the example below.  When this happens the user generally has some indication that they are not communicating directly to https://bank.com.  They may:

  * see the URL change to a similar URL, for example <https://www.bank1.com> or
  * receive a mixed content warning indicating some content is not secured, or
  * receive an untrusted certificate warning because the attacker created their own SSL certificate for [www.bank.com][2] without using a trusted root.

{{< figure src="/uploads/2015/02/lenovo1.jpg" >}} 

## How using a compromised root improves effectiveness of MITM attacks

The root certificate and an encrypted version of the root’s private key are included on all of the affected systems – a very bad security practice, as a root’s private key should always be kept secure and offline. It didn’t take long for Rob Graham, CEO of security firm Errata Security, to [crack the password for the private key][3].

Now that the private key is widely available, attackers can generate SSL certificates which are trusted by these Lenovo systems for any site on the internet.  Users will have no indication that they are communicating with an attacker since <https://www.bank.com> could now be using a (fake) SSL certificate that they trust because it appears real. Public Wi-Fi hotspots are an especially easy way for attackers to insert themselves between you and your intended site.

{{< figure src="/uploads/2015/02/lenovo2.jpg" >}} 

## What about code signing attacks?

Since the Superfish root is marked for all key usages, it can also be used to sign and silently install malware on these Lenovo devices.  While no reports of malware have been disclosed, it’s only a matter of time and this makes remediation all that much more urgent.

## How to tell if you’re affected

The scope of the problem, according to Lenovo, is small and should only affect users that purchased [these][4] systems shipped between October and December of 2014, some of which are still [on the shelves][5], as reported by Chris Palmer. However, other reports have surfaced saying that Superfish appeared on some systems as early as [mid-2014][6].

If you have a Lenovo system, start by looking in the Microsoft Root CA key store (in IE go to Tools => Internet options => Content => Certificates => Trusted root certificates) and look for the Superfish CA.  If you see the [Superfish root certificate][5], then you should be concerned and should immediately “Remove” the root.  You can also go [here][7] to test your system.

## How to minimize your security risk

While affected users can uninstall the application or [stop][8] the underlying Windows Service (Visual Discovery) to disable the adware functionality that does not remove the fundamental security issue of trusting the compromised root (See the explanation of possible MITM attacks above).  Lenovo is working on, or may have already delivered a [patch][9] to permanently and thoroughly remove the vulnerability and Micorosft, Google and the other browser vendors are working on updates to blacklist and effectively revoke this root within their browsers. In the mean time you can:

  * Do a windows update, Microsoft may have released a Windows Defender update
  * Uninstall the Superfish application
  * Delete the Superfish root CA from the Microsoft Root keystore.
  * Detailed instructions for removing the application and root certificate can be found [here][7].
  * Consider use Firefox for web browsing. Firefox uses their own key store so the Superfish root is not trusted; however, there have been reports of Firefox users falling victim to this vulnerability as well, according to __Decentralized SSL Observatory,__ so caution is advised.

## Are there other applications using the same toolkits?

The underlying platform used by Superfish to carry out the certificate injection for ad delivery is provided by a company called Komodia (same as the private key password). Komodia’s SDK is [used in other programs][10] beyond Superfish; each has its own private key with the same Komodia password bundled with their product. This raises the question of whether a similar attack could occur in other software like Qustodio, Komodia’s Keep My Family Secure, and Kurupira Webfilter.

## Next steps

If you think you may have been the victim of one of the MITM attacks you should change your passwords for the sites you visited and watch for suspicious behavior against any of your important accounts.

Related articles:

  * <http://www.csoonline.com/article/2886396/malware-cybercrime/lenovo-shipping-laptops-with-pre-installed-adware-that-kills-https.html#tk.rss_all>
  * <https://www.eff.org/deeplinks/2015/02/further-evidence-lenovo-breaking-https-security-its-laptops>
  * <http://blog.erratasec.com/2015/02/extracting-superfish-certificate.html#.VOYJ-C6qH20>
  * <http://thenextweb.com/insider/2015/02/19/lenovo-caught-installing-adware-new-computers/>
  * <http://arstechnica.com/security/2015/02/lenovo-pcs-ship-with-man-in-the-middle-adware-that-breaks-https-connections/>

 [1]: http://news.lenovo.com/article_display.cfm?article_id=1929
 [2]: http://www.bank.com
 [3]: http://blog.erratasec.com/2015/02/extracting-superfish-certificate.html
 [4]: http://news.lenovo.com/article_display.cfm?article_id=1929&AID=10499647&PID=6146953&SID=i6cw12zkkg0000ws01goc&CJURL=http%3A%2F%2Fnews.lenovo.com%2Farticle_display.cfm%3Farticle_id%3D1929&PUBNAME=VigLink&NID=CJ
 [5]: http://arstechnica.com/security/2015/02/lenovo-pcs-ship-with-man-in-the-middle-adware-that-breaks-https-connections/
 [6]: http://www.thestudentroom.co.uk/showthread.php?t=3013039
 [7]: https://filippo.io/Badfish/
 [8]: https://www.youtube.com/watch?v=oMMOPg9DRDc
 [9]: http://www.pcworld.com/article/2886690/lenovo-cto-admits-company-messed-up-and-will-publish-superfish-removal-tool-on-friday.html
 [10]: https://gist.github.com/Wack0/17c56b77a90073be81d3