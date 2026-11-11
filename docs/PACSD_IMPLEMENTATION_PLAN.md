# PACSD implementation plan

## Done in this pass

- Organization record linked to facilities.
- DICOM node records and a connection test that cannot report success unless Orthanc's C-ECHO succeeds.
- Transfer jobs for accepted, duplicate, and rejected uploads.
- Archive counts, system health, notification states, referring doctors, and an unverified archive copy.
- Navigation for the enterprise sections. Each page reads an API or states that the capability is absent.
- Tests for node permission, failed echo, transfer count, and a referring user blocked from nodes.

## Next, in order

1. Record Orthanc stable-study arrivals as transfer jobs and instances, using the Orthanc change API or a Lua callback. Do not mark a study complete on the first instance.
2. Enforce `organizationId` on every clinical query and add a negative test with two organizations.
3. Persist viewer measurements with author and time. Show millimetres only when pixel spacing is present.
4. Report versions: a final report cannot be overwritten; an addendum is a new record.
5. Run Orthanc in the `dicom` compose profile and execute one C-ECHO against a known AE. Record the result. Do not check in a password.
6. Restore one backup into an empty folder and open the study. Only then set `restoreTested`.
7. Add a payment adapter only after a provider and webhook secret exist.

## Not scheduled until equipment is available

Modality worklist, MPPS, HL7 orders, FHIR, OHIF, and MPR. Those need real studies and a chosen library, and they must not be represented by static images.
