# Rights Desk — Devpost submission draft

Prepared November 5, 2026. This is a local writing and recording packet. Replace the repository and video fields with verified public URLs after publication. Confirm every claim against the final working build before submitting.

Readiness: actual local `gemma3:4b` scope inference passed on November 5 Eastern via `npm run verify:ai`. The PayPal flow has mock regression coverage; real Sandbox approval/capture and the public recording remain pending. Keep this readiness note outside the pasted project description.

## Project name

Rights Desk

## Tagline

From proof to permission to payment for independent creators.

## Description

### Inspiration

A creator who sees their work used elsewhere faces several disconnected tasks: preserve the possible use, find relevant records, understand which permissions matter, and decide whether to offer a license. Rights Desk gives independent U.S. creators a phone-sized workspace for that process.

The project responds to a changing visual economy while respecting uncertainty. A matching image does not establish infringement, a missing record does not make a work free to use, and automated signals cannot certify human authorship.

### What it does

Rights Desk takes one private case from evidence collection to a voluntary paid permission record. The creator uploads a reference image or screenshot, records the work and suspected use, and runs a search of Openverse, Wikimedia Commons, and the Library of Congress. Each report names its coverage, failures, visual leads, and source links.

When the search is incomplete or inconclusive, the app asks for the records the creator can supply: originals, drafts, contracts, licenses, releases, publication history, or registration information. Work type, use channel, and U.S. location shape the checklist and official legal starting points. The location selector covers all 50 states, D.C., and U.S. territories; local prompts indicate where further review is needed.

From the same case, the creator describes a proposed licensed use. A local AI model turns that request into a draft of usage, duration, and territory. The app makes assumptions visible and calculates a suggested price from fixed factors. The creator reviews the exact terms and price before approving a buyer link.

The buyer sees the approved offer while the case evidence stays private. After reviewing the terms, the buyer can approve a PayPal Sandbox payment. Rights Desk verifies the completed capture for the exact offer and amount, then records a scoped license receipt in the creator's case. The creator controls sharing; the app sends no demand or notice automatically.

### How we built it

The application uses Node.js 22, browser JavaScript, HTML, CSS, and a local file store. PayPal REST OAuth and Orders v2 handle Sandbox order creation and capture. The server checks the PayPal order ID, offer reference, capture completion, currency, and amount before issuing a receipt; repeated capture requests return the same receipt.

Ollama runs the configured local model, `gemma3:4b` by default, with structured JSON output to classify licensed-use scope. Fixed pricing factors remain outside the model, and a creator approves the final offer. If the model is unavailable, the interface explicitly labels the rules fallback. Optional local visual search terms support discovery; ImageMagick compares a small sample of public thumbnails with the reference locally. Private images and supporting records are not sent to public catalog providers.

### Challenges we ran into

There is no public database of all licensed works or private permissions. We therefore built a report that says which sources were searched and what remains unknown. Search failures remain visible. The app treats a similarity result as a lead for human review.

We also needed payment to belong to the creator's task. Connecting an offer directly to its case means the same record can hold the creation evidence, approved scope, payment confirmation, and permission receipt. Shared links disclose only the offer fields; the private case image and supporting files stay behind the owner session.

### Accomplishments

The prototype combines a guided first-case tutorial, evidence collection, source-attributed search, U.S. rights prompts, creator-reviewed scope drafts, and case-linked PayPal Sandbox licensing. It retains uncertainty and the creator's decisions throughout that flow.

### What we learned

AI is useful for turning ordinary language into reviewable scope. Evidence, ownership, and permission still require human judgment. A payment becomes more useful when its record is connected to the exact work and terms it covers.

### What's next

Add authenticated creator accounts and backup/recovery, authorized reverse-image providers, improved media comparisons, verified ownership review, broader licensed-source access, and production payment routing with webhooks and dispute handling. Local legal prompts would receive ongoing professional review. These are future work rather than claims about the hackathon build.

## Built with

Node.js 22, JavaScript, HTML, CSS, PayPal Sandbox REST OAuth, PayPal Orders v2, Ollama, Gemma 3, ImageMagick, Openverse API, Wikimedia Commons API, Library of Congress API. Include ExifTool/C2PA only if the final demo environment actually uses them. Disclose AI coding assistance used during development in any form field that asks about it.

## Links to complete

| Field | Final value |
| --- | --- |
| Development repository | https://github.com/JacquelineDMcGraw/rights-desk — private by request; public access remains pending |
| Demo access | Repository setup instructions; hosted URL optional |
| Public YouTube video | Pending actual model and Sandbox recording |
| License | MIT, included at repository root |

## 2:50 phone demo script

| Time | Show | Voiceover |
| --- | --- | --- |
| 0:00–0:15 | Protect opening and an authorized sample work | “A creator sees their work used elsewhere. Rights Desk helps them preserve the facts, understand their options, and offer clear permission.” |
| 0:15–0:40 | Create a private case; briefly show the spotlight guide and saved reference | “I add the work, where I saw it, and the U.S. location. The case keeps the reference and its exact file fingerprint.” |
| 0:40–1:00 | Real search coverage and source links | “This report names the collections checked and any gaps. A visual lead gives me a record to review; it does not decide ownership or infringement.” |
| 1:00–1:20 | Supporting record and tailored checklist | “If search is inconclusive, I collect my originals and permissions. The checklist changes with the work and use, and links to official rights sources.” |
| 1:20–1:45 | Plain-language request, actual AI draft badge, assumptions, creator review | “I can offer permission for a specific use. The local AI drafts scope, fixed rules suggest a price, and I approve the exact terms before sharing.” |
| 1:45–2:05 | Buyer link in another session; limited offer terms | “The buyer sees the approved scope and price. My private evidence stays in the case.” |
| 2:05–2:35 | Actual PayPal Sandbox approval and verified receipt | “PayPal handles the Sandbox payment. Rights Desk checks the completed capture against this offer and amount before issuing the receipt.” |
| 2:35–2:50 | Creator reopens case and sees paid offer and receipt | “Now the case connects proof, permission, and payment in one place. Rights Desk helps independent creators turn a confusing rights question into a documented next step.” |

Preload records where needed for pacing, but show actual working actions and results. Pause recording while typing credentials. Do not insert a mock payment result or describe a rules fallback as model output. The case-offer receipt does not deliver the original media file or settle prior allegations.

## Final entry review

- [x] One actual local draft verified the configured AI model was used; repeat it in the video.
- [ ] One actual PayPal Sandbox approval/capture creates the same offer's receipt.
- [ ] The phone demonstration runs under three minutes and contains only authorized material.
- [ ] Repository and public YouTube URLs are correct and open for judges.
- [ ] Setup instructions reproduce the required model and Sandbox paths without exposing secrets.
- [ ] Submission accurately identifies model, tools, current limitations, and work completed during the hackathon.
- [ ] Jackie reviews the final Devpost entry and any required agreement before submission.

Official requirements checked November 5, 2026: [PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules). Deadline: November 12, 2026, noon Pacific / 3 p.m. Eastern. Keep the functioning build available through the judging period ending December 15, 2026.
