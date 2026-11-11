# Somatiq public-site reference audit

Audit date: 22 October 2026. Target: the publicly reachable marketing site and the unauthenticated RIS login page that the marketing site opens. This is a reference for PACSD. It is not a reconstruction of Somatiq, and it does not describe authenticated product behavior.

## How this was observed

REA MCP tools were not connected in this agent session. `rea-agents@6.7.0 doctor --client cursor --json` reported `healthy: false` and `environment_healthy: false`.

- Node.js on this machine is v22.17.1. REA classified that runtime as `missing_dependency` because this package requires Node.js 22.x at or above 22.19, 24.x at or above 24.11, or 26+.
- Cursor registration in `C:\Users\Deepak\.cursor\mcp.json` is present and marked `stale`. The registered command is `cmd /c npx -y rea-agents mcp` with an unpinned package reference. Doctor's remediation is to run `rea setup` and restart the client. Setup was not applied. It would rewrite client registration, and a Node.js upgrade is outside REA setup.
- Native engines (Hopper, Ghidra, IDA, JADX, Kuna) are not configured. They are not required for this website inspection.
- The installed skill version is 42, which doctor reported as aligned with the CLI package.

The inspection used the REA CLI command `capture-browser-scenario` from package 6.7.0. Each run launched the local Chrome executable in headless mode, owned a temporary profile, and reported `cleanup: terminated-owned-process`. The browser product was Chromium 155.0.8059.86. The viewport was 1440 by 900 CSS pixels, locale `en-US`, timezone `Asia/Kolkata`, color scheme `light`, service workers `block`. Network capture kept request URLs and resource types only. Request bodies, response bodies, and header values were not requested. No credentials were entered. No form was submitted.

Screenshots show the visible viewport, not a full-page render. Accessibility trees include content below the fold. Where those two disagree about what was on screen, both are reported.

| Capture | Evidence ID | Final URL | Completeness |
| --- | --- | --- | --- |
| Homepage settle | `ev_66fcc40c02b1fed021bc997ef075d29ea449e09a19786d930b5848dcf361b3cc` | `https://somatiq.ai/` | complete |
| Public routes | `ev_84daf86306dc0a2489b225eae8c45066e60bc1295bd39fedbd5e76a08273dadb` | `https://somatiq.ai/privacy-policy` | incomplete: `missing_sections: ["events"]` |
| Portfolio and Explore clicks | `ev_0dfdce4c395771c2b6dbf96ae677f59078567296d7d154e9675f1bcc422ce2f6` | `https://somatiq.ai/` | complete |
| Login button click | `ev_cb0385a9399a94c24fbd9fcb8648174ebdf683c0a53e82219a60bdbb6eedc11b` | `https://somatiq.ai/` | complete |
| RadLinQ route | `ev_1b56f04003e18d0ce69077cbedf7828cac2570528d4bf43f00c9274dc7ad7480` | `https://somatiq.ai/portfolio/radlinq` | complete |
| Public RIS login | `ev_8f8282bf33948d84c0d9b926ed6e458dc05d48ddaae3392d18f39747b8e5ed1e` | `https://ris.somatiq.ai/login` | complete |

Provider limitations that apply to every capture:

- Artifact identity is unavailable.
- Event order is provider receipt order. It does not prove which script caused a request.
- Some network requests in the multi-page capture had not finished when the capture ended, so that event section is incomplete. Later requests are unknown.
- Browser host platform and architecture were not observed.
- Storage values were not requested.

## Access limitations

These items were not observed and are not inferred:

- Authenticated RIS, PACS, worklist, viewer, or reporting screens.
- Somatiq source code, private APIs, response bodies, or credentials.
- Whether demo, signup, sample-report, or login forms succeed.
- Behavior of `https://radone.somatiq.ai/signup` and `https://radone.somatiq.ai/contact-us`. Those URLs appeared as links and were not opened.
- Annual RadOne prices. The Monthly control was in the pressed state. Annual was not clicked.
- Individual REPORTING, VIEWER, and ACCESS cards. They were present. They were not clicked separately.
- The marketing-page Assign and View Details buttons. They were not clicked.
- The SCHEDULE A DEMO button's click target. The footer link "Contact Us" points at `/book-a-demo`, and that URL was opened directly. The hero button itself was not activated.
- Cookie, local storage, and session storage contents.
- JavaScript source. Script URLs were recorded. The files were not downloaded or analyzed.

## Page structure and navigation

