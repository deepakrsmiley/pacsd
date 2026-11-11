# PACSD test plan

## Automated

Run from the repository root:

```
npm test
```

The suite uses `mongodb-memory-server` and a temporary DICOM directory. It covers permissions, a synthetic DICOM upload, pixel decode, report sign-off, PDF, share-link access, unconfigured email and WhatsApp, DICOM node authorization, a failed connection test, and transfer-job creation.

## Manual checks for this pass

- Sign in as `admin@galactic.test` and open DICOM Nodes, Transfer Queue, PACS Archive, System Health, and Subscription.
- Add a node pointed at a closed port and confirm the test reports failure.
- Open the diagnostic viewer and confirm the stored study, not a placeholder, is displayed.
- Confirm Subscription does not show an active paid plan.

## Not yet tested

- C-ECHO through Orthanc against a modality.
- C-STORE from imaging equipment.
- Two-organization isolation.
- Backup restoration.
- Measurement accuracy on a phantom.
- Payment webhooks.
- Load tests.

A passing `npm test` does not establish diagnostic safety or regulatory compliance.
