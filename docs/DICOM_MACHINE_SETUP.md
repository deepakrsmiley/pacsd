# DICOM machine setup

PACSD does not open a DICOM port inside Node. Compatible equipment should send studies to Orthanc. PACSD then indexes files it receives through the authenticated upload API, or, later, through an Orthanc bridge that is not built yet.

## Orthanc

`docker compose --profile dicom up` starts Orthanc from `docker-compose.yml`.

- DICOM port: 4242, AE title configured by the image (`ORTHANC__NAME` is the Orthanc name, not automatically the called AE).
- REST port: 8042, bound for local administration. Do not publish 8042 or 4242 on a public cloud address without a reviewed network boundary.
- Set `ORTHANC_URL` to the REST base, for example `http://orthanc:8042` inside Compose or `http://127.0.0.1:8042` on a workstation.
- Change `ORTHANC__REGISTERED_USERS` before any shared network use. The compose example password is a local placeholder.

## Register a modality in PACSD

1. Sign in as a system or facility administrator.
2. Open DICOM Nodes.  
3. Save the modality AE title, host, and port.
4. Choose Test connection.

Results:

- `echo: true` only when `ORTHANC_URL` is set and Orthanc's modality echo returns success.
- A closed port returns connection refused, timeout, or an equivalent socket error, with `echo: false`.
- An open TCP port without Orthanc is reported as reachable and still `echo: false`.

## What a modality can do today

| Service | Status |
| --- | --- |
| Part 10 file import through `POST /api/dicom` | Implemented for files the parser accepts |
| C-ECHO | Only through Orthanc when configured |
| C-STORE to PACSD Node | Not implemented |
| C-STORE to Orthanc | Available when Orthanc is running; PACSD does not yet ingest Orthanc's new studies automatically |
| C-FIND, C-MOVE, C-GET | Not implemented |
| Modality worklist, MPPS, storage commitment | Not implemented |

## Preview limits

The built-in viewer decodes uncompressed little-endian grayscale, 8 or 16 bit, single sample, up to 2048 pixels square. Other transfer syntaxes are stored. They are not displayed unless Orthanc can return a preview for that instance.