The marketing origin is `https://somatiq.ai`. Every captured marketing page used the same landmarks: a `navigation` bar, a `main` region, and a `contentinfo` footer. The footer repeats a mission heading, product links, company links, careers links, contact links, the text "Bengaluru, India", a 2026 copyright line for Somatiq AI Labs Private Limited, and a legal navigation group.

Header controls observed on marketing pages:

| Control | Kind | Destination observed |
| --- | --- | --- |
| Somatiq Logo | link | `/` |
| Platform | link | `/` |
| Portfolio | button | Opens an in-page menu. The address stayed `https://somatiq.ai/`. |
| Teleradiology | link | `/teleradiology` |
| About Us | link | `/about` |
| Careers | link | `/careers` |
| Blog | link | `/blog` |
| Login to RIS | button | Does not change the marketing page URL. It opened a popup, and the network log then requested `https://ris.somatiq.ai/`. |

Portfolio menu links observed after the Portfolio click:

| Link name | URL |
| --- | --- |
| Platform Unified RIS, PACS, and Reporting | `/` |
| RadOne Independent reporting module | `/portfolio/radone` |
| RadLinQ Teleradiology software | `/portfolio/radlinq` |
| InvoiceIQ Smart healthcare billing | `/portfolio/invoiceiq` |

Footer product links match that set, except RadLinQ is not repeated in the footer. The footer uses "Radone Reporting" and "Billing System" for the RadOne and InvoiceIQ routes. Company links include About Us, Our Team (`/about#team`), Blog, and `https://www.linkedin.com/company/somatiqai/`. Careers links include Open Positions (`/careers`), Why Somatiq? (`/`), and `mailto:hr@somatiq.ai`. Contact links include `mailto:contact@somatiq.ai` and Contact Us (`/book-a-demo`).

Public routes opened directly and their level-1 headings:

| URL | Heading | What the page contained |
| --- | --- | --- |
| `/` | One Intelligent Platform for Modern Radiology. | Marketing sections described below. |
| `/teleradiology` | Every Report. Expert Eyes. | Modality list, quality claims, three-step workflow, sample-report mail link. |
| `/portfolio/radone` | Your PACS editor was never built for thinking. | AI reporting marketing, pricing controls, external RadOne links. |
| `/portfolio/invoiceiq` | InvoiceIQ | "Coming Soon" plus one billing sentence. |
| `/portfolio/radlinq` | RadLinQ | "Coming Soon" plus one teleradiology-software sentence. Document title in an analytics URL was `RadLinQ Teleradiology Software Preview \| Somatiq`. |
| `/about` | Why We Built SOMATIQ | Mission copy, two named leadership cards, demo button. |
| `/book-a-demo` | Experience the future of radiology | Demo request form. Not submitted. |
| `/blog` | Our Blog | "Coming Soon". |
| `/careers` | Build the Future of Radiology | Four hiring themes and an email contact. No job listings were in the accessibility tree. |
| `/terms-and-conditions` | Terms and Conditions | Section headings, including one about AI output. Clause text was not reviewed. |
| `/privacy-policy` | Privacy Policy | Section headings for collection, use, retention, security, and rights. Clause text was not reviewed. |

## Visual design that was actually on screen

Homepage hero screenshot (`c0bd19e0a2bd8f20cdb2c96dccaf109999cf076989972f01c9b7a4c680b5beb4`):

- Black header with a blue-and-white SOMATIQ wordmark at the left.
- White navigation labels. Portfolio has a dropdown chevron. "Login to RIS" is a dark rounded button.
- Hero background is black with a blue glow on the left.
- A pill reads "Trusted by Bengaluru's largest imaging chain".
- The headline is white, with the word "Intelligent" in a blue gradient.
- Subcopy: "RIS, PACS, and Reporting — Unified." and "So radiologists can focus on diagnosis, not software."
- Two buttons: filled blue "SCHEDULE A DEMO" and outlined "EXPLORE PLATFORM >>".

Clicking "Explore platform" left the address at `https://somatiq.ai/` and moved the viewport to the next section. That screenshot (`6f7ab2042030b35df33affa7506189551507cc42bb898cf0da4f765a1303cd02`) shows:

- A blue dot and the label "For Radiologists".
- Headline "Dictate. Review. Sign off." with "Sign off." in blue.
- Three stacked dark cards labeled REPORTING, VIEWER, and ACCESS.
- A monitor illustration of a dark reporting screen. The text inside that illustration is part of the marketing image. It was not an interactive report, and it was not readable as a verified workflow in the accessibility tree.

