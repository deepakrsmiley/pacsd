# PACSD gap analysis

Comparison date: 22 October 2026. The Somatiq side of this comparison is only what `docs/SOMATIQ_REFERENCE_AUDIT.md` records from public pages. Authenticated Somatiq behavior is a gap in the evidence, not a feature list.

## Repository at inspection

`C:\Users\Deepak\Desktop\PACSD` contained no files. There was no `package.json`, no client, no server, no MongoDB models, no DICOM code, no tests, and no git history in the workspace. There is no existing implementation in this repository to preserve.

The only local product artifact is the desktop screenshot `C:\Users\Deepak\Desktop\Capture.JPG`, captured outside the repository. It shows a dark charcoal workspace with a purple header and purple accents. The visible shell is labeled IntelPACS, facility "GMS North Wing", user "Dr. Kavita Menon". Navigation groups are Workspace (Study Database, Worklists, My Worklist, Clinical Review, Dashboard), Clinical (Radiology Reports), and Administration (Audit Logs, Settings). The main view is a three-pane Study Database (Patients, Studies, Series) with search text "Patient, MRN, accession", an "All modalities" filter, and an "Open viewer" button. A banner says the archive API is not running and that the worklist stays empty until it answers. A footer hint says DICOM files can be dragged in to store them. That screenshot is a layout reference. It is not running code, and the archive message says the API was down when the picture was taken.

PACSD for Galactic Medical Systems therefore starts from an empty repository. The build should keep that shell's task layout and palette, under original PACSD branding, and should not copy Somatiq pages, assets, or private interfaces.

## Missing against the empty repository

Everything below was absent at inspection.

| Area | Somatiq public description | Screenshot shell | Repository |
| --- | --- | --- | --- |
| Marketing site | Present on somatiq.ai | Not shown | Absent |
| Login | Public form on ris.somatiq.ai | A signed-in name is shown. The login screen itself is not in the picture. | Absent |
| Roles and permissions | Claimed as "Role-Based Access". No permission UI was opened. | Not shown | Absent |
| Facilities | Multi-site volume is marketing copy. No admin UI was opened. | One facility name is shown. | Absent |
| Patient and order entry | RIS is named, not shown. | Empty patient pane. | Absent |
| Worklists | Described, including emergency items. | Nav items exist. Content is empty because the archive was down. | Absent |
| Dashboard, TAT, SLA | Illustrated with static figures. | Nav item exists. Screen not shown. | Absent |
| DICOM archive and viewer | "Zero install" viewer with MPR, MIP, and 3D is a claim. | Drag target and Open viewer button. API reported down. | Absent |
| Reporting and sign-off | Dictate, review, sign off. | Nav item exists. | Absent |
| Voice dictation | Described on the RadOne page. | Not shown | Absent |
| AI reporting | Described on the RadOne page. Not executed. | Not shown | Absent |
| PDF and print | Not shown on the public site. | Not shown | Absent |
| Email and WhatsApp sharing | "One-click" physician sharing is a claim. Channels were not named. | Not shown | Absent |
| Teleradiology routing | Described. RadLinQ page is "Coming Soon". | Not shown | Absent |
| Billing | InvoiceIQ page is "Coming Soon". | Not shown | Absent |
| Audit log | Not shown on the public site. | Nav item exists. | Absent |
| Patient portal | Described and illustrated. | Not shown | Absent |
| Compliance certifications | Claimed. Not inspected. | Not shown | Absent |

## Required backend API

