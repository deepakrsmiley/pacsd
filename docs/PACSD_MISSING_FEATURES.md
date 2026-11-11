# PACSD missing features

This list follows the enterprise specification. "Missing" means it is not implemented, or it is only explained in the interface.

## DICOM equipment

- Node process does not listen for C-STORE. Orthanc is the intended listener and is optional.
- C-FIND, C-MOVE, C-GET, storage commitment, modality worklist, and MPPS are not implemented.
- DICOMweb QIDO-RS, WADO-RS, and STOW-RS are not exposed by PACSD.
- Routing between nodes is not implemented.
- Transfer jobs record browser and API uploads. They do not yet record Orthanc arrivals.

## Viewer

- No OHIF or Cornerstone3D embedding.
- No MPR, MIP, slab, or 3D volume rendering.
- Measurements are in pixels. Pixel spacing is not applied.
- Annotations are not saved.
- Compressed transfer syntaxes are stored and refused by the built-in preview.

## Clinical workflow

- No encounter model.
- No separate imaging-order record beyond the study.
- No patient merge or unmerge.
- No report version or addendum record.
- Critical findings are STAT studies only. There is no separate critical-result communication workflow.
- No patient login. Sharing is an expiring report link.

## SaaS control plane

- No second-tenant provisioning wizard.
- No plan, quota, invoice, or payment-provider adapter.
- No signed billing webhook.
- No SSO or MFA.
- No support-ticket system.
- Backup restore has not been drilled.

## Interoperability

- No HL7 v2 adapter.
- No FHIR server or client.
- No DICOM conformance statement beyond `docs/DICOM_MACHINE_SETUP.md` and `docs/KNOWN_LIMITATIONS.md`.