The accessibility name of the same headline is duplicated ("Dictate. Dictate. Review. Review. Sign off. Sign off."), which is consistent with a visual treatment that repeats words for styling. The accessible card titles are "Less typing. AI", "Zero install.", and "No boundaries."

The rest of the homepage was present in the accessibility tree and was below the 900-pixel viewport, so its colors were not captured in a screenshot.

## Frontend behavior that was exercised

- Direct navigation to the routes above completed. Each `goto` step status was `completed`, and the after-URL matched the requested path.
- Portfolio is a button, not a link. After the click, four additional links appeared and the URL did not change.
- Explore platform is a button. After the click, the viewport showed the radiologist section and the URL did not change. By the final screenshot the portfolio menu was no longer expanded.
- Login to RIS is a button. The marketing URL stayed `https://somatiq.ai/`. The event list recorded `popup-opened` and then document and asset requests to `https://ris.somatiq.ai/`, including paths whose filenames contain `react-vendor`, `collab`, `tiptap`, `login_placeholder`, and `symbol_text`. The popup document's accessibility tree was not captured in that scenario. A separate direct navigation to `https://ris.somatiq.ai/` ended at `https://ris.somatiq.ai/login`.
- The login page accessibility tree contains a logo image, the text "LOG IN", textboxes named "Email or User ID" and "Password", an unlabeled button, a "Forgot Password?" link to `/forgot-password`, a "Get Started" button, and an image named "Login". The form was not submitted. `/forgot-password` was not opened. No authenticated screen was observed.
- Marketing pages requested `somatiq.ai`, `challenges.cloudflare.com`, Google font hosts, `www.googletagmanager.com`, `analytics.google.com`, `stats.g.doubleclick.net`, and Google search hosts. The multi-page event list is incomplete, so this host list is not a full inventory.
- The public login origin requested `ris.somatiq.ai`, Google font hosts, and `cdn.jsdelivr.net`. No other API host was in that capture's host list. Response bodies were not read, so bundle contents are unknown.
- Homepage counters in the accessibility tree were the literal strings `0+` scans processed, `0.0%` uptime, and `0+` active radiologists. The teleradiology page contained the literal text `0%`, `24/7 Availability`, and `<0min Emergency TAT`. These were captured as page text. They are not treated as measured operating statistics.
- The same homepage tree contains an administrator illustration with the literals "847 scans today", "Site A 312", "Site B 289", "Site C 146", TAT lines for CT, MRI, X-Ray, and USG, and the counts 124 Booked, 98 Acquired, 12 Reporting, 86 Finalized. No administrator session was opened. This is public page copy.

## RIS and PACS workflows described by the website

The homepage describes one platform that combines RIS, PACS, and reporting. That description is marketing text.

The administrator section says the product tracks daily scan volume, radiologist turnaround time, and SLA breaches. The illustrated statuses are Booked, Acquired, Reporting, and Finalized, and a nearby label says "Studies booked Acquired In-Reporting Finalized". Alert lines mention an emergency worklist, a CT scanner queue near an SLA threshold, and a preliminary report awaiting sign-off. Buttons labeled Assign and View Details are visible in the accessibility tree. Their actions were not run.

The teleradiology page describes this sequence in its own words:

1. Connect: integrate with an existing PACS/RIS without hardware changes.
2. Route: send cases to subspecialty radiologists using the customer's rules.
3. Report: deliver reports back into the customer's system.

Modalities named on that page: CT, MRI, X-Ray, PET-CT, and Mammo. Quality headings: Subspecialty Match, Fast & Accurate, Peer Review, and Direct Access. A "REQUEST SAMPLE REPORTS" link is a `mailto:contact@somatiq.ai` link. No sample report was requested.

RadLinQ is labeled "Teleradiology software" in the portfolio menu. Its public page says "Coming Soon" and describes managing workflows, connecting with imaging centers, and delivering reports. No RadLinQ application UI was present.

InvoiceIQ is labeled "Smart healthcare billing". Its public page says "Coming Soon" and describes invoicing, payment tracking, and financial operations. No billing UI was present.

The platform overview and the RIS application are different origins. Only the unauthenticated login form was observed on `ris.somatiq.ai`. Worklists, orders, image display, and report signing inside that application were not observed.

## Dashboard, worklists, reporting, and patient sharing

Observed as public marketing copy, not as a working application:

