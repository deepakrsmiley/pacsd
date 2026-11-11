# Implementation status

Checked on 22 October 2026 against the empty repository described in `docs/PACSD_GAP_ANALYSIS.md`. The Somatiq comparison is limited to `docs/SOMATIQ_REFERENCE_AUDIT.md`.

## Verified in this session

Server tests: `npm test` passed, 3 tests. They cover permission denial, a synthetic DICOM round trip, login, facility isolation, image storage, pixel readout, report signature, PDF header `%PDF`, AI assist returning 503 when unconfigured, email and WhatsApp returning 503 when unconfigured, an expiring share link, and an audit entry for signature.

Client production build: `npm run build` succeeded after the last UI edit.

Browser check on http://127.0.0.1:5173 with the in-memory seed:

- Sign-in as the demonstration radiologist opened Study Database for GMS North Wing.
- The seeded patient and both studies were listed. Double-click opened the viewer.
- The viewer drew the synthetic 64×64 grayscale frame. Window sliders are on the page. The page states that MPR, MIP, and 3D are not implemented.
- A report was drafted, AI assist returned "AI assist is not configured", and final signature locked the fields.
- A share link opened without a session and showed the signed report, patient, facility, and signer.
- Email sharing returned "Email is not configured" and still issued a link.
- The dashboard showed 1 booked, 1 finalized, a remote-reading count of 1, and a 7-day sign-off time computed from the signed study.

The local API and Vite dev server were left running for that check. The database is in memory, so those records disappear when the API process stops.

## Working without extra accounts

- Session cookie, five roles, facility scope, and audit logging.
- Facilities, users, patients, orders, worklists, assignment, and remote-reading facility.
- Local DICOM part 10 storage and an uncompressed grayscale viewer.
- Report templates, draft, preliminary and final signature, PDF, and expiring share links.
- Settings page shows which integrations are configured, without revealing secrets.
- Charcoal workspace, purple header, and the study-database panes from the supplied screenshot, branded PACSD / Galactic Medical Systems.

## Needs operator configuration

| Capability | What happens now | What you must set |
| --- | --- | --- |
| Durable database | Memory mode only when `ALLOW_MEMORY_DB=true` | `MONGODB_URI` for Atlas. Do not use memory mode for real studies. |
| HTTPS session cookie | `COOKIE_SECURE=false` for local HTTP | `COOKIE_SECURE=true` behind HTTPS |
| Email | API returns 503 | `SMTP_HOST` and related variables |
| WhatsApp Business | API returns 503 | Cloud API token and phone number id. A template, if set, must take patient name and the share URL. Meta can still reject the send. |
| AI assist | API returns 503 | OpenAI-compatible `AI_BASE_URL`. Suggestions are not signed automatically. |
| Orthanc archive | Local disk only | `ORTHANC_URL`. DIMSE and DICOMweb stay on Orthanc. |
| Voice dictation | Button calls the browser Speech Recognition API | A browser that exposes that API. Not tested here. |
| Docker / Orthanc image | Compose file is present | Not started in this session, so the image tag was not verified. |

## Not built

- Patient portal, billing, and MPR/MIP/3D.
- A DICOM listener inside Node. Orthanc is the intended DIMSE endpoint.
- HIPAA, ISO 27001, or NABH certification. Those were marketing claims on the public Somatiq site and were not inspected.
- Authenticated Somatiq behavior. It was not available to REA.

## Dependency note

`npm install` reported advisories, including Multer 1.4.5. The tested upload path uses that release. Moving to Multer 2 is still outstanding.

Demonstration passwords exist only when `SEED_DEMO=true`. Leave that flag unset for a real deployment, and replace `SESSION_SECRET`.
