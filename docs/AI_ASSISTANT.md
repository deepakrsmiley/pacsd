# AI assistant

The AI assistant reviews one image the radiologist selects. It does not start by itself, and it does not sign, share, or replace a report.

The model configured for this project is a general-purpose chat model. It can suggest text. It does not return calibrated boxes, masks, measurements, or a diagnosis. If a future model documents real detection or segmentation output, the capability flags in `server/src/ai/capabilities.js` are the place to enable those markers. Until then, the viewer does not draw AI markers.

Every result includes this notice: "AI-generated findings require review by a qualified radiologist. Do not use AI output alone for diagnosis or treatment."

## What the radiologist does

1. Open a study in the DICOM viewer, or open a report and choose AI Analysis.
2. Select the image to review.
3. Click Analyze with AI. Only that image is sent. The other slices stay unanalyzed, and the screen says so.
4. Read the status, the suggested findings, and the limitations.
5. Accept or reject each suggestion.
6. Click Generate report draft.
7. Insert one section, or insert all after the confirmation. If a section already has text, PACSD asks before replacing it.
8. Click Save draft. Signing, PDF, and sharing stay on the existing buttons and never run from the AI result.

Patient name, medical record number, and date of birth are not added to the provider request. Text the radiologist types into Clinical information can be included when generating the draft, because that text was supplied by the clinician.

## Server configuration

Put these values in the server `.env`. Do not put the key in a Vite variable.

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=90000
AI_MAX_IMAGE_SIZE_MB=4
```

`AI_BASE_URL` is the full chat-completions URL. For Gemini that is `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`. `AI_API_KEY` stays on the server. Restart `npm run dev` after changing `.env`.

If either value is empty, Analyze with AI explains that setup is required. It does not invent findings.

Orthanc must be running for a preview to exist. Docker Desktop stays open, then from the project folder:

```
docker compose --profile dicom up -d orthanc
npm run dev
```

The API is `http://127.0.0.1:4000`. The app is `http://127.0.0.1:5173`.

## Status values

- AI analysis completed
- Review recommended
- Insufficient image quality
- Unsupported image type
- Analysis failed

A general model is stored as Review recommended even when it answers successfully.

## Stored record

Each request creates an `AiAnalysis` document with the study, image, frame, provider, model, status, text findings, draft, and the user who started it. The preview bytes are not stored. Accepting a section records the user and time on that document and in the audit log. The report document changes only when the radiologist saves it.
