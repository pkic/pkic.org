---
authors:
- Ryan Hurst
date: "2013-11-04T18:00:25+00:00"
dsq_thread_id:
- 1937259999
- General
keywords:
- policy
- ocsp
- revocation
- pki
- crl
- ssl
- microsoft
tags:
- Policy
- OCSP
- Revocation
- PKI
- CRL
- SSL/TLS
- Microsoft
title: Certificate Chains, Key Management and the Number of CAs Counted by Web Crawlers
  – Oh My


---
Have you ever wondered why your web server certificate has a “chain” of other certificates associated with it?

The main reason is so that browsers can tell if your certificate was issued by an organization that has been verified to meet the security, policy and operational practices that all Publicly Trusted Certificate Authorities are mandated to meet. That certificate at the top of the chain is commonly called the “root.” It’s signature on a certificate below it indicates that the organization operating the root believes that practices of the CA below it meets that same high bar.

But why not issue certificates directly off of the “root?” There are a few reasons; the main one is to prevent key compromise. To get a better understanding, it’s useful to know that the private keys associated with the “root” are kept in an offline cryptographic appliance located in a safe, which is located in a vault in a physically secured facility.

These keys are only periodically brought out to ensure the associated cryptographic appliance is still functioning, to issue any associated operational certificates (for example an OCSP responder certificate) that may be needed, and to sign fresh Certificate Revocation Lists (CRLs). This means that for an attacker to gain access to these keys, they would need to gain physical access to this cryptographic appliance as well as the cryptographic tokens and corresponding secrets that are used to authenticate the device. 

CAs do this because keeping keys offline is a great way to reduce the risk of a compromised key, but it’s a poor way to offer a highly available and performant service, so the concept of an Issuing CA (ICA) was introduced. This concept also enabled the “root” to respond to CA key compromise events by revoking a CA certificate that should no longer be trusted. This also enables delegation of control, limiting those who can influence a given ICA to sign something.

Another way CAs solve the “online CA” problem is to use what is commonly referred to as a Policy Certificate Authority (PCA). This model allows a CA to segment operational practices more granularly. For example, maybe the CA is audited to be in compliance with a specific set of government standards so the ICAs associated with those practices would be signed by the corresponding PCA. This not only allows segmentation of policy and procedures, but it also enables separation of usage scenarios. For example, one PCA may only allow issuance of certificates for secure mail while the other PCA may allow issuance of SSL certificates. These PCAs are also very commonly operated as offline entities and have ICAs right underneath them.

While the above two models represent the most common ways a Public Key Infrastructure (PKI) might be segmented, they are not the only two. For example, the operational practices required to be a publicly trusted CA are far stricter than what a typical data center might employ. For this reason, it’s very common for CAs to manage PKIs for other organizations within their facilities.

CAs may also “roll” ICAs as a means to manage CRL size. For example, if a given CA has had to revoke many certificates during its lifespan, it may decide to manage the size of CRLs – it would be appropriate to create a new ICA and take the previous one out of service so that future CRLs can still be downloaded quickly by clients. When this happens both CA certificates may be valid for an overlapping time, but only the more recent one is actively in use.

Long story short, some counts on the number of Certificate Authorities that exist on the internet can be deceiving. One of the easiest ways to see this is to look at a CA called [DFN-Verein](http://blog.bro.org/2012/12/the-tree-of-trust.html). They are an educational PKI that manages all of the CAs in their PKI in the same facilities, using the same practices, but for security reasons they create separate ICAs for each organization in their network.

Simply put, the count of CAs in a PKI is not a good way to assess the number of entities issuing certificates in the PKI ecosystem. What you really want to count is how many facilities manage publicly trusted certificates. The problem is that it is too difficult to count – what you can do, however, is count the number of organizations associated with ownership of each “root.” Thankfully Microsoft makes this fairly easy. In March, I did a post on [my blog](http://unmitigatedrisk.com/?p=320) showing a breakdown of the ownership.

Unfortunately, this approach does not give you a count of operational facilities that are used for the subordinate CAs, but it’s quite likely that given the operational requirements and costs associated with maintaining them that these two numbers are relatively close.

So what would I like for you to take away from this post? I suppose there are two key points:

  * A public CA using several Certificate Authorities under their direct control is actually a good thing as it indicates they are managing the risk of operating their services and planning for migrations to new algorithms and keys as appropriate.
  * Counting the number of “roots” and “subordinate CAs” found by crawling the web does not actually represent the number of organizations that can act as publicly trusted certificate authorities.

That is not to say the efforts to crawl the web to understand how PKI is deployed and used is not valuable, it is – quite valuable. These projects are an important way to keep an eye on the practices that are actually used in the management of Public PKI.

Additionally, efforts to support Least Privilege designs in PKI and adopt means to openly and actively monitor certificate issuance all represent positive moves to help us better understand what is actually out there.