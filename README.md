# PACSD

Radiology workspace for Galactic Medical Systems. It is a MERN application with a local DICOM archive, a grayscale viewer, reporting, PDF output, role-based permissions, and audit logs.

This is workflow software. It is not a certified diagnostic device.

## Run a local demonstration

```powershell
cd C:\Users\Deepak\Desktop\PACSD
copy .env.example .env
npm install
npm test
npm run dev
```

The API listens on port 4000. The web app is http://localhost:5173.

With `ALLOW_MEMORY_DB=true` and `SEED_DEMO=true`, the API uses an in-memory database and creates demonstration accounts. The password is `DEMO_PASSWORD` (default `Galactic-Demo-2026`).

- `kavita.menon@galactic.test` radiologist
- `admin@galactic.test` system administrator
- `tech.north@galactic.test` technologist
- `desk.north@galactic.test` referring desk

Demonstration patients are labeled synthetic. Do not put real patient files in a memory database or a shared demo.

## Durable deployment

Set `MONGODB_URI` to MongoDB Atlas and `SESSION_SECRET` to a long random value. Build the client, then start the API. The API serves `client/dist` and the JSON API on one origin.

```powershell
$env:NODE_ENV="production"
$env:MONGODB_URI="mongodb+srv://..."
$env:SESSION_SECRET="..."
$env:PUBLIC_BASE_URL="https://your-host"
$env:WEB_ORIGIN="https://your-host"
$env:COOKIE_SECURE="true"
npm run build
npm start
```

`docker compose up --build` expects those variables in the environment. Add `--profile dicom` only when you want the optional Orthanc container. Point `ORTHANC_URL` at `http://orthanc:8042` from the API container.

## External services

Email, WhatsApp Business, AI assist, and Orthanc stay off until their variables in `.env.example` are set. The settings screen reports each one as configured or not. Unconfigured email, WhatsApp, and AI routes return an error and do not pretend a message was sent.

WhatsApp uses the official Cloud API. A template name is optional. If set, that template must accept two body parameters: patient name, then the share URL. Meta may reject a plain text message outside an open customer-care window.

AI assist expects an OpenAI-compatible chat-completions URL in `AI_BASE_URL`. A suggestion is never signed by itself.

Voice dictation uses the browser Speech Recognition API when that browser provides it.

## DICOM

Uploaded files must be DICOM part 10. The built-in viewer draws uncompressed little-endian grayscale frames up to 2048 by 2048. Other transfer syntaxes stay stored and can be previewed through Orthanc when `ORTHANC_URL` is set. MPR, MIP, and 3D are not implemented. Orthanc, not PACSD, owns DIMSE and DICOMweb.
