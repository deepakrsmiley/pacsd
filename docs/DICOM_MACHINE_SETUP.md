# DICOM machine setup

PACSD does not open a DICOM port inside Node. Compatible equipment should send studies to Orthanc. PACSD indexes Orthanc automatically through:

1. **Lua notify (primary, instant)** — `OnStoredInstance` posts to `POST /api/orthanc/notify`
2. **Changes poller (recovery)** — `/changes` checkpoint in Mongo (`OrthancCursor`), default every 2s
3. **StableStudy + inactivity window** — marks ingest `completed` / `incomplete` without faking progress

Live worklist updates use cookie-authenticated **SSE** at `/api/events` (`study.*` and `transfer.*` events).

## Orthanc

### Windows hospital gateway

1. Install Orthanc Server and set `RegisteredUsers` in `orthanc.json`.
2. Point the local PACSD `ORTHANC_URL` at `http://127.0.0.1:8042`. On Render, set `ORTHANC_URL` to the Tailscale Funnel `https://gh-orthanc.tail26efd7.ts.net` (no trailing slash). The scanner keeps sending DICOM to this PC. Render never receives the DICOM port.
3. Install the notify script:

```powershell
# PowerShell as Administrator
.\scripts\install-orthanc-notify.ps1
```

Or set manually:

```json
"LuaScripts" : [ "C:\\Orthanc\\orthanc-notify.lua" ]
```

[`scripts/orthanc-notify.lua`](../scripts/orthanc-notify.lua) posts each new image to the local API and to `https://pacsd.onrender.com`. `ORTHANC_WEBHOOK_TOKEN` on Render must match the token in that file. This PC and Tailscale must stay on, or the cloud site cannot read images.

### Docker Compose

`docker compose --profile dicom up` starts Orthanc from `docker-compose.yml`.

- DICOM port: 4242
- REST port: 8042
- Set `ORTHANC_URL` to `http://orthanc:8042` inside Compose or `http://127.0.0.1:8042` on a workstation.

## Render deployment

| Service | Role |
| --- | --- |
| `pacsd-api` (web) | HTTPS API, SSE, Lua notify ingest. Set `ORTHANC_POLLER=false` when the worker exists. |
| `pacsd-orthanc-worker` (worker) | Always-on Changes poller + StableStudy reconciliation. Needs a **non-sleeping** plan. |

Free web instances sleep; without the worker or Lua notify, studies will not appear until the next HTTP wake.

Required env on web + worker: `MONGODB_URI`, `ORTHANC_URL`, `ORTHANC_USERNAME`, `ORTHANC_PASSWORD`. Web also needs `ORTHANC_WEBHOOK_TOKEN`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `WEB_ORIGIN`.

## Register a modality in PACSD

1. Sign in as a system or facility administrator.
2. Open DICOM Nodes.
3. Save the modality AE title, host, and port.
4. Choose Test connection.

## Transfer lifecycle (ingest only)

Clinical `Study.status` stays `booked|acquired|reporting|preliminary|finalized`.

Separate ingest fields:

`waiting → receiving → processing → indexing → completed`

Also: `failed`, `interrupted`, `incomplete`.

Progress percent is `receivedInstances / expectedInstances` when Orthanc statistics or DICOM `(0020,1208)` provides a total. Otherwise the UI shows an indeterminate ring and the real received count.

## Manual test (sample C-STORE)

1. Start API (`npm run dev`) with correct Orthanc credentials.
2. Open Worklist — **Receiving studies** panel should be empty.
3. C-STORE a multi-slice CT to Orthanc AE (e.g. `GMSPACS` / 4242).
4. Within ~1–2s the panel shows patient, modality, image count, and bytes.
5. When Orthanc emits `StableStudy` (or after `TRANSFER_STABLE_MS` quiet), the ring reaches completed and a toast appears.
6. The study row appears without a full page refresh; open Viewer / Report as usual.

## What a modality can do today

| Service | Status |
| --- | --- |
| Part 10 file import through `POST /api/dicom` | Implemented for files the parser accepts |
| C-ECHO | Only through Orthanc when configured |
| C-STORE to PACSD Node | Not implemented |
| C-STORE to Orthanc | PACSD imports via Lua notify + Changes poller |
| C-FIND, C-MOVE, C-GET | Not implemented |
| Modality worklist, MPPS, storage commitment | Not implemented |

## Preview limits

The built-in viewer decodes uncompressed little-endian grayscale, 8 or 16 bit, single sample, up to 2048 pixels square. Other transfer syntaxes are stored. They are not displayed unless Orthanc can return a preview for that instance.
