# PACSD target architecture

## Current shape

One Node process serves the API and, in production, the built client. MongoDB holds metadata. DICOM bytes stay on disk or in Orthanc. The browser never receives another facility's records when the route checks `canAccessFacility` or a facility filter.

```
Browser (React)
    |  cookie session, x-facility-id
Express API
    |-- MongoDB: organization, facility, user, patient, study, series, instance, report, share, node, transfer, backup, audit
    |-- Files: server/data DICOM objects
    |-- Optional Orthanc: DIMSE :4242 and REST :8042
```

## Tenant boundary

An organization owns facilities. Users carry facility ids. System administrators can open every facility in this deployment; they do not get a separate break-glass clinical mode. A second hospital on the same database is not isolated yet, because organization id is not enforced on every query. That is the next isolation change. Do not put two legal entities on one database until that change and its negative tests exist.

## DICOM path

1. A modality associates to Orthanc, not to the Node process.
2. Orthanc stores the object.
3. A bridge, or the current upload API, registers the patient, study, series, and instance and writes a transfer job.
4. The viewer reads pixels only after `dicom.read` and a facility check.

Until that bridge exists, the supported receive path is authenticated `POST /api/dicom`.

## What stays out of MongoDB

Pixel frames stay in files. The instance document stores the path, UIDs, size, and geometry tags needed for the preview.

## Control plane versus clinical plane

Organization settings, subscription, backup, and DICOM node administration are separate routes with their own permissions. Subscription does not grant image access. Billing is unconfigured and does not delete studies.
