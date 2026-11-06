# Rights Desk verification — November 5, 2026

## Completed locally

- JavaScript syntax checks passed for application, server, scripts, and test modules.
- The case-offer regression suite passed session privacy, versioned acceptance, exact order/currency/amount/reference validation, revocation, expiry, retries, lost-response reconciliation, receipt access, and idempotency. It also verified HTTP 503 with no PayPal credentials. These payment checks use an isolated mock transport.
- The AI scope regression check passed explicit-scope preservation, fixed pricing, and labeled fallback when the model is offline.
- Actual local `gemma3:4b` inference returned `aiMode: "ollama"` for “A one year national editorial article on our magazine website”: editorial, one-year, national, $168.75 from a $75 base, no assumptions, about 3.3 seconds.
- Browser verification exercised a seeded private case, actual AI draft, edited terms, creator review, approval/link creation, limited buyer page, mocked payment return, downloadable receipt control, and the creator's refreshed paid status. Creator and buyer layouts fit a 390px phone viewport without horizontal overflow. No browser console errors were observed.
- The QA fixture used temporary data. The main localhost case list was left empty.
- The Local Host Portal entry remains on port 5188 and now loads an optional private `.env` at launch.
- The Caramel Latte default uses the supplied palette tokens. Browser checks covered Sage, Midnight, High Contrast, default reset, saved selection after reload, keyboard dismissal/focus return, and preservation of unsaved form text while changing palettes. The Settings dialog fits a 390px phone viewport.
- The one-question intake passed skip, Back, review jump links, saved text, pause/reload/resume at the same question, and manual spotlight reveal without losing existing answers. New-case QA used the separate 127.0.0.1 origin and left the user's localhost draft unchanged.
- Saved-case browser QA passed adding a previously skipped registration number, pausing/backing out, reopening the separate edit draft, saving, and verifying the stored value. An unknown likeness answer remained unknown. The saved reference fingerprint stayed unchanged. Automated metadata tests also cover owner-only access, optional clearing, immutable evidence, and original offer/receipt identity after edits.

The screenshot in `license-offer-review.png` shows a synthetic offer review. It does not depict a real PayPal payment.

## Reproduce

```sh
npm run check
npm test
npm run readiness
npm run verify:ai
npm start
```

Start Ollama and make the configured model available before `verify:ai`. Readiness checks availability only and do not claim a provider payment was verified.

## Remaining submission gates

- Configure this project's private PayPal Sandbox app credentials. None were found in the local `.env` or matching secret registry references.
- Approve and capture one actual Sandbox buyer payment, then record that working flow for the public video.
- Approve a public repository destination and publish the sanitized source with its MIT license.
- Record/upload the final video, add its public YouTube URL, and review/submit the Devpost entry.

The development repository is [JacquelineDMcGraw/rights-desk](https://github.com/JacquelineDMcGraw/rights-desk), kept private at the creator's request. Public source access, video, and Devpost entry remain submission gates. See `DEVPOST-SUBMISSION.md` for the prepared description and 2:50 recording script.