- Worklist: "Your worklist follows you everywhere." An alert line says "2 emergency cases pending in worklist."
- Dashboard-style blocks: multi-site scan volume, reporting TAT, today's SLA compliance, actionable alerts, and workflow status. These sit under "For Administrators" and "Decide with clarity."
- Reporting: "Dictate naturally. Create flawless reports." and the radiologist sequence "Dictate. Review. Sign off."
- Patient sharing, under "Patients love it.": instant report access on any device, AI-powered explanations of findings, one-click sharing with doctors, and a lifetime health record. The page says sharing does not require CDs or printouts. No share control was operated, and no patient portal was opened.
- A patient-portal image is named "Patient Portal" in the accessibility tree. It was below the captured viewport.

No real worklist row, patient record, or shared report was retrieved.

## AI-assisted reporting and voice dictation

The RadOne page at `/portfolio/radone` is the only page that describes this in detail. Observed statements:

- RadOne is a standalone browser reporting environment used beside a viewer.
- The stated steps are: open it next to a PACS, dictate or type observations, then copy the finished report into any RIS or PACS.
- Feature labels on the page: Voice input, Auto-structure, AI assistant, Differential generation, and Copy-to-any-RIS export.
- Example prompts are printed on the page, including questions about differentials, clinical history, a shorter impression, and critical findings. They are static text. No prompt was submitted and no model response was observed.
- The page says no installation and no integration are required.
- Pricing controls show Pro at `1,800 / mo*` with 100 credits per day, Max at `3,600 / mo*` with 300 credits per day, and Enterprise as "Custom". Both paid figures include the note "*GST extra". The currency glyph in the accessibility text was not preserved as a reliable character in the capture export. Monthly was pressed. A line says "Save 20% annually". Annual prices were not displayed because that button was not clicked. A line says "7-day free trial" and "*No credit card required".
- External links: `https://radone.somatiq.ai/contact-us` and `https://radone.somatiq.ai/signup`. Not opened.

The homepage reporting card also says "Less typing. AI" and "Dictate naturally." The terms page has a heading "Intellectual Property & Use of AI Output". The heading was observed. The clause was not reviewed.

Voice dictation and AI report generation were not executed.

## Multi-facility administration and teleradiology

Observed marketing statements:

- Homepage administrator copy shows three sites in one scan-volume block (Site A, Site B, Site C) and says operators can track volume, TAT, and SLA breaches.
- Testimonial cards name Dr. Gururaj Rao (Prima Diagnostics), Dr. Murali Nadig (NewMedd Diagnostics), Saketh (TX Biomarker), and Dr. Amarnath Reddy (OM Diagnostics). The cards discuss more than one center, Bengaluru and Mysore, cross-border reading, and remote reading during a radiologist shortage. The long quotations are marketing text. They were not checked against a product.
- The about page names Dr. Vishwanath R S as Co-Founder and CEO and Naveen K as Co-Founder and Chief of AI, and it links to NVIDIA Inception. Those are public biography statements.
- Teleradiology is both a marketing page and a portfolio item (RadLinQ). The service page describes subspecialty routing into an existing PACS/RIS. The software page is a coming-soon preview.
- Security headings on the homepage: HIPAA Compliant, ISO 27001, NABH Ready, Role-Based Access, and 24/7 Support. These are claims on the page. Certificates, policies, and permission screens were not inspected.

No facility-administration screen was opened.

## Observed directly versus still unverified

Observed directly:

- Marketing information architecture, header, footer, and the routes listed above.
- Portfolio menu contents and the Explore platform scroll.
- Login opening a separate `ris.somatiq.ai` page whose unauthenticated form asks for an email or user ID and a password.
- Coming-soon states for Blog, InvoiceIQ, and RadLinQ.
- RadOne's public description of voice, structuring, and copy-out reporting, including the monthly prices that were on screen.
- The demo form's field names.
- Third-party hosts used by the public pages, with the incomplete-event limitation on the multi-page run.

Needs further verification before it can be treated as product behavior:

- Any screen after "Get Started" or "Forgot Password?".
- Whether the illustrated dashboard, worklist, viewer (MPR, MIP, 3D), or patient portal exists in the logged-in product.
- DICOM, HL7, PACS integration, peer review, and automatic routing. They are described. They were not seen running.
- AI output quality, voice recognition, credit accounting, and the 7-day trial.
- Form delivery for the demo request and the sample-report email.
- Compliance certifications and role-based permission behavior.
- Annual prices, RadOne signup, and RadOne contact flow.
- Contents of the JavaScript bundles. Filenames are not feature proof.