Base path `/api`. All responses except login and public share links require an authenticated user. Facility-scoped roles only see their facilities. System administrators see every facility.

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/login` | Email and password. Sets an httpOnly session cookie. |
| `POST /api/auth/logout` | Clears the session. |
| `GET /api/auth/me` | Current user, role, and facilities. |
| `GET /api/system/status` | Archive, database, SMTP, WhatsApp, and AI configuration. Never returns secrets. |
| `GET /api/dashboard` | Counts by status, modality, priority, and remote-reading queue. |
| `GET/POST /api/facilities`, `PATCH /api/facilities/:id` | Facility administration. |
| `GET/POST /api/users`, `PATCH /api/users/:id` | Accounts and role assignment. |
| `GET/POST /api/patients` | Registration and search by name, MRN, or accession. |
| `GET/POST /api/studies`, `GET/PATCH /api/studies/:id` | Orders, status, assignment, reading facility. |
| `POST /api/dicom` | Store DICOM part 10 files for a facility. |
| `GET /api/instances/:id/pixels` | Metadata and pixel buffer for the built-in viewer, size-limited. |
| `GET/POST /api/reports`, `PATCH /api/reports/:id` | Draft reporting. |
| `POST /api/reports/:id/sign` | Preliminary or final signature. |
| `POST /api/reports/:id/assist` | Optional external AI suggestion. Must fail closed when unconfigured. |
| `GET /api/reports/:id/pdf` | Printable report. |
| `POST /api/reports/:id/share` | Link, email, or WhatsApp. Email and WhatsApp fail closed when unconfigured. |
| `GET/POST /api/templates` | Report templates. |
| `GET /api/audit` | Append-only audit query. |
| `GET /api/public/share/:token` and `.../pdf` | Expiring report share. No DICOM archive access. |

## MongoDB collections

| Collection | Required fields |
| --- | --- |
| `facilities` | name, code, active |
| `users` | name, email, password hash, role, facility ids, active |
| `patients` | facility, name, MRN, date of birth, sex. Unique MRN per facility. |
| `studies` | patient, facility, accession, modality, description, scheduled time, status, priority, acquiring facility, reading facility, assignee |
| `series` | study, series UID, modality, number, description |
| `instances` | series, SOP instance UID, transfer syntax, rows, columns, bit depth, stored file path, optional Orthanc id |
| `reports` | study, technique, findings, impression, status, author, signer, timestamps |
| `templates` | name, modality, technique, findings, impression |
| `shares` | report, token hash, channel, recipient, expiry, revoked |
| `auditlogs` | actor, action, entity, entity id, facility, timestamp, metadata without secrets |

Statuses used by worklists: `booked`, `acquired`, `reporting`, `preliminary`, `finalized`. Priorities: `routine`, `urgent`, `stat`.

Roles: `system_admin`, `facility_admin`, `radiologist`, `technologist`, `referring_physician`.

## DICOM integration

Required in the product, not copied from Somatiq:

- Accept DICOM part 10 uploads after checking the `DICM` prefix.
- Parse patient, study, series, and instance identifiers and create or match local records.
- Keep bytes on disk outside the web root. Serve pixels only through an authenticated API.
- Render uncompressed explicit little-endian grayscale instances in the browser, with window width and level.
- Refuse a preview, with an explicit error, when the transfer syntax or size is outside the built-in renderer.
- Optional Orthanc REST archive when `ORTHANC_URL` is set: store the instance and proxy an authenticated preview. Orthanc remains the DIMSE and DICOMweb endpoint. PACSD does not embed a DICOM listener in this phase.
- MPR, MIP, and 3D were claimed on Somatiq's marketing page and were not observed in an application. They are out of scope for the built-in viewer until a tested rendering pipeline exists. The status page must say that plainly.

## Security requirements

- Passwords stored only as bcrypt hashes. No default production password.
- Session cookie is httpOnly, SameSite=Lax, and Secure in production.
- Role checks on every mutating route. Facility checks on every patient, study, report, and instance read.
- Login rate limit. Generic login failure message.
- Share tokens stored as hashes, with an expiry. Revocation must block the public route.
- Public share returns the report, not the DICOM archive.
- Audit log on login, failed login, patient and study changes, DICOM store, report edits, signature, share, and viewer open.
- Helmet defaults, CORS locked to the configured web origin, and request body limits.
- Secrets only in environment variables. Status endpoints report configured or not configured.
- Email uses the operator's SMTP server. WhatsApp uses the operator's WhatsApp Business Cloud API credentials. Neither path may pretend a message was sent.
- AI assist calls only an operator-configured endpoint and never signs a report.
- Production requires `MONGODB_URI` and `SESSION_SECRET`. An in-memory database is allowed only when `ALLOW_MEMORY_DB=true` for a local demonstration.
- The product is a workflow application. It is not a certified diagnostic device, and the report PDF says so.

## Implementation priority

1. Session, roles, facilities, audit, and the charcoal/purple shell from the supplied screenshot, branded PACSD / Galactic Medical Systems.
2. Patients, orders, worklists, clinical review, and dashboard counts from the database rather than from static illustrations.
3. Local DICOM storage, metadata, and the single-frame uncompressed viewer. Orthanc adapter behind configuration.
4. Reporting, templates, signature, PDF, and expiring share links.
5. Email and WhatsApp senders that fail closed, plus optional AI assist and browser speech dictation.
6. Remote-reading assignment across facilities.
7. Not in this phase: a patient portal, billing, MPR/MIP/3D, a built-in DIMSE listener, and any claim of HIPAA, ISO 27001, or NABH certification. Those Somatiq statements were unverified marketing claims.

## After the implementation pass

`docs/IMPLEMENTATION_STATUS.md` records what was built and tested from the priorities above, and which items still need Atlas, SMTP, WhatsApp, AI, or Orthanc configuration. The repository was empty at inspection. The application now in this folder is that implementation, not a recovery of prior source.

## What this comparison does not decide

Somatiq's logged-in RIS may contain controls that the public site never shows. Those controls are not requirements until someone with permission observes them. PACSD should follow the workflows named above and the layout in the local screenshot, with original copy, components, and APIs.
