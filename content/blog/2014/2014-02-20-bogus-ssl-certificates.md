---
authors:
- Bruce Morton
date: "2014-02-20T22:30:12+00:00"
dsq_thread_id:
- 2295077894
keywords:
- google
- attack
- mitm
- ssl
- https
tags:
- Google
- Attack
- MITM
- SSL/TLS
title: Bogus SSL Certificates


---
[Netcraft](http://news.netcraft.com/archives/2014/02/12/fake-ssl-certificates-deployed-across-the-internet.html) has published an article stating they have found many bogus SSL certificates. In this case, a bogus certificate is [self-signed](https://casecurity.org/2013/04/02/self-signed-certificates-dont-deliver-trust/) (i.e., not issued from a legitimate certification authority) and replicates an SSL certificate of a large, popular website.

This type of bogus SSL certificate could be used for a [man-in-the-middle (MITM) attack](https://en.wikipedia.org/wiki/Man-in-the-middle_attack). In this scenario, the attacker needs to gain a position that will allow them to intercept traffic and make you to go to their site instead of the real site. This is more likely for public Wi-Fi networks that allow connectivity in airports, cafes and hotels.

Self-signed certificates are not a threat to desktop browsers as they provide a trust dialogue when the certificate is not associated with a trusted root certificate that is embedded in the operating system or browser. The mobile browsers will work in the same way.

There is speculation that the issue is with applications on mobile devices. The Netcraft report references there are studies that show that about 40 percent of these applications do not check the status of the certificates. First, for many application developers, this is arguably legitimate. The application developer wants the app to connect to their service. They are in control of the app and their service, so a self-signed certificate may work in this scenario.

On the other hand, the app might use other services such as PayPal for billing. In this case, the app should verify the certificate properly. This is still a hard attack to pursue. How will the attacker know which bad application you are using and when?

So, what needs to be done?

  * **Browsers** can to continue to check the validity of the certificates and present their trust dialogues.
  * **Mobile operating system vendors** need to check the quality of their applications and only accept those that authenticate certificates properly.
  * **Application vendors** should take the time to check the validity of the certificates. Also implement [public key pinning][1]. Some of the most popular applications (e.g., Twitter, Facebook and Google) use public key pinning, which rejects connections to site with bogus certificates.

 [1]: http://www.entrust.com/public-key-pinning-2/