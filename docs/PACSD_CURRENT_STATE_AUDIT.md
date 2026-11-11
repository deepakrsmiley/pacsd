# PACSD current state audit

Audit date: 2026-10-23. This describes the repository as it exists after the enterprise extension in this pass. Severities are High, Medium, or Low.

## Stack

- Client: React 18, Vite, Tailwind, React Router. Session via httpOnly cookie `pacsd_session`.
- Server: Node.js, Express, Mongoose, Zod, bcrypt, JWT cookie, Helmet, rate-limited login.
- Database: MongoDB. Local demo uses an in-memory server when `MONGODB_URI` is empty and `ALLOW_MEMORY_DB=true`.
- DICOM: Part 10 read/write in `server/src/dicom.js` using `dicom-parser`. Pixel preview is uncompressed little-endian grayscale only. Optional Orthanc REST archive. No DIMSE listener inside Node.
- Files: original DICOM objects are written under `DICOM_DIR` or `server/data`, not inside MongoDB documents. Mongo stores the path and metadata.

## Implemented and covered by automated tests

| Area | Evidence |
| --- | --- |
| Login cookie, role checks, facility scope | `server/test/api.test.js` |
| DICOM round trip for a synthetic uncompressed CT | same test |
| Report save, sign, PDF, share link, email/WhatsApp fail closed | same test |
| DICOM node create is forbidden to a technologist | same test |
| C-ECHO to `127.0.0.1:1` returns failure, not a fabricated success | same test |
| Inbound upload creates a transfer job | same test |
| Referring user cannot list DICOM nodes | same test |

## Partially implemented

| Issue | Severity | Files | Cause | Next step | Acceptance |
| --- | --- | --- | --- | --- | --- |
| One organization is attached to facilities, not a full multi-tenant control plane | High | `models.js`, `enterprise.js` | A single organization is created and facilities are linked. There is no second-tenant negative suite beyond facility scope. | Add tenant membership on the user and reject cross-organization ids in every query. | A user in org A receives 404/403 for org B patients, images, and reports. |
| C-ECHO is a real socket or Orthanc call, not a DIMSE stack in Node | High | `dicomEcho.js` | Without `ORTHANC_URL`, PACSD only proves TCP reachability and records `echo: false`. | Run Orthanc and call its modality echo. | A compatible AE returns `echo: true` only after Orthanc reports success. |
| Viewer windows, measures, and layouts work for supported grayscale | Medium | `client/src/pages/Viewer.jsx` | MPR, MIP, and 3D are refused with an explanation. No pixel spacing calibration. | Add geometry from DICOM tags before showing millimetres. | A known phantom length matches within a documented tolerance, or the label stays in pixels. |
| Backup copy is a file copy | Medium | `enterprise.js` | `restoreTested` stays false. No isolated restore drill has been run. | Restore into an empty directory and open a study. | A recorded drill sets `restoreTested` only after the restored file opens. |
| Reporting is draft / preliminary / final | Medium | `createApp.js`, `Report` model | Amendments, version history, and recommendations are not separate records. | Add report versions and block silent edits of a final. | A final cannot be patched. An addendum stores the author and reason. |

## Not implemented

OHIF/Cornerstone, MPR/MIP/3D, HL7, FHIR, SSO, MFA, payment webhooks, patient password accounts, modality worklist, MPPS, storage commitment, and a tested disaster-recovery drill.

## Security notes

Passwords are bcrypt hashes. The demo password exists only when `SEED_DEMO=true`. DICOM node changes require `dicom.node`. Archive copy requires a system administrator. Payment status is not invented. Integration screens report configuration from environment variables, not from a successful send.
