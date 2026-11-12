# Rights Desk — hackathon pitch

## One-line pitch

**Rights Desk helps independent creators compare existing permissions with proposed uses, approve a clear change, and connect its PayPal payment to the exact permission granted.**

## The opening

A photographer grants a client permission to use three images on its website. The client later asks to run the same images in paid social advertisements. The photographer needs to compare the original permission, clarify the proposed use, decide the additional fee, and record what both sides approved.

Rights Desk keeps those decisions together. The creator supplies the existing permission and a description of the proposed use. Local AI presents possible differences with exact source passages, asks about missing scope, and prepares terms for review. The creator controls the fee and approval; the buyer accepts that exact version and completes PayPal Sandbox checkout. The resulting receipt retains the approved change and its fingerprint, and is available in the case and Records.

## What the product does

1. **Start with the work.** Name the work and medium. The main permission review needs no image upload or location selection. Paste the relevant existing permission and describe the proposed use; optional supporting records remain private.
2. **Compare with evidence.** A local Ollama model compares purpose, channels, duration, and territory. Passages from the original permission and proposed use appear together. The server checks each quotation against its source. Unclear or unsupported findings remain explicitly uncertain.
3. **Clarify calmly.** Missing scope becomes one question at a time. Leave a question for later, go back, or save a draft. Old duration or territory is not silently carried into the proposed use. The model does not set fees or decide infringement.
4. **Approve the exact change.** Review editable purpose, channels, duration, territory, conditions, and a creator-set fee. Confirm authority and inspect the buyer preview. The server stores an immutable snapshot and fingerprint; later comparisons cannot rewrite an approved offer.
5. **Accept and pay.** The buyer sees approved terms, without private source texts or evidence. Checkout requires the accepted terms version and change fingerprint. PayPal confirms the payment; Rights Desk verifies order, offer reference, USD currency, and amount before issuing the receipt in the same case and in Records.

## Demo path

Existing website permission → proposed paid advertising → quote-backed comparison → clarify missing duration and territory → creator-approved change and fee → buyer review → PayPal Sandbox approval → verified receipt with the same change fingerprint.

For learning, the optional guided example uses fictional records and stops before sharing a buyer link or creating a payment. Use a real review with fictional records or an authorized sample to demonstrate the complete payment flow. Show the actual AI badge, a question that matters, the creator's decision, and the real Sandbox result. Keep source search and general rights guidance as optional context outside the central three-minute story.

The permission-change flow completed an actual $25 Sandbox capture on November 5, 2026 Eastern. Its real local AI comparison, creator-approved six-month U.S. paid-Instagram permission, exact buyer acceptance, and identical offer/order/receipt snapshots were verified. See [verification notes](docs/VERIFICATION.md) and the [synthetic provider-payment record](docs/permission-change-verification.json). The public video remains to be recorded.

## Why this fits the hackathon

AI performs a concrete comparison and clarification task before money moves. PayPal completes the approved transaction. The permission-change receipt connects the two: it records what was approved, what was accepted, and what was paid. The mobile flow supports creator control and avoids silently expanding permissions.

The [official judging rules](https://paypalaihackathon.devpost.com/rules), checked November 5, 2026, evaluate implementation, design, impact, innovation, and presentation equally. Category fit is a strategy, not a prediction of a prize. Demonstrate actual creator usefulness and one coherent working path. See [the submission packet](docs/DEVPOST-SUBMISSION.md).

## Image-economy context

On **October 21, 2026**, Getty Images Holdings and several U.S. subsidiaries filed voluntary petitions for a **prepackaged Chapter 11 reorganization**. Getty says the process is intended to reduce debt and address non-operating liabilities while its business and contributor payments continue. The filing is a timely signal that the visual-licensing market is changing; it is **not evidence that generative AI caused Getty's bankruptcy**.[1][2]

The underlying creator problem is clear in Getty's own filings. Its 2025 annual report describes unauthorized use of copyrighted work for AI training and AI images that can substitute for licensed photography as business risks. Getty reported paying more than **$220 million in royalties to contributors in 2025**, underscoring how many livelihoods depend on workable licensing. Its Creative revenue declined **3.6% year over year in the first half of 2026**, though Getty did not attribute that decline to AI.[3][4]


## The honest coverage promise

There is **no single public database of every licensed work or private license**. The Copyright Office's public system contains registration and recordation metadata, not a complete reverse-image corpus, and the Office warns that searchable records can contain gaps and inaccurate applicant-provided information.[5] Openverse indexes openly licensed and public-domain media, not all commercial catalogs; its API is text/metadata search with rate and pagination limits.[6] The Library of Congress and Smithsonian APIs cover their own collections, not the whole market.[7][8] Visual web-match services cover only their indexes: TinEye explicitly says a no-result search means no match *in its index*, not no match on the internet.[9] Commercial catalogs require their own API access and terms; Shutterstock, for example, requires authentication and limits search to the media library allowed by the application's subscription.[10]

Rights Desk should therefore display **“sources searched,” “sources unavailable,” “candidate match,” and “no match found in searched sources”** for every report. A visual match is a lead to review against chain of title and licenses, not proof of ownership, unauthorized use, or AI training.

The prototype uses anonymous browser sessions and self-entered names. It does not verify ownership or buyer identity, contact suspected users, file notices, determine infringement, or settle prior claims. A voluntary offer covers its stated use; the configured Sandbox merchant receives test payments. Production creator payouts, accounts, backup, legal review, and payment webhooks are future work.

## Sources

1. [Getty Images Holdings, Form 8-K, Item 1.03, filed October 21, 2026](https://www.sec.gov/Archives/edgar/data/1898496/000121390026111193/ea0309225-8k_getty.htm).
2. [Getty Images, restructuring announcement, October 21, 2026, filed as SEC exhibit](https://www.sec.gov/Archives/edgar/data/1898496/000121390026111193/ea030922501ex99-2.htm).
3. [Getty Images Holdings, 2025 Form 10-K, AI risk factors and contributor royalties](https://www.sec.gov/Archives/edgar/data/1898496/000162828026018160/gety-20251231.htm).
4. [Getty Images Holdings, second-quarter 2026 Form 10-Q, Creative revenue](https://www.sec.gov/Archives/edgar/data/1898496/000162828026055246/gety-20260630.htm).
5. [U.S. Copyright Office, Copyright Public Records System and its search disclaimer](https://publicrecords.copyright.gov/search?query=VA1310583); [Copyright Office account of CPRS coverage](https://www.copyright.gov/newsnet/2025/1071.html).
6. [Openverse API documentation](https://api.openverse.org/v1/).
7. [Library of Congress, photo collection search API and limits](https://www.loc.gov/apis/json-and-yaml/requests/endpoints/).
8. [Smithsonian Open Access API and rights FAQ](https://www.si.edu/openaccess/faq).
9. [TinEye reverse-search tutorial, including what no result means](https://help.tineye.com/article/265-tineye-tutorial).
10. [Shutterstock API reference, authentication and library access](https://api-reference.shutterstock.com/?language=en).
