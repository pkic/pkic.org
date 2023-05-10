---
date: 2022-06-22T8:50:10Z
draft: false
title: Application process to join the PKI Consortium

heroTitle: Application process to join the PKI Consortium
heroDescription: 

heroButton: 
    label: Go to the application form
    link: /join/
---

## Process for Admitting New Members

In order to admit new Members, all membership applications must agree to follow these Bylaws (including the Antitrust Policy), the PKI Consortium Code of Conduct located at https://pkic.org/code-of-conduct and the PKI Consortium Intellectual Property Rights Agreement located at https://pkic.org/ipr.

Applications must be approved by the Executive Council after feedback from the Members. Feedback and approval on a membership application by each Member and the Executive Council shall be based solely on a determination of whether or not the applicant meets the stated membership criteria, and not on any other basis including competitive considerations.

```mermaid
flowchart TD 
    IsOrganization[Do you represent or are you employed by an organization?]
    IsOrganization --> |No| Individual["Apply as individual (category H)"] -->  ApplicationForm
    IsOrganization --> |Yes| IsMember[Check if the organization is an existing member]

    IsMember --> |Not listed as a member| Category
    IsMember --> |Listed as a member| Member["Ask the representative\nof the organization to be added"] --> END
    
    Category[Determine Eligibility Category] --> ApplicationForm

    ApplicationForm[Complete application form]
    ApplicationForm --> Application[Application review]
    Application --> |Questions| Questions[Application on hold until answered] --> Application
    Application --> |Everything looks good| Consultation[Members are asked for any objections]
    Consultation --> EC{Executive Council\nVote}
    EC --> |Not approved| END
    EC --> |Approved| Approved[Membership approved]

    Approved --> Website[Added to website] --> Profile[Create member profile]
    Approved --> MailingList["Added to mailing list(s)"] --> Participate
    Approved --> MeetingInvite["Invited to meetings"] --> Participate
    Approved --> WorkingGroups["Join working groups"] --> Participate
    Participate["Participate in the PKI Consortium"]

    Approved --> Sponsor[Consider to become a sponsor]  
    Sponsor --> SponsorApplicationForm[Complete sponsor application form]

    Questions --> |No answer| END
    END[Application declined]

    click Category "/bylaws/#eligibility"
    click ApplicationForm "/join/"
    click Sponsor "/sponsors/"
    click SponsorApplicationForm "/sponsors/sponsor/"
    click WorkingGroups "/wg/"
    click Profile "https://github.com/pkic/pkic.org#adding-a-new-member"

    class Member,Agreements,Questions,Consultation,EC,MailingList,Website,MeetingInvite grey;
    class END red;
    class ApplicationForm blue;
    class Approved green;
```
