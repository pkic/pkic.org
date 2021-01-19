---
title: What Are Subordinate CAs and Why Would You Want Your Own?
authors: [Doug Beattie]
date: 2019-06-26T16:04:51+00:00


---
Digital certificate and PKI adoption has changed quite a bit in recent years. Gone are the days where certificates were only synonymous with SSL/TLS; compliance drivers like stronger authentication requirements and digital signature regulations (e.g. [eIDAS][1]) have greatly expanded the role of PKI within the enterprise.

As PKI usage has expanded, conversation has moved beyond just the number and type of certificates needed and onto deeper dialogue about custom PKI deployments. A large part of the conversation is around subordinate CAs, sometimes referred to as Issuing or Intermediate CAs, and why an organization might want their own. Let’s discuss.

## What Are CA Hierarchies and Why Do We Need Them?

Before we get into intermediate / subordinate CAs, it’s probably helpful to do a little refresher on CA hierarchies in general. As we know, CAs are entities that issue digital certificates, but what might be less known is that a CA is actually made up a series of CAs. This CA hierarchy creates a chain of trust that all end entity certificates rely upon.

<figure id="attachment_1917" aria-describedby="caption-attachment-1917" style="width: 1226px" class="wp-caption aligncenter">{{< figure src="/uploads/2019/06/subordinate-cas-1.png" >}}<figcaption id="caption-attachment-1917" class="wp-caption-text">Example CA hierarchies</figcaption></figure>

