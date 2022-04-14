---
authors:
- Wayne Thayer
date: "2014-07-18T18:20:43+00:00"
dsq_thread_id:
- 2854428591
keywords:
- microsoft
- attack
- tls
- mitm
- iana
- firefox
- ca/browser forum
- icann
- qualified
- ssl
tags:
- Microsoft
- Attack
- SSL/TLS
- MITM
- IANA
- Firefox
- CA/Browser Forum
- ICANN
- Qualified
title: What To Do When You Rely on Internal Names in TLS/SSL Certificates
aliases:
- /2014/07/18/what-to-do-when-you-rely-on-internal-names-in-tlsssl-certificates/

---
A deadline set by the CA/Browser Forum for the use of Internal Names is quickly approaching, and many system administrators need to understand how best to adapt to this change. At the same time, hundreds of new top-level domains are being launched, which redefines what constitutes an Internal Name. In this post we’ll explain what the changes are, why they’re being made, and how you can update your systems in response to the problem.

### Internal Names and gTLDs

An Internal Name is defined as “_A string of characters (not an IP address) in a Common Name or Subject Alternative Name field of a Certificate that cannot be verified as globally unique within the public DNS at the time of certificate issuance because it does not end with a Top Level Domain registered in IANA’s Root Zone Database._” For example, “mail” and “exchange.local” are Internal Names; “casecurity.org” and “paypal.com” are publicly registered names.

Under rules adopted by the CA/Browser forum back in 2011, Certificate Authorities (CAs) may not issue certificates that contain Internal Names and expire after 1 November 2015. Since most CAs sell certificates in 1-year increments, this effectively means that you must stop requesting certificates containing Internal Names from your certificate vendor before 1 November 2014. In addition, CAs must revoke existing certificates containing Internal Names by 1 October 2016.

We previously wrote about the [delegation of new gTLDs by ICANN][1]. To summarize, the CA/Browser Forum has also adopted rules that require CAs to stop treating new top-level domains like ‘.mail’ as Internal Names within 30 days and revoke existing certificates containing these names within 120 days of contract signing with ICANN. With the signature of the contract for ‘.exchange’ on 6 March 2014, one of the most common Internal Names is now past the 120 day mark, requiring CAs to treat it as a registered top-level domain and revoke existing certificates containing names ending in ‘.exchange’.

### Why

The reason for all these rules is fairly simple and explained in greater detail in this CA/Browser Forum [white paper][2]. Internal Names are inherently not unique because they’re not registered with a central authority. Anyone can run a server at <https://mail/>, for example, and prior to these rules, anyone could obtain a certificate for ‘mail’. This enables an attacker to easily acquire a certificate and launch a man-in-the-middle (MITM) attack. Corporate guest Wi-Fi networks are a particularly appealing target for this type of attack because the network is likely to be set up to recognize any Internal Names used by the organization.

In the case of new top-level domains, a similar risk is present because a certificate may have been previously issued for a name that is now registered by a different entity.

### Solutions

In some cases there are no easy solutions to the problems created by a reliance on Internal Names, but there are a few options you can choose:

  1. Reconfigure the system to use a publicly registered domain name
  2. Register the name
  3. Set up an Enterprise CA
  4. Use self-signed certificates

The first option of migrating services to a registered domain name is usually the best and cleanest solution to end reliance on Internal Names in TLS/SSL certificates. As is often the case, this option may require a significant amount of initial effort, but it is almost always achievable. Contrary to what some believe, Microsoft Exchange server can be [reconfigured to use public domain names][3], as can Active Directory networks (refer to this CA/Browser Forum [white paper][2] for more information). The benefit of this approach is that it doesn’t add any ongoing administrative burden once the change is completed – you’ll be able to continue using publicly trusted certificates just like you did before. One concern that is raised with this approach is the potential to publicly expose information about a company’s internal infrastructure via DNS. This risk can be mitigated by using a subdomain like “internal” or a separate domain name and configuring the DNS so that these zones can’t be resolved beyond the company’s networks.

Your second option is to convert the Internal Names you currently rely on to publicly registered names. In theory, names like ‘ford.exchange’ can be registered once the new top-level domain is available for general registration. In practice, this takes longer than the 120 day grace period allowed by the current rules, so you will need to implement a different solution until you can successfully register the domain name. And some new gTLDs are not going to be opened up for registration by the general public.

Moving on to the third option, an “enterprise certificate authority” is software that acts like a publicly trusted CA but is run by or for the organization. These systems can issue certificates containing Internal Names under the condition that the certificates can’t be trusted publicly. This means that the Enterprise CA can’t be configured to sign certificates that chain up to a public CA’s trusted roots, and the certificates issued by the enterprise CA will cause browsers to display nasty warnings to users. The workaround for these error messages is to install the enterprise CA’s private root certificate on the client. Unfortunately, that is a complex process in any heterogeneous environment where multiple browsers (Firefox, Chrome, Internet Explorer), desktop operating systems (Windows, OS X, Linux), and devices (iOS, Android) are in use. Another risk with an enterprise CA is that a compromise of the system leaves the enterprise vulnerable to a MITM attack, so strong security measures should be in place to protect the private keys and applications that can be used to issue certificates.

A final option is to use “self-signed” certificates. This option has similar drawbacks to that of the Enterprise CA, but doesn’t scale well because each individual certificate must be installed on all client devices to avoid error messages in the browser.

In addition to securing browser-based communication, your organization may also use TLS/SSL certificates to secure server-to-server communication. Be sure to check whether such servers currently rely on certificates with Internal Names. If they do, you’ll need to choose one of the above solutions, although it need not be the same solution you choose for browser-to-server traffic.

### Time to Act

With the current wave of new top-level domains and the impending deadlines for Internal Names, now is the time to plan and take action to avoid an interruption in any of your services that currently rely on Internal Names. For more information, we recommend you read this [white paper][2] or contact your CA.

 [1]: https://casecurity.org/2013/12/18/gtld-and-how-this-impacts-your-organization/
 [2]: /uploads/2013/04/Guidance-Deprecated-Internal-Names.pdf
 [3]: http://support.godaddy.com/help/article/6281/reconfiguring-microsoft-exchange-server-to-use-a-fully-qualified-domain-name
