# Known limitations

- One organization is created for the deployment. Cross-tenant isolation for a second hospital is not enforced on every query.
- Node does not speak DIMSE. Orthanc is optional and is not started by `npm run dev`.
- Uploads create transfer jobs. Studies that arrive only in Orthanc are not indexed automatically.
- The viewer does not reconstruct MPR, MIP, or 3D.
- Length and angle are in pixels. There is no saved annotation.
- Email, WhatsApp, and AI assist return an error until their environment variables are set. The interface shows them as not configured.
- Subscription and billing have no provider. No invoice or payment is recorded.
- Archive copy sets `restoreTested` to false. Disaster recovery has not been demonstrated.
- The in-memory database used for local demo disappears when the API process stops.
- This software is not a certified diagnostic device. Passing tests does not change that.