The number of tiers between the root and the end entity certificates and overall complexity of the hierarchy can vary greatly depending on the environment. For example, some organizations in the IoT and industrial internet space that are building device identity certificates into their manufacturing processes have implemented custom hierarchies involving cross-trust, separate subordinate CAs for each component in the supply chain, location-specific CAs and more. No matter how complex the overall hierarchy though, they are still made up of three main components:

  * **Root CA** – The root CA is the highest level of the hierarchy and serves as the trust anchor. In order for an end entity certificate to be trusted, the root CA it chains up to must be embedded in the operating system, browser, device, or whatever is validating the certificate. Root CAs are heavily secured and kept offline (more on this below).
  * **Subordinate CAs** – These live between the root and end entity certificates and their main purpose is to define and authorize the types of certificates that can be requested from the root CA. For example, on public hierarchies, you must separate SSL and S/MIME Subordinate CAs. Another common scenario is separate Subordinates for different locations or you might have one for certificates with ECC keys and one for RSA keys. 
    **_Note_**_: That there may be one or more subordinate CAs between a root CA and end entity certificates. Subordinates that live between the root CA and another subordinate are sometimes called intermediate CAs (see right-most branch in the diagram above)._</li> 
    
      * **End entity certificates** – These are the certificates installed on servers, machines, cryptographic hardware and devices (e.g. SSL/TLS issued to servers, code signing, client certificates issued to individuals for email encryption, digital signing, authentication). 
        Each entity is signed by the one above it in the hierarchy to create the chain of trust I mentioned before. The root CA is self-signed and signs all subordinate CAs immediately below it. These in turn sign the entities below them, either additional subordinate CAs or the ultimate end entity certificates.</li> </ul> 
        
        You can actually view this hierarchy in action by viewing the details of any certificate. For example, if you go to a website that uses SSL/TLS (look for the HTTPS at the beginning of the address bar) and look at the certificate, you can find the certificate path. In the example below, you can see:
        
          * **The Root CA**– “GlobalSign Root CA – R3”.
          * **Subordinate CA**– “GlobalSign Extended Validation CA – SHA256 – G3”.
          * **End entity certificate**– [globalsign.com][2]
        
        {{< figure src="/uploads/2019/06/subordinate-cas-2.png" title="Example certificate path for publicly trusted SSL/TLS Certificate viewed in Chrome" >}}
        
        ## Why Do We Need CA Hierarchies?
        
        You may be wondering why we need this chain of trust in the first place. After all, any CA in the hierarchy is capable of issuing certificates, so why don’t we just issue right from the root? Why bother maintaining all these separate entities?
        
        This comes down to what happens if a CA is compromised.  This should not be possible with proper controls in place, but in the unfortunate event it does, the CA itself and anything “below” it &#8211; any subordinate CAs and all issued certificates &#8211; have to be revoked. This poses a particularly difficult problem for root CAs because, as the trust anchors, they are the ones that have to be distributed and embedded everywhere. This means in order for any new end entity certificates to be trusted again, you’d have to reapply to individual root programs run by Microsoft, Mozilla, Google, Apple (and the rest), which can be quite the undertaking. If you need that root to be publicly trusted, you’re looking at distributing to every browser, operating system, device, console, email client, application suite, etc. – that’s quite the list! Adding to this is the issue that updating roots that are hard coded into devices or on devices that are not remotely accessibly may be problematic (e.g. point of sale systems, ATMs, networked phones, etc).
        
        For this reason, it’s best practice to issue end entity certificates from the subordinates instead (and for publicly trusted roots, the CA/Browser Forum prohibits issuing from roots entirely). This way in the event of a compromise, you are minimizing what needs to be revoked and ultimately replaced. If one of your subordinate CAs is compromised, you “only” have to revoke it and the certificates underneath. Certificates issued from other subordinates would still be okay and you wouldn’t need to re-distribute your trust anchors (i.e. Root CAs). This is also the reason for the extreme security safeguards put in place around root CAs and why they should be kept offline – if something happens to your root CA, you’re going to have a bad time. They should only be activated when needed to sign a new subordinate or Certificate Revocation List (CRL).
        
        ## Why Would You Want Your Own Subordinate CA?
        
        So, now that you know what subordinate or intermediate CAs are and where they fit into the broader CA architecture, we can now address why organizations might want their own – that is, a dedicated subordinate CA in their name. Here are some of the most common reasons:
        
        ### Client Authentication
        
        Certificate-based client authentication often validates certificates based on subordinate CA. By having an exclusive subordinate CA, you can limit who has certificates that grant access to a system. These subordinate CAs can be private or publicly trusted, depending on the organizations’ needs.
        
        ### SSL Inspection/Decryption
        
        In order for SSL inspection appliances to decrypt and re-encrypt content, it must be able to issue certificates as needed. This means it needs its own subordinate CA and these cannot be publicly trusted.
        
        ### Special Use Case Certificates
        
        Some certificate types, such as SSL/TLS and EV Code Signing, are regulated by CA/Browser Forum Baseline Requirements, which specifies things like validity period and key size. All publicly trusted certificates must adhere to these guidelines. However, certificates issued under private hierarchies are outside the scope of these requirements and can support legacy applications and unique configurations, such as longer validity periods and smaller key sizes.
        
        ### Custom Profiles
        
        You can configure a subordinate CA to meet your specific needs regarding extended key usage, certificate policy, CRL distribution, short-lived certificates and more.
        
        ### Branding
        
        For companies that offer certificates to their end customers or bundle them into their services, having a dedicated subordinate CA in their name can offer some additional branding opportunities. We see this most often with organizations who offer SSL/TLS Certificates to their end customers (e.g. hosting companies, website builders, ecommerce platforms) where having their own publicly trusted subordinate CA means they can provide branded ordering pages and certificates.
        
        ## How to Get Your Own Subordinate CA &#8211; In-House vs. Hosted PKI
        
        If having your own subordinate CA sounds like the answer to your problems, the next logical question is how to get one. For this, like so many [other aspects of technology][3] nowadays, you have the option to build your own or use a SaaS solution.
        
        To be fair, if you need public trust, this debate is kind of irrelevant – you need to work with a public CA. For private use cases though, such as those mentioned above and others unique to the company, running an internal CA is still an option.
        
        ### Why Would You Need to Run Your Own CA?
        
        In the past, it wasn’t that uncommon for big companies to take on PKI themselves, typically by using a Microsoft CA and Certificate Services. In addition to the general goals that apply to most DIY vs SaaS debates, like greater control and security, some of the PKI-specific drivers included:
        
          * The ability to link up with Active Directory to automatically enroll and silently install certificates for all domain-joined users and endpoints – this significantly reduces the amount of time spent managing certificate lifecycles.
          * It’s free – Microsoft CA services are included with Windows Enterprise Server, so you don’t have to pay for individual certificates or any supporting services.
          * They don’t need public trust – following on from the previous bullet, why would a company pay for publicly trusted certificates if they can get non-public certificates for free?
          * Dedicated subordinate CAs – by managing your own PKI, you can create your own subordinate CAs and ensure only your company has access to them.
        
        ### New Services from Third Party CAs Have Made Outsourcing an Option
        
        I specifically said “in the past” above because while there are still many companies running their own internal CAs out there and there are still some valid reasons to do so, many of the above factors are just not that relevant anymore thanks to innovations from public CAs. Integrating with Active Directory, other automation mechanisms, the ability to have your own subordinate CA (publicly trusted or not) – these are now available through many public CAs.
        
        ### The Hidden Costs of Internal PKI
        
        Also, lest you think I’m conveniently forgetting the cost factor and suggesting everyone ignore the fact that Microsoft CAs are free, “free” is not exactly accurate here. While you don’t have to pay for MS CA services or the certificates themselves, there is a lot more that goes into running your own CA, much of which can really drive up the total cost of ownership.
        
        For example, you will need staff to manage the CA and hardware to store your root and signing keys. Keeping in mind that a single hardware security module (HSM) can cost $20k and you’ll need more than one for redundancy, you can see that these hidden costs aren’t trivial.
        
        ### Security and PKI Considerations for Running Your Own CA
        
        Arguably the most important considerations in the in-house vs. hosted PKI debate though, to me at least, are infrastructure security, availability, and keeping up with baseline requirements. If you outsource, all of that falls on the public CA and you can focus instead on your core competencies. If you take it on in-house, you need to consider:
        
          * how you protect and store your offline root,
          * creating and maintaining a CRL and OCSP revocation infrastructure,
          * a disaster recovery plan for restoring operations,
          * lifecycle management policy and procedure to make certain that only authorized users have access, certificates don’t expire, and your hierarchy is properly maintained and
          * how you will meet and maintain compliance with various network requirement audits and root programs (if you need public trust).
        
        All of this is to say, if you want to run your own internal CA, by all means, go ahead! But, be aware of everything involved and know that there are third party CAs that can help you achieve your goals (whether that’s automation, integrating with Active Directory, private hierarchies, custom certificate profiles, hosted revocation services, dedicated Subordinate CAs, etc.) without you having to shoulder the burden of PKI management yourself.
        
        In particular, you should know that if you’re looking into dedicated subordinate CAs (public or private, for any of reasons mentioned above and more), there are hosted options out there! You don’t have to be a PKI expert to use PKI; you just need to know who to talk to.

 [1]: https://www.globalsign.com/en/blog/what-is-eidas/
 [2]: http://www.globalsign.com/
 [3]: https://www.globalsign.com/en/blog/building-digital-signatures-into-document-platforms/