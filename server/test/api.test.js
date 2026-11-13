import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { interpretResponse } from "../../client/src/api.js";
import { createApp } from "../src/createApp.js";
import { ingestDicomBuffer } from "../src/ingest.js";
import { createOrthancAbortError, orthancFetch, orthancJson, orthancSystem } from "../src/orthancClient.js";
import { syncOrthancOnce } from "../src/orthancSync.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { buildSampleDicom, orthancDecodedFrameName, parseDicomBuffer } from "../src/dicom.js";
import { renderReportPdf } from "../src/pdf.js";
import { resetAiRateLimit } from "../src/ai/routes.js";
import { DicomNode, Facility, Instance, OrthancCursor, Patient, Report, Share, Study, TransferJob, User } from "../src/models.js";
import { can } from "../src/permissions.js";
import { resolveFieldValues } from "../../shared/reportDocument.js";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.COOKIE_SECURE = "false";
process.env.DICOM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pacsd-"));
delete process.env.SMTP_HOST;
delete process.env.WHATSAPP_TOKEN;
delete process.env.AI_BASE_URL;
delete process.env.ORTHANC_URL;

function sessionCookie(response) {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((item) => item.split(";")[0]).join("; ");
}

function readBody(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

let memory;
let app;
let northId;
let southId;

beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await connectDb(memory.getUri());
  app = createApp();
  const north = await Facility.create({ name: "GMS North Wing", code: "GNW" });
  const south = await Facility.create({ name: "GMS South Wing", code: "GSW" });
  northId = String(north._id);
  southId = String(south._id);
  const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
  await User.create([
    { name: "GMS Administrator", email: "admin@galactic.test", passwordHash, role: "system_admin", facilityIds: [north._id, south._id] },
    { name: "Dr. Kavita Menon", email: "kavita.menon@galactic.test", passwordHash, role: "radiologist", facilityIds: [north._id] },
    { name: "North Wing Technologist", email: "tech.north@galactic.test", passwordHash, role: "technologist", facilityIds: [north._id] },
    { name: "South Desk", email: "desk.south@galactic.test", passwordHash, role: "referring_physician", facilityIds: [south._id] },
  ]);
});

afterAll(async () => {
  await disconnectDb();
  if (memory) await memory.stop();
});

describe("permissions and DICOM", () => {
  it("denies report signature to a referring physician", () => {
    expect(can({ role: "referring_physician", active: true }, "report.sign")).toBe(false);
    expect(can({ role: "radiologist", active: true }, "report.sign")).toBe(true);
    expect(can({ role: "radiologist", active: false }, "report.sign")).toBe(false);
  });

  it("round-trips a synthetic DICOM object", () => {
    const parsed = parseDicomBuffer(buildSampleDicom({ patientId: "DEMO-9", patientName: "Sample^Nine" }));
    expect(parsed.patientId).toBe("DEMO-9");
    expect(parsed.patientName).toBe("Sample Nine");
    expect(parsed.rows).toBe(64);
    expect(parsed.previewSupported).toBe(true);
    expect(parsed.pixels.length).toBe(64 * 64);
    const aged = parseDicomBuffer(buildSampleDicom({
      patientName: "BHARATHI^D^^MRS 36Y/F",
      birthDate: "",
      sex: "",
      patientAge: "036Y",
    }));
    expect(aged.patientAge).toBe("36Y");
    expect(aged.birthDate).toBe("");
    expect(resolveFieldValues({
      patient: { name: "MRS D.BHARATHI 36Y/F", sex: "F", birthDate: "" },
      study: { studyDate: "2026-10-26", patientAge: "000Y" },
    }).ageGender).toBe("36 Y / Female");
    expect(resolveFieldValues({
      patient: { name: "Unknown", sex: "M", birthDate: "" },
      study: { patientAge: "003M" },
    }).ageGender).toBe("3 M / Male");
    expect(resolveFieldValues({
      patient: { name: "OLD 80Y/F", sex: "F", birthDate: "1990-01-01" },
      study: { studyDate: "2026-01-01", patientAge: "080Y" },
    }).ageGender).toBe("36 Y / Female");
  });
});

describe("names and report fonts", () => {
  it("decodes Specific Character Set names and embeds Noto fonts for Tamil and Devanagari", async () => {
    const cyrillic = parseDicomBuffer(buildSampleDicom({
      patientName: Buffer.from([0xb8, 0xd2, 0xd0, 0xdd, 0xde, 0xd2]),
      characterSet: "ISO_IR 144",
    }));
    expect(cyrillic.patientName).toBe("Иванов");
    const latin = parseDicomBuffer(buildSampleDicom({
      patientName: Buffer.from("José", "latin1"),
      characterSet: "ISO_IR 100",
    }));
    expect(latin.patientName).toBe("José");
    const utf8 = parseDicomBuffer(buildSampleDicom({ patientName: "राम", characterSet: "ISO_IR 192" }));
    expect(utf8.patientName).toBe("राम");

    const pdf = await renderReportPdf({
      facility: { name: "வடக்கு" },
      patient: { name: "राम அருண்", mrn: "MRN-FONT", sex: "O", birthDate: "1980-01-01" },
      study: { accession: "ACC-FONT", modality: "CT", description: "Study", studyDate: "2026-10-23" },
      report: { status: "final", technique: "CT", findings: "தமிழ்", impression: "देवनागरी", signedAt: new Date("2026-10-23T00:00:00Z") },
      signer: { name: "Dr Font" },
    });
    expect(pdf.slice(0, 4).toString()).toBe("%PDF");
    const body = pdf.toString("latin1");
    expect(body).toContain("NotoSans");
    expect(body).toContain("NotoSansDevanagari");
    expect(body).toContain("NotoSansTamil");
  });
});

describe("studies from orders", () => {
  it("issues a Study Instance UID and keeps the order UID when images use another one", async () => {
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const patient = await tech.post("/api/patients").set("x-facility-id", northId).send({ facilityId: northId, name: "Order Patient", mrn: "MRN-ORDER" });
    const first = await tech.post("/api/studies").set("x-facility-id", northId).send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-ORDER-A",
      modality: "CT",
    });
    const second = await tech.post("/api/studies").set("x-facility-id", northId).send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-ORDER-B",
      modality: "CT",
    });
    expect(first.body.study.studyUid).toMatch(/^1\.2\.826\.0\.1\.3680043\.10\.543\.\d+\.\d+\.order$/);
    expect(second.body.study.studyUid).not.toBe(first.body.study.studyUid);

    const buffer = buildSampleDicom({ patientId: "MRN-ORDER", accession: "ACC-ORDER-A", patientName: "Order^Patient" });
    const parsed = parseDicomBuffer(buffer);
    expect(parsed.studyUid).not.toBe(first.body.study.studyUid);
    const stored = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "order.dcm" });
    const linked = await Study.findById(stored.studyId);
    expect(linked.studyUid).toBe(parsed.studyUid);
    expect(linked.aliases).toContain(first.body.study.studyUid);
    expect(String(linked._id)).toBe(String(first.body.study._id));
    const again = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "order-again.dcm" });
    const reread = await Study.findById(again.studyId);
    expect(String(reread._id)).toBe(String(linked._id));
    expect(reread.studyUid).toBe(parsed.studyUid);
    expect(reread.aliases).toEqual(linked.aliases);
    expect(await Study.countDocuments({ accession: "ACC-ORDER-A", facilityId: northId })).toBe(1);
  });
});

describe("DICOM ingest", () => {
  it("stores a buffer once and records a duplicate when the same SOP arrives again", async () => {
    const buffer = buildSampleDicom({ patientId: "MRN-INGEST", accession: "ACC-INGEST", patientName: "Ingest^One" });
    const first = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "ingest.dcm" });
    expect(first.sopUid).toBeTruthy();
    expect(await Instance.countDocuments({ sopUid: first.sopUid })).toBe(1);
    const second = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "ingest-again.dcm" });
    expect(String(second.instanceId)).toBe(String(first.instanceId));
    expect(await Instance.countDocuments({ sopUid: first.sopUid })).toBe(1);
    expect(await Study.countDocuments({ studyUid: (await Study.findById(first.studyId)).studyUid })).toBe(1);
    const jobs = await TransferJob.find({ sopUid: first.sopUid }).sort({ createdAt: 1 });
    expect(jobs.map((job) => job.status)).toEqual(["stored", "duplicate"]);
    expect(jobs.every((job) => job.source === "upload")).toBe(true);
  });
});

describe("Orthanc ingest", () => {
  it("imports a known AE title once and an unknown calling AE into the default facility", async () => {
    const known = buildSampleDicom({ patientId: "MRN-ORTH", accession: "ACC-ORTH", patientName: "Orthanc^Known" });
    const unknown = buildSampleDicom({ patientId: "MRN-ORTH-U", accession: "ACC-ORTH-UNK", patientName: "Orthanc^Unknown" });
    const knownSop = parseDicomBuffer(known).sopUid;
    const unknownSop = parseDicomBuffer(unknown).sopUid;
    await DicomNode.create({ facilityId: northId, name: "CT Room", aeTitle: "CTROOM", host: "127.0.0.1", port: 4242, enabled: true });
    process.env.ORTHANC_URL = "http://orthanc.test";
    let changePage = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url);
      if (options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ID: "orthanc-stored" }) };
      }
      if (href.endsWith("/studies")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (href.includes("/changes")) {
        changePage += 1;
        if (changePage === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              Changes: [
                { ChangeType: "NewInstance", ID: "inst-known", Seq: 1 },
                { ChangeType: "NewInstance", ID: "inst-unknown", Seq: 2 },
                { ChangeType: "StableStudy", ID: "study-1", Seq: 3 },
              ],
              Done: true,
              Last: 3,
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ Changes: [], Done: true, Last: 3 }) };
      }
      if (href.includes("/instances/inst-known") && !href.includes("/file") && !href.includes("/metadata")) {
        return { ok: true, status: 200, json: async () => ({ ParentStudy: "study-1", ID: "inst-known" }) };
      }
      if (href.includes("/instances/inst-unknown") && !href.includes("/file") && !href.includes("/metadata")) {
        return { ok: true, status: 200, json: async () => ({ ParentStudy: "study-2", ID: "inst-unknown" }) };
      }
      if (href.endsWith("/studies/study-1") || href.endsWith("/studies/study-2")) {
        const uid = href.includes("study-1") ? parseDicomBuffer(known).studyUid : parseDicomBuffer(unknown).studyUid;
        return { ok: true, status: 200, json: async () => ({ MainDicomTags: { StudyInstanceUID: uid } }) };
      }
      if (href.includes("/statistics")) {
        return { ok: true, status: 200, json: async () => ({ CountInstances: 1 }) };
      }
      if (href.endsWith("/metadata/RemoteAET")) {
        const ae = href.includes("inst-known") ? "CTROOM" : "NOTREAL";
        return { ok: true, status: 200, text: async () => ae };
      }
      if (href.endsWith("/instances/inst-known/file")) {
        return { ok: true, status: 200, arrayBuffer: async () => known };
      }
      if (href.endsWith("/instances/inst-unknown/file")) {
        return { ok: true, status: 200, arrayBuffer: async () => unknown };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    };
    process.env.TRANSFER_VERIFY_GAP_MS = "0";
    process.env.TRANSFER_QUIET_MS = "20000";
    try {
      await syncOrthancOnce();
      await syncOrthancOnce();
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ORTHANC_URL;
      delete process.env.TRANSFER_VERIFY_GAP_MS;
    }
    expect(await Instance.countDocuments({ sopUid: knownSop })).toBe(1);
    expect(await Instance.countDocuments({ sopUid: unknownSop })).toBe(1);
    expect(await TransferJob.countDocuments({ source: "orthanc", status: "stored", sopUid: knownSop })).toBe(1);
    expect(await TransferJob.countDocuments({ source: "orthanc", status: "stored", sopUid: unknownSop })).toBe(1);
    expect(await TransferJob.countDocuments({ source: "orthanc", status: "rejected", error: "Unknown AE title" })).toBe(0);
    expect(await Study.countDocuments({ accession: "ACC-ORTH" })).toBe(1);
    expect(await Study.countDocuments({ accession: "ACC-ORTH-UNK" })).toBe(1);
    expect(String((await Study.findOne({ accession: "ACC-ORTH-UNK" })).facilityId)).toBe(northId);
    expect((await DicomNode.findOne({ aeTitle: "NOTREAL" })).facilityId.toString()).toBe(northId);
    expect((await OrthancCursor.findOne({ key: "changes" })).lastSeq).toBe(3);
    expect((await Study.findOne({ accession: "ACC-ORTH" })).transferPhase).toBe("completed");
    expect((await Study.findOne({ accession: "ACC-ORTH" })).receivedInstances).toBe(1);
  });

  it("lists active transfers and paginates studies", async () => {
    const buffer = buildSampleDicom({ patientId: "MRN-XFER", accession: "ACC-XFER", patientName: "Transfer^One" });
    await ingestDicomBuffer({ buffer, facilityId: northId, source: "orthanc", fileName: "xfer.dcm", orthancId: "xfer-1", expectedFromOrthanc: 10 });
    const study = await Study.findOne({ accession: "ACC-XFER" });
    expect(study.transferPhase).toBe("receiving");
    expect(study.receivedInstances).toBe(1);
    expect(study.expectedInstances == null).toBe(true);
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const active = await tech.get("/api/transfers/active").set("x-facility-id", northId);
    expect(active.status).toBe(200);
    expect(active.body.transfers.some((item) => item.accession === "ACC-XFER")).toBe(true);
    const page = await tech.get("/api/studies").query({ page: 1, limit: 5, q: "XFER" }).set("x-facility-id", northId);
    expect(page.status).toBe(200);
    expect(page.body.page).toBe(1);
    expect(page.body.limit).toBe(5);
    expect(typeof page.body.total).toBe("number");
    expect(page.body.studies.some((item) => item.accession === "ACC-XFER")).toBe(true);
  });

  it("accepts Orthanc store notifications only with the shared token", async () => {
    expect((await request(app).post("/api/orthanc/notify").send({ instance: "abcdef12-34" })).status).toBe(404);
    process.env.ORTHANC_WEBHOOK_TOKEN = "notify-secret-token";
    try {
      expect((await request(app).post("/api/orthanc/notify").send({ instance: "abcdef12-34" })).status).toBe(401);
      expect((await request(app).post("/api/orthanc/notify").set("x-pacsd-token", "notify-secret-tokex").send({ instance: "abcdef12-34" })).status).toBe(401);
      expect((await request(app).post("/api/orthanc/notify").set("x-pacsd-token", "notify-secret-token").send({ instance: "../system" })).status).toBe(400);
    } finally {
      delete process.env.ORTHANC_WEBHOOK_TOKEN;
    }
  });

  it("imports an Orthanc REST upload with no remote AE title into the first facility", async () => {
    const uploaded = buildSampleDicom({ patientId: "MRN-REST", accession: "ACC-REST", patientName: "Rest^Upload" });
    const sopUid = parseDicomBuffer(uploaded).sopUid;
    process.env.ORTHANC_URL = "http://orthanc.test";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url);
      if (options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ID: "orthanc-stored" }) };
      }
      if (href.includes("/changes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ Changes: [{ ChangeType: "NewInstance", ID: "inst-rest", Seq: 10 }], Done: true, Last: 10 }),
        };
      }
      if (href.endsWith("/studies") || href.includes("/studies?")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (href.endsWith("/metadata/RemoteAET")) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      }
      if (href.endsWith("/instances/inst-rest/file")) {
        return { ok: true, status: 200, arrayBuffer: async () => uploaded };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    };
    try {
      await syncOrthancOnce();
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ORTHANC_URL;
    }
    expect(await Instance.countDocuments({ sopUid })).toBe(1);
    expect(String((await Study.findOne({ accession: "ACC-REST" })).facilityId)).toBe(northId);
    expect(await TransferJob.countDocuments({ source: "orthanc", status: "stored", sopUid })).toBe(1);
  });
});

describe("DICOM tags", () => {
  it("returns stored tags for a readable instance", async () => {
    const buffer = buildSampleDicom({ patientId: "MRN-TAGS", accession: "ACC-TAGS", patientName: "Tags^One" });
    const stored = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "tags.dcm" });
    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const tags = await reader.get(`/api/instances/${stored.instanceId}/tags`).set("x-facility-id", northId);
    expect(tags.status).toBe(200);
    expect(tags.body.tags.some((item) => item.tag === "0010,0020" && item.value === "MRN-TAGS")).toBe(true);
    expect(tags.body.tags.some((item) => item.tag === "0008,0050" && item.value === "ACC-TAGS")).toBe(true);
  });
});

describe("pixel spacing", () => {
  it("stores PixelSpacing and ImagerPixelSpacing and returns them with the pixels", async () => {
    const spaced = buildSampleDicom({
      patientId: "MRN-SPACE",
      accession: "ACC-SPACE",
      patientName: "Space^One",
      pixelSpacing: "0.5\\0.25",
    });
    expect(parseDicomBuffer(spaced).pixelSpacing).toEqual([0.5, 0.25]);
    const imagerOnly = buildSampleDicom({
      patientId: "MRN-IMAGER",
      accession: "ACC-IMAGER",
      patientName: "Imager^One",
      imagerPixelSpacing: "0.1\\0.2",
    });
    expect(parseDicomBuffer(imagerOnly).pixelSpacing).toEqual([]);
    expect(parseDicomBuffer(imagerOnly).imagerPixelSpacing).toEqual([0.1, 0.2]);
    const stored = await ingestDicomBuffer({ buffer: spaced, facilityId: northId, source: "upload", fileName: "space.dcm" });
    const instance = await Instance.findById(stored.instanceId);
    expect(instance.pixelSpacing.map(Number)).toEqual([0.5, 0.25]);
    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const pixels = await reader.get(`/api/instances/${stored.instanceId}/pixels`).set("x-facility-id", northId);
    expect(pixels.status).toBe(200);
    expect(pixels.body.pixelSpacing).toEqual([0.5, 0.25]);
    expect(pixels.body.imagerPixelSpacing).toEqual([]);
  });
});

describe("compressed pixels", () => {
  it("decodes a compressed frame from Orthanc and names RGB and signed frames", async () => {
    expect(orthancDecodedFrameName({ samplesPerPixel: 3, bitsAllocated: 8, pixelRepresentation: 0 })).toBe("image-uint8");
    expect(orthancDecodedFrameName({ samplesPerPixel: 1, bitsAllocated: 16, pixelRepresentation: 1 })).toBe("image-int16");
    expect(orthancDecodedFrameName({ samplesPerPixel: 1, bitsAllocated: 16, pixelRepresentation: 0 })).toBe("image-uint16");
    const buffer = buildSampleDicom({ patientId: "MRN-JPEG", accession: "ACC-JPEG", patientName: "Jpeg^One" });
    const stored = await ingestDicomBuffer({ buffer, facilityId: northId, source: "upload", fileName: "jpeg.dcm" });
    await Instance.updateOne({ _id: stored.instanceId }, { transferSyntax: "1.2.840.10008.1.2.4.50", orthancId: "jpeg-1" });
    const frame0 = Buffer.alloc(64 * 64, 7);
    const frame1 = Buffer.alloc(64 * 64, 9);
    const requested = [];
    process.env.ORTHANC_URL = "http://orthanc.test";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const href = String(url);
      requested.push(href);
      const body = href.includes("/frames/1/") ? frame1 : frame0;
      return { ok: true, status: 200, arrayBuffer: async () => body };
    };
    try {
      const reader = request.agent(app);
      await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
      const first = await reader.get(`/api/instances/${stored.instanceId}/pixels?frame=0`).set("x-facility-id", northId);
      expect(first.status).toBe(200);
      expect(first.body.supported).toBe(true);
      expect(first.body.samplesPerPixel).toBe(1);
      expect(first.body.pixelsBase64).toBeUndefined();
      const firstRaw = await reader.get(`/api/instances/${stored.instanceId}/pixels/raw?frame=0`).set("x-facility-id", northId).buffer(true).parse(readBody);
      expect(firstRaw.status).toBe(200);
      expect(firstRaw.headers["content-type"]).toContain("application/octet-stream");
      expect(firstRaw.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
      expect(firstRaw.headers["cache-control"]).toContain("max-age=3600");
      expect(firstRaw.body.equals(frame0)).toBe(true);
      const cached = await reader.get(`/api/instances/${stored.instanceId}/pixels/raw?frame=0`).set("x-facility-id", northId).set("If-None-Match", firstRaw.headers.etag);
      expect(cached.status).toBe(304);
      const secondRaw = await reader.get(`/api/instances/${stored.instanceId}/pixels/raw?frame=1`).set("x-facility-id", northId).buffer(true).parse(readBody);
      expect(secondRaw.body.equals(frame1)).toBe(true);
      expect(requested.some((href) => href.includes("/instances/jpeg-1/frames/0/image-uint8"))).toBe(true);
      expect(requested.some((href) => href.includes("/instances/jpeg-1/frames/1/image-uint8"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ORTHANC_URL;
    }
  });
});

describe("workflow API", () => {
  it("signs in, stores an image, signs a report, and shares a link", async () => {
    const tech = request.agent(app);
    const login = await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    expect(login.status).toBe(200);

    const denied = await tech.get("/api/audit");
    expect(denied.status).toBe(403);

    const patient = await tech.post("/api/patients").send({
      facilityId: northId,
      name: "Sample North",
      mrn: "MRN-1",
      birthDate: "1990-05-04",
      sex: "F",
    });
    expect(patient.status).toBe(201);

    const outside = await tech.post("/api/patients").send({ facilityId: southId, name: "Other", mrn: "MRN-X" });
    expect(outside.status).toBe(403);

    const order = await tech.post("/api/studies").send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-1",
      modality: "CT",
      description: "Synthetic head",
      priority: "stat",
    });
    expect(order.status).toBe(201);

    const dicom = buildSampleDicom({
      patientName: "Sample^North",
      patientId: "MRN-1",
      accession: "ACC-1",
      description: "Synthetic head",
    });
    const stored = await tech.post("/api/dicom").field("facilityId", northId).attach("files", dicom, { filename: "sample.dcm", contentType: "application/dicom" });
    expect(stored.status).toBe(201);
    expect(stored.body.stored).toHaveLength(1);

    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const pixels = await reader.get(`/api/instances/${stored.body.stored[0].instanceId}/pixels`).set("x-facility-id", northId);
    expect(pixels.status).toBe(200);
    expect(pixels.body.supported).toBe(true);
    expect(pixels.body.pixelsBase64).toBeUndefined();
    const rawPixels = await reader.get(`/api/instances/${stored.body.stored[0].instanceId}/pixels/raw`).set("x-facility-id", northId).buffer(true).parse(readBody);
    expect(rawPixels.status).toBe(200);
    expect(rawPixels.headers["content-type"]).toContain("application/octet-stream");
    expect(rawPixels.headers.etag).toBeTruthy();
    expect(rawPixels.headers["cache-control"]).toContain("max-age");
    expect(rawPixels.body.length).toBeGreaterThan(20);

    const south = request.agent(app);
    await south.post("/api/auth/login").send({ email: "desk.south@galactic.test", password: "Galactic-Demo-2026" });
    const hidden = await south.get(`/api/instances/${stored.body.stored[0].instanceId}/pixels`).set("x-facility-id", southId);
    expect(hidden.status).toBe(403);

    const created = await reader.post("/api/reports").send({ studyId: stored.body.stored[0].studyId });
    expect(created.status).toBe(201);
    const reportId = created.body.report._id;
    const saved = await reader.patch(`/api/reports/${reportId}`).send({
      technique: "Synthetic axial images.",
      findings: "Demonstration findings only.",
      impression: "No clinical conclusion is intended.",
    });
    expect(saved.status).toBe(200);
    const assist = await reader.post(`/api/reports/${reportId}/assist`).send({});
    expect(assist.status).toBe(503);
    const signed = await reader.post(`/api/reports/${reportId}/sign`).send({ level: "final" });
    expect(signed.status).toBe(200);
    const pdf = await reader.get(`/api/reports/${reportId}/pdf`).buffer(true).parse(readBody);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");

    const email = await reader.post(`/api/reports/${reportId}/share`).send({ channel: "email", recipient: "physician@example.test", consent: true });
    expect(email.status).toBe(503);
    const message = await reader.post(`/api/reports/${reportId}/share`).send({ channel: "whatsapp", recipient: "919800000000", consent: true });
    expect(message.status).toBe(201);
    expect(message.body.delivery).toBe("not_sent");
    expect(message.body.attachmentSent).toBe(false);
    expect(message.body.fallback).toBe("web");
    expect(message.body.waUrl).toContain("wa.me");
    const link = await reader.post(`/api/reports/${reportId}/share`).send({ channel: "link" });
    expect(link.status).toBe(201);
    const token = link.body.link.split("/share/")[1];
    const shared = await request(app).get(`/api/public/share/${token}`);
    expect(shared.status).toBe(200);
    expect(shared.body.mrn).toBe("MRN-1");
    expect(shared.body.findings).toContain("Demonstration");

    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const logs = await admin.get("/api/audit").set("x-facility-id", northId);
    expect(logs.status).toBe(200);
    expect(logs.body.logs.some((entry) => entry.action === "report.sign")).toBe(true);
    const status = await admin.get("/api/system/status");
    expect(status.body.smtp).toBe(false);
    expect(status.body.whatsapp).toBe(false);
    expect(status.body.ai).toBe(false);
    expect(status.body.mpr).toBe(false);
    expect(status.body.orthanc).toBe(false);
    expect(status.body.orthancHealth).toEqual({ configured: false, reachable: false });

    const count = await Patient.countDocuments({ mrn: "MRN-1" });
    expect(count).toBe(1);

    const nodeDenied = await tech.post("/api/dicom-nodes").set("x-facility-id", northId).send({
      facilityId: northId, name: "CT Room", aeTitle: "CTROOM", host: "127.0.0.1", port: 4242,
    });
    expect(nodeDenied.status).toBe(403);

    const nodeCreated = await admin.post("/api/dicom-nodes").set("x-facility-id", northId).send({
      facilityId: northId, name: "CT Room", aeTitle: "CTROOM", host: "127.0.0.1", port: 1,
    });
    expect(nodeCreated.status).toBe(201);
    const echo = await admin.post(`/api/dicom-nodes/${nodeCreated.body.node._id}/echo`).set("x-facility-id", northId);
    expect(echo.status).toBe(200);
    expect(echo.body.echo).toBe(false);
    expect(echo.body.reachable).toBe(false);
    expect(echo.body.error).toBeTruthy();

    const transfers = await admin.get("/api/transfers").set("x-facility-id", northId);
    expect(transfers.status).toBe(200);
    expect(transfers.body.counts.stored).toBeGreaterThan(0);

    const outsider = request.agent(app);
    await outsider.post("/api/auth/login").send({ email: "desk.south@galactic.test", password: "Galactic-Demo-2026" });
    const nodesHidden = await outsider.get("/api/dicom-nodes").set("x-facility-id", northId);
    expect(nodesHidden.status).toBe(403);
  });

  it("rejects a DICOM file whose study or SOP UID belongs to another facility", async () => {
    const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
    await User.create({
      name: "South Technologist",
      email: "tech.south@galactic.test",
      passwordHash,
      role: "technologist",
      facilityIds: [southId],
    });
    const dicom = buildSampleDicom({
      patientName: "Cross^Facility",
      patientId: "MRN-CROSS",
      accession: "ACC-CROSS",
    });
    const parsed = parseDicomBuffer(dicom);
    const storedPath = path.join(process.env.DICOM_DIR, `${parsed.sopUid.replace(/[^0-9.]/g, "_")}.dcm`);
    const north = request.agent(app);
    await north.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const first = await north.post("/api/dicom").field("facilityId", northId).attach("files", dicom, { filename: "cross.dcm", contentType: "application/dicom" });
    expect(first.status).toBe(201);
    const before = fs.readFileSync(storedPath);

    const south = request.agent(app);
    await south.post("/api/auth/login").send({ email: "tech.south@galactic.test", password: "Galactic-Demo-2026" });
    const second = await south.post("/api/dicom").field("facilityId", southId).attach("files", dicom, { filename: "cross.dcm", contentType: "application/dicom" });
    expect(second.status).toBe(400);
    expect(second.body.stored).toEqual([]);
    expect(second.body.rejected[0].error).toMatch(/another facility/);
    expect(fs.readFileSync(storedPath).equals(before)).toBe(true);
    expect(await Study.countDocuments({ studyUid: parsed.studyUid })).toBe(1);
    expect(String((await Study.findOne({ studyUid: parsed.studyUid })).facilityId)).toBe(northId);
    expect(await Instance.countDocuments({ sopUid: parsed.sopUid })).toBe(1);
  });

  it("keeps a signed report and lets only its author or a system administrator edit the draft", async () => {
    const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
    await User.create({
      name: "Dr. Second Reader",
      email: "reader.two@galactic.test",
      passwordHash,
      role: "radiologist",
      facilityIds: [northId],
    });
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const patient = await tech.post("/api/patients").send({ facilityId: northId, name: "Addendum Patient", mrn: "MRN-ADD", sex: "M" });
    const order = await tech.post("/api/studies").send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-ADD",
      modality: "CT",
      description: "Addendum study",
    });
    const author = request.agent(app);
    await author.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const created = await author.post("/api/reports").set("x-facility-id", northId).send({ studyId: order.body.study._id });
    expect(created.status).toBe(201);
    const reportId = created.body.report._id;

    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email: "reader.two@galactic.test", password: "Galactic-Demo-2026" });
    const blocked = await other.patch(`/api/reports/${reportId}`).send({ findings: "Changed by someone else" });
    expect(blocked.status).toBe(403);

    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const adminEdit = await admin.patch(`/api/reports/${reportId}`).send({ findings: "Administrator correction." });
    expect(adminEdit.status).toBe(200);

    const saved = await author.patch(`/api/reports/${reportId}`).send({
      technique: "Axial.",
      findings: "Original findings.",
      impression: "Original impression.",
    });
    expect(saved.status).toBe(200);
    expect(String(saved.body.report.authorId)).toBe(String(created.body.report.authorId));
    const preliminary = await author.post(`/api/reports/${reportId}/sign`).send({ level: "preliminary" });
    expect(preliminary.status).toBe(200);
    const signed = await author.post(`/api/reports/${reportId}/sign`).send({ level: "final" });
    expect(signed.status).toBe(200);
    const again = await author.post(`/api/reports/${reportId}/sign`).send({ level: "final" });
    expect(again.status).toBe(409);
    expect(again.body.report).toBeUndefined();

    const addendum = await author.post(`/api/reports/${reportId}/addendum`);
    expect(addendum.status).toBe(201);
    expect(addendum.body.report._id).not.toBe(reportId);
    expect(addendum.body.report.version).toBe(2);
    expect(addendum.body.report.status).toBe("draft");
    expect(addendum.body.original.status).toBe("final");
    expect(addendum.body.original.findings).toBe("Original findings.");
    const edited = await author.patch(`/api/reports/${addendum.body.report._id}`).send({ findings: "Addendum findings." });
    expect(edited.status).toBe(200);
    const listed = await author.get("/api/reports").set("x-facility-id", northId);
    const kept = listed.body.reports.find((item) => item._id === reportId);
    expect(kept.status).toBe("final");
    expect(kept.findings).toBe("Original findings.");
  });

  it("returns only preliminary and final reports to a referring physician", async () => {
    const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
    await User.create({
      name: "North Referring",
      email: "desk.north@galactic.test",
      passwordHash,
      role: "referring_physician",
      facilityIds: [northId],
    });
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const patient = await tech.post("/api/patients").send({ facilityId: northId, name: "Refer Patient", mrn: "MRN-REF", sex: "F" });
    const order = await tech.post("/api/studies").send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-REF",
      modality: "DX",
      description: "Referring visibility",
    });
    const author = request.agent(app);
    await author.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const created = await author.post("/api/reports").set("x-facility-id", northId).send({ studyId: order.body.study._id });
    const reportId = created.body.report._id;
    await author.patch(`/api/reports/${reportId}`).send({ findings: "Draft findings.", impression: "Draft impression." });

    const referring = request.agent(app);
    await referring.post("/api/auth/login").send({ email: "desk.north@galactic.test", password: "Galactic-Demo-2026" });
    const hidden = await referring.get("/api/reports").set("x-facility-id", northId);
    expect(hidden.status).toBe(200);
    expect(hidden.body.reports.some((item) => item._id === reportId)).toBe(false);
    expect(hidden.body.reports.every((item) => item.status === "preliminary" || item.status === "final")).toBe(true);
    const hiddenPdf = await referring.get(`/api/reports/${reportId}/pdf`);
    expect(hiddenPdf.status).toBe(404);

    const signed = await author.post(`/api/reports/${reportId}/sign`).send({ level: "preliminary" });
    expect(signed.status).toBe(200);
    const visible = await referring.get("/api/reports").set("x-facility-id", northId);
    expect(visible.body.reports.some((item) => item._id === reportId && item.status === "preliminary")).toBe(true);
    const pdf = await referring.get(`/api/reports/${reportId}/pdf`).buffer(true).parse(readBody);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");

    await author.post(`/api/reports/${reportId}/sign`).send({ level: "final" });
    const finals = await referring.get("/api/reports").set("x-facility-id", northId);
    expect(finals.body.reports.some((item) => item._id === reportId && item.status === "final")).toBe(true);
  });

  it("dumps MongoDB into a backup directory and hashes the file bytes", async () => {
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pacsd-backup-"));
    process.env.BACKUP_DIR = backupRoot;
    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const copied = await admin.post("/api/archive/backup").set("x-facility-id", northId);
    expect(copied.status).toBe(201);
    expect(copied.body.job.restoreTested).toBe(false);
    expect(copied.body.job.location.startsWith(backupRoot)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(copied.body.job.location, "manifest.json"), "utf8"));
    expect(manifest.restoreTested).toBe(false);
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.digest).not.toBe(crypto.createHash("sha256").update(`${manifest.fileCount}:${manifest.bytes}`).digest("hex"));

    const hash = crypto.createHash("sha256");
    const files = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name !== "manifest.json") files.push(full);
      }
    };
    walk(copied.body.job.location);
    for (const file of files.sort()) {
      hash.update(path.relative(copied.body.job.location, file).split(path.sep).join("/"));
      hash.update(Buffer.from([0]));
      hash.update(fs.readFileSync(file));
      hash.update(Buffer.from([0]));
    }
    expect(hash.digest("hex")).toBe(manifest.digest);
    expect(copied.body.job.digest).toBe(manifest.digest);

    const mongoDir = path.join(copied.body.job.location, "mongo");
    expect(fs.existsSync(mongoDir)).toBe(true);
    const dumped = fs.readdirSync(mongoDir).filter((name) => name.endsWith(".json"));
    expect(dumped.length).toBeGreaterThan(0);
    const mongoText = dumped.map((name) => fs.readFileSync(path.join(mongoDir, name), "utf8")).join("\n");
    expect(mongoText).toContain("admin@galactic.test");

    const compose = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docker-compose.yml"), "utf8");
    expect(compose).toContain("pacsd-backups:/app/server/pacsd-backups");
    expect(compose).toContain("BACKUP_DIR: /app/server/pacsd-backups");
  });
});

describe("client sessions", () => {
  it("sends a 401 to the login page and leaves a non-JSON body unparsed", () => {
    const denied = interpretResponse(401, JSON.stringify({ error: "Sign in required" }), "Unauthorized");
    expect(denied.redirect).toBe("/login");
    expect(denied.error).toBe("Sign in required");
    const proxy = interpretResponse(502, "<html><body>Bad gateway</body></html>", "Bad Gateway");
    expect(proxy.data).toBeNull();
    expect(proxy.redirect).toBe("");
    expect(proxy.error).toBe("Bad Gateway");
    expect(interpretResponse(200, "").data).toBeNull();
  });
});

describe("health", () => {
  it("reports the database and a writable data directory, and returns 503 when either fails", async () => {
    const healthy = await request(app).get("/api/health");
    expect(healthy.status).toBe(200);
    expect(healthy.body).toMatchObject({ ok: true, database: "connected", storage: "writable" });

    const blocker = path.join(os.tmpdir(), `pacsd-not-a-dir-${Date.now()}`);
    fs.writeFileSync(blocker, "x");
    const previous = process.env.DICOM_DIR;
    process.env.DICOM_DIR = blocker;
    try {
      const blocked = await request(app).get("/api/health");
      expect(blocked.status).toBe(503);
      expect(blocked.body.database).toBe("connected");
      expect(blocked.body.storage).toBe("unavailable");
      expect(blocked.body.ok).toBe(false);
    } finally {
      process.env.DICOM_DIR = previous;
      fs.rmSync(blocker, { force: true });
    }

    await disconnectDb();
    try {
      const down = await request(app).get("/api/health");
      expect(down.status).toBe(503);
      expect(down.body.database).toBe("unavailable");
    } finally {
      await connectDb(memory.getUri());
    }
  });
});

describe("security hardening", () => {
  it("sets a content security policy, ignores object query values, and checks study assignment", async () => {
    const health = await request(app).get("/api/health");
    expect(health.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(health.headers["content-security-policy"]).toContain("script-src 'self'");

    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const listed = await tech.get("/api/studies").query({ patientId: { $gt: "" } }).set("x-facility-id", northId);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.studies)).toBe(true);

    const patient = await tech.post("/api/patients").set("x-facility-id", northId).send({ facilityId: northId, name: "Assign Patient", mrn: "MRN-ASSIGN" });
    const study = await tech.post("/api/studies").set("x-facility-id", northId).send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-ASSIGN",
      modality: "CT",
      readingFacilityId: "507f1f77bcf86cd799439011",
    });
    expect(study.status).toBe(400);
    const created = await tech.post("/api/studies").set("x-facility-id", northId).send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-ASSIGN-2",
      modality: "CT",
    });
    expect(created.status).toBe(201);
    const outside = await tech.patch(`/api/studies/${created.body.study._id}`).send({ readingFacilityId: southId });
    expect(outside.status).toBe(403);
    const techUser = await User.findOne({ email: "tech.north@galactic.test" });
    const wrongRole = await tech.patch(`/api/studies/${created.body.study._id}`).send({ assignedTo: String(techUser._id) });
    expect(wrongRole.status).toBe(400);
    const reader = await User.findOne({ email: "kavita.menon@galactic.test" });
    const assigned = await tech.patch(`/api/studies/${created.body.study._id}`).send({ assignedTo: String(reader._id) });
    expect(assigned.status).toBe(200);
    expect(String(assigned.body.study.assignedTo)).toBe(String(reader._id));

    const uploaded = await tech.post("/api/dicom").set("x-facility-id", northId).attach("files", buildSampleDicom({ patientId: "MRN-DISK", accession: "ACC-DISK" }), "disk.dcm");
    expect(uploaded.status).toBe(201);

    const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"));
    expect(pkg.dependencies.multer.startsWith("^2") || pkg.dependencies.multer.startsWith("2")).toBe(true);
    expect(pkg.dependencies["mongodb-memory-server"]).toBeUndefined();
    expect(pkg.devDependencies["mongodb-memory-server"]).toBeTruthy();
    expect(pkg.dependencies.nodemailer.startsWith("^6.9.16")).toBe(false);
  });
});

describe("share links", () => {
  it("revokes a share, limits public traffic, and audits views, downloads, and patient search", async () => {
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    const patient = await tech.post("/api/patients").set("x-facility-id", northId).send({ facilityId: northId, name: "Share Patient", mrn: "MRN-SHARE" });
    expect(patient.status).toBe(201);
    const study = await tech.post("/api/studies").set("x-facility-id", northId).send({
      patientId: patient.body.patient._id,
      facilityId: northId,
      accession: "ACC-SHARE",
      modality: "CT",
    });
    expect(study.status).toBe(201);
    const searched = await tech.get("/api/patients").query({ q: "MRN-SHARE" }).set("x-facility-id", northId);
    expect(searched.status).toBe(200);

    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const created = await reader.post("/api/reports").send({ studyId: study.body.study._id });
    const reportId = created.body.report._id;
    await reader.patch(`/api/reports/${reportId}`).send({ findings: "Share findings.", impression: "Share impression." });
    expect((await reader.post(`/api/reports/${reportId}/sign`).send({ level: "final" })).status).toBe(200);
    const pdf = await reader.get(`/api/reports/${reportId}/pdf`).buffer(true).parse(readBody);
    expect(pdf.status).toBe(200);
    const link = await reader.post(`/api/reports/${reportId}/share`).send({ channel: "link" });
    expect(link.body.shareId).toBeTruthy();
    const token = link.body.link.split("/share/")[1];
    expect((await request(app).get(`/api/public/share/${token}`)).status).toBe(200);
    const publicPdf = await request(app).get(`/api/public/share/${token}/pdf`).buffer(true).parse(readBody);
    expect(publicPdf.headers["content-type"]).toContain("application/pdf");

    const southAdmin = request.agent(app);
    const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
    await User.create({ name: "South Administrator", email: "admin.south@galactic.test", passwordHash, role: "facility_admin", facilityIds: [southId] });
    await southAdmin.post("/api/auth/login").send({ email: "admin.south@galactic.test", password: "Galactic-Demo-2026" });
    expect((await southAdmin.post(`/api/shares/${link.body.shareId}/revoke`)).status).toBe(404);
    expect((await reader.post(`/api/shares/${link.body.shareId}/revoke`)).status).toBe(200);
    expect((await request(app).get(`/api/public/share/${token}`)).status).toBe(404);

    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const logs = await admin.get("/api/audit").set("x-facility-id", northId);
    const actions = logs.body.logs.map((entry) => entry.action);
    expect(actions).toContain("share.view");
    expect(actions).toContain("share.pdf");
    expect(actions).toContain("share.revoke");
    expect(actions).toContain("report.pdf");
    expect(actions).toContain("patient.search");

    process.env.PACSD_PUBLIC_RATE_LIMIT = "2";
    try {
      const limited = createApp();
      expect((await request(limited).get("/api/public/share/one")).status).toBe(404);
      expect((await request(limited).get("/api/public/share/two")).status).toBe(404);
      expect((await request(limited).get("/api/public/share/three")).status).toBe(429);
    } finally {
      delete process.env.PACSD_PUBLIC_RATE_LIMIT;
    }
  });
});

describe("accounts", () => {
  it("updates accounts, rotates sessions, resets passwords, and locks after five failures", async () => {
    const passwordHash = await bcrypt.hash("Galactic-Demo-2026", 8);
    const adminUser = await User.findOne({ email: "admin@galactic.test" });
    const staff = await User.create({
      name: "Lockout Staff",
      email: "lockout@galactic.test",
      passwordHash,
      role: "technologist",
      facilityIds: [northId],
    });
    await User.create({
      name: "North Administrator",
      email: "admin.north@galactic.test",
      passwordHash,
      role: "facility_admin",
      facilityIds: [northId],
    });

    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const northAdmin = request.agent(app);
    await northAdmin.post("/api/auth/login").send({ email: "admin.north@galactic.test", password: "Galactic-Demo-2026" });

    expect((await northAdmin.patch(`/api/users/${staff._id}`).send({ role: "system_admin" })).status).toBe(403);
    expect((await northAdmin.patch(`/api/users/${staff._id}`).send({ facilityIds: [southId] })).status).toBe(403);
    expect((await northAdmin.patch(`/api/users/${adminUser._id}`).send({ name: "Taken" })).status).toBe(404);
    const renamed = await northAdmin.patch(`/api/users/${staff._id}`).send({ name: "North Staff" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.name).toBe("North Staff");

    const staffSession = request.agent(app);
    const signedIn = await staffSession.post("/api/auth/login").send({ email: "lockout@galactic.test", password: "Galactic-Demo-2026" });
    const oldCookie = sessionCookie(signedIn);
    expect((await staffSession.post("/api/auth/change-password").send({ currentPassword: "Galactic-Demo-2026", password: "short" })).status).toBe(400);
    expect((await staffSession.post("/api/auth/change-password").send({ currentPassword: "nope", password: "A-new-password" })).status).toBe(401);
    const changed = await staffSession.post("/api/auth/change-password").send({ currentPassword: "Galactic-Demo-2026", password: "A-new-password" });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", sessionCookie(changed))).status).toBe(200);

    expect((await staffSession.post("/api/auth/logout")).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", sessionCookie(changed))).status).toBe(401);

    const reset = await admin.post(`/api/users/${staff._id}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    expect(reset.body.user.mustChangePassword).toBe(true);
    const temporary = request.agent(app);
    expect((await temporary.post("/api/auth/login").send({ email: "lockout@galactic.test", password: reset.body.temporaryPassword })).status).toBe(200);
    expect((await temporary.get("/api/studies").set("x-facility-id", northId)).status).toBe(403);
    expect((await temporary.post("/api/auth/change-password").send({ currentPassword: reset.body.temporaryPassword, password: "Changed-After-Reset" })).status).toBe(200);
    expect((await temporary.get("/api/studies").set("x-facility-id", northId)).status).toBe(200);

    const activeLogin = await request(app).post("/api/auth/login").send({ email: "lockout@galactic.test", password: "Changed-After-Reset" });
    const deactivated = await admin.patch(`/api/users/${staff._id}`).send({ active: false });
    expect(deactivated.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", sessionCookie(activeLogin))).status).toBe(401);

    await User.updateOne({ _id: staff._id }, { active: true, passwordHash: await bcrypt.hash("Lockout-Password", 8), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request(app).post("/api/auth/login").send({ email: "lockout@galactic.test", password: "wrong-password" })).status).toBe(401);
    }
    expect((await request(app).post("/api/auth/login").send({ email: "lockout@galactic.test", password: "Lockout-Password" })).status).toBe(423);
    await User.updateOne({ _id: staff._id }, { lockedUntil: new Date(Date.now() - 1000) });
    expect((await request(app).post("/api/auth/login").send({ email: "lockout@galactic.test", password: "Lockout-Password" })).status).toBe(200);
  });
});

describe("route coverage", () => {
  const fake = "507f1f77bcf86cd799439011";
  const people = {
    system_admin: { email: "admin@galactic.test", facility: () => northId },
    facility_admin: { email: "admin.north@galactic.test", facility: () => northId },
    radiologist: { email: "kavita.menon@galactic.test", facility: () => northId },
    technologist: { email: "tech.north@galactic.test", facility: () => northId },
    referring_physician: { email: "desk.south@galactic.test", facility: () => southId },
  };
  const routes = [
    ["get", "/api/auth/me", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["post", "/api/auth/change-password", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["get", "/api/system/status", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["get", "/api/facilities", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["post", "/api/facilities", ["system_admin"]],
    ["get", "/api/assignees", ["system_admin", "radiologist", "technologist"]],
    ["get", "/api/users", ["system_admin", "facility_admin"]],
    ["post", "/api/users", ["system_admin", "facility_admin"]],
    ["patch", `/api/users/${fake}`, ["system_admin", "facility_admin"]],
    ["post", `/api/users/${fake}/reset-password`, ["system_admin", "facility_admin"]],
    ["get", "/api/patients", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["post", "/api/patients", ["system_admin", "technologist"]],
    ["get", "/api/studies", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["post", "/api/studies", ["system_admin", "technologist"]],
    ["patch", `/api/studies/${fake}`, ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["get", `/api/studies/${fake}/series`, ["system_admin", "facility_admin", "radiologist", "technologist"]],
    ["post", "/api/dicom", ["system_admin", "technologist"]],
    ["get", `/api/instances/${fake}/pixels`, ["system_admin", "facility_admin", "radiologist", "technologist"]],
    ["get", `/api/instances/${fake}/pixels/raw`, ["system_admin", "facility_admin", "radiologist", "technologist"]],
    ["get", `/api/instances/${fake}/orthanc-preview`, ["system_admin", "facility_admin", "radiologist", "technologist"]],
    ["get", `/api/instances/${fake}/tags`, ["system_admin", "facility_admin", "radiologist", "technologist"]],
    ["get", "/api/dashboard", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["get", "/api/templates", ["system_admin", "facility_admin", "radiologist"]],
    ["get", "/api/reports", ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["post", "/api/reports", ["system_admin", "radiologist"]],
    ["patch", `/api/reports/${fake}`, ["system_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/sign`, ["system_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/addendum`, ["system_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/assist`, ["system_admin", "radiologist"]],
    ["get", `/api/reports/${fake}/pdf`, ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["get", `/api/reports/${fake}`, ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["get", `/api/reports/${fake}/docx`, ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["get", `/api/reports/${fake}/revisions`, ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["get", `/api/reports/${fake}/files`, ["system_admin", "facility_admin", "radiologist", "referring_physician"]],
    ["post", `/api/reports/${fake}/ai`, ["system_admin", "radiologist"]],
    ["post", "/api/templates", ["system_admin", "facility_admin", "radiologist"]],
    ["patch", `/api/templates/${fake}`, ["system_admin", "facility_admin", "radiologist"]],
    ["delete", `/api/templates/${fake}`, ["system_admin", "facility_admin", "radiologist"]],
    ["post", `/api/templates/${fake}/default`, ["system_admin", "facility_admin", "radiologist"]],
    ["patch", "/api/me/report-profile", ["system_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/share`, ["system_admin", "facility_admin", "radiologist"]],
    ["post", `/api/shares/${fake}/revoke`, ["system_admin", "facility_admin", "radiologist"]],
    ["get", "/api/audit", ["system_admin", "facility_admin"]],
    ["get", "/api/organization", ["system_admin", "facility_admin"]],
    ["patch", "/api/organization", ["system_admin"]],
    ["get", "/api/dicom-nodes", ["system_admin", "facility_admin"]],
    ["post", "/api/dicom-nodes", ["system_admin", "facility_admin"]],
    ["post", `/api/dicom-nodes/${fake}/echo`, ["system_admin", "facility_admin"]],
    ["get", "/api/transfers", ["system_admin", "facility_admin", "technologist"]],
    ["get", "/api/critical", ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"]],
    ["get", "/api/archive", ["system_admin", "facility_admin"]],
    ["get", "/api/system/health", ["system_admin", "facility_admin"]],
    ["get", "/api/notifications", ["system_admin", "facility_admin", "radiologist"]],
    ["get", "/api/referring-doctors", ["system_admin", "facility_admin"]],
    ["post", "/api/archive/backup", ["system_admin"]],
    ["post", "/api/speech/transcribe", ["system_admin", "radiologist"]],
    ["get", "/api/vocabulary", ["system_admin", "facility_admin", "radiologist"]],
    ["post", "/api/vocabulary", ["system_admin", "facility_admin"]],
    ["post", "/api/dictation/format", ["system_admin", "radiologist"]],
    ["post", "/api/dictation/coding", ["system_admin", "radiologist"]],
    ["get", `/api/reports/${fake}/dictation`, ["system_admin", "facility_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/dictation`, ["system_admin", "radiologist"]],
    ["post", `/api/reports/${fake}/coding`, ["system_admin", "radiologist"]],
    ["get", "/api/archive/backups", ["system_admin", "facility_admin"]],
  ];

  it("allows each route only for the roles that hold its permission", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
    const agents = {};
    for (const [role, person] of Object.entries(people)) {
      agents[role] = request.agent(app);
      expect((await agents[role].post("/api/auth/login").send({ email: person.email, password: "Galactic-Demo-2026" })).status).toBe(200);
    }
    for (const [method, path, allowed] of routes) {
      for (const [role, person] of Object.entries(people)) {
        const response = await agents[role][method](path).set("x-facility-id", person.facility()).send({});
        if (allowed.includes(role)) expect(response.status, `${role} ${method} ${path}`).not.toBe(403);
        else expect(response.status, `${role} ${method} ${path}`).toBe(403);
      }
    }
  });

  it("keeps one facility from reading or changing another facility's records", async () => {
    const northStudy = await Study.findOne({ facilityId: northId });
    const south = request.agent(app);
    await south.post("/api/auth/login").send({ email: "desk.south@galactic.test", password: "Galactic-Demo-2026" });
    const southReader = request.agent(app);
    await southReader.post("/api/auth/login").send({ email: "admin.south@galactic.test", password: "Galactic-Demo-2026" });
    expect((await south.get("/api/studies").set("x-facility-id", northId)).status).toBe(403);
    expect((await southReader.get(`/api/studies/${northStudy._id}/series`).set("x-facility-id", southId)).status).toBe(404);
    const tech = request.agent(app);
    await tech.post("/api/auth/login").send({ email: "tech.north@galactic.test", password: "Galactic-Demo-2026" });
    expect((await tech.post("/api/dicom").set("x-facility-id", southId)).status).toBe(403);
    const southAdmin = request.agent(app);
    await southAdmin.post("/api/auth/login").send({ email: "admin.south@galactic.test", password: "Galactic-Demo-2026" });
    const northUser = await User.findOne({ email: "tech.north@galactic.test" });
    expect((await southAdmin.patch(`/api/users/${northUser._id}`).send({ name: "Moved" })).status).toBe(404);
    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "admin@galactic.test", password: "Galactic-Demo-2026" });
    const patient = await admin.post("/api/patients").send({ facilityId: southId, name: "South Patient", mrn: "MRN-SOUTH-GATE" });
    const study = await admin.post("/api/studies").send({ patientId: patient.body.patient._id, facilityId: southId, accession: "ACC-SOUTH-GATE", modality: "DX" });
    expect((await south.patch(`/api/studies/${study.body.study._id}`).set("x-facility-id", southId).send({ status: "acquired" })).status).toBe(403);
    expect((await tech.patch(`/api/studies/${northStudy._id}`).set("x-facility-id", northId).send({ status: "acquired" })).status).not.toBe(403);
  });

  it("hides an expired share and a revoked share", async () => {
    const report = await Report.findOne({ status: "final" });
    const token = crypto.randomBytes(16).toString("hex");
    const share = await Share.create({
      reportId: report._id,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      channel: "link",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await request(app).get(`/api/public/share/${token}`)).status).toBe(404);
    share.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await share.save();
    expect((await request(app).get(`/api/public/share/${token}`)).status).toBe(200);
    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    expect((await reader.post(`/api/shares/${share._id}/revoke`)).status).toBe(200);
    expect((await request(app).get(`/api/public/share/${token}`)).status).toBe(404);
  });

  it("locks the account on the fifth failed login for 15 minutes", async () => {
    const email = "lockout.coverage@galactic.test";
    await User.create({
      name: "Coverage Lock",
      email,
      passwordHash: await bcrypt.hash("Galactic-Demo-2026", 8),
      role: "technologist",
      facilityIds: [northId],
      failedLoginCount: 4,
    });
    expect((await request(app).post("/api/auth/login").send({ email, password: "wrong-password" })).status).toBe(401);
    const locked = await User.findOne({ email });
    expect(locked.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(locked.lockedUntil.getTime()).toBeLessThan(Date.now() + 16 * 60 * 1000);
    expect((await request(app).post("/api/auth/login").send({ email, password: "Galactic-Demo-2026" })).status).toBe(423);
  });
});

describe("Orthanc client", () => {
  const previous = {
    url: process.env.ORTHANC_URL,
    username: process.env.ORTHANC_USERNAME,
    password: process.env.ORTHANC_PASSWORD,
  };

  afterAll(() => {
    if (previous.url === undefined) delete process.env.ORTHANC_URL;
    else process.env.ORTHANC_URL = previous.url;
    if (previous.username === undefined) delete process.env.ORTHANC_USERNAME;
    else process.env.ORTHANC_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.ORTHANC_PASSWORD;
    else process.env.ORTHANC_PASSWORD = previous.password;
  });

  it("skips health when the archive URL is missing", async () => {
    delete process.env.ORTHANC_URL;
    delete process.env.ORTHANC_USERNAME;
    delete process.env.ORTHANC_PASSWORD;
    await expect(orthancFetch("/system")).rejects.toMatchObject({ status: 503, message: "Orthanc is not configured" });
    expect(await orthancSystem()).toEqual({ configured: false, reachable: false });
  });

  it("sends basic authentication and reports a reachable archive", async () => {
    process.env.ORTHANC_URL = "http://orthanc.test";
    process.env.ORTHANC_USERNAME = "pacsd_backend";
    process.env.ORTHANC_PASSWORD = "archive-secret";
    const seen = [];
    const fetchImpl = async (url, options = {}) => {
      seen.push({ url: String(url), authorization: options.headers?.authorization || "" });
      return { ok: true, status: 200, json: async () => ({ Version: "1.13.0", Name: "MyOrthanc", DicomAet: "ORTHANC", DicomPort: 4242 }) };
    };
    expect(await orthancJson("/system", {}, fetchImpl)).toEqual({ Version: "1.13.0", Name: "MyOrthanc", DicomAet: "ORTHANC", DicomPort: 4242 });
    expect(await orthancSystem(fetchImpl)).toEqual({
      configured: true,
      reachable: true,
      version: "1.13.0",
      name: "MyOrthanc",
      dicomAet: "ORTHANC",
      dicomPort: 4242,
    });
    expect(seen[0].url).toBe("http://orthanc.test/system");
    expect(seen[0].authorization).toBe(`Basic ${Buffer.from("pacsd_backend:archive-secret").toString("base64")}`);
  });

  it("maps unauthenticated and invalid archive credentials to a safe error", async () => {
    process.env.ORTHANC_URL = "http://orthanc.test";
    process.env.ORTHANC_USERNAME = "pacsd_backend";
    process.env.ORTHANC_PASSWORD = "archive-secret";
    const unauthorized = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(orthancFetch("/system", {}, unauthorized)).rejects.toMatchObject({
      status: 502,
      orthancStatus: 401,
      message: "Orthanc rejected the archive credentials",
    });
    const forbidden = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(orthancFetch("/system", {}, forbidden)).rejects.toMatchObject({
      status: 502,
      orthancStatus: 403,
      message: "Orthanc rejected the archive credentials",
    });
  });

  it("maps a timeout and an unavailable archive", async () => {
    process.env.ORTHANC_URL = "http://orthanc.test";
    const timeout = async () => {
      throw createOrthancAbortError();
    };
    await expect(orthancFetch("/system", {}, timeout)).rejects.toMatchObject({
      status: 504,
      message: "Orthanc did not respond before the timeout",
    });
    const wrappedTimeout = async () => {
      const error = new Error("fetch failed");
      error.cause = createOrthancAbortError();
      throw error;
    };
    await expect(orthancFetch("/system", {}, wrappedTimeout)).rejects.toMatchObject({
      status: 504,
      message: "Orthanc did not respond before the timeout",
    });
    const down = async () => {
      throw new Error("fetch failed");
    };
    await expect(orthancFetch("/system", {}, down)).rejects.toMatchObject({
      status: 502,
      message: "Orthanc is unavailable",
    });
  });
});

describe("AI image analysis", () => {
  afterEach(() => {
    resetAiRateLimit();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.ORTHANC_URL;
  });

  async function radiologist() {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    return agent;
  }

  it("blocks users who cannot use AI and studies outside their facility", async () => {
    const stored = await ingestDicomBuffer({
      buffer: buildSampleDicom({ patientId: "MRN-AI-SOUTH", accession: "ACC-AI-SOUTH", patientName: "South^Patient" }),
      facilityId: southId,
      source: "upload",
      fileName: "south.dcm",
    });
    const referring = request.agent(app);
    await referring.post("/api/auth/login").send({ email: "desk.south@galactic.test", password: "Galactic-Demo-2026" });
    expect((await referring.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId })).status).toBe(403);
    const reader = await radiologist();
    expect((await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId })).status).toBe(404);
    expect((await reader.get("/api/ai/capabilities")).status).toBe(200);
    expect((await reader.get("/api/ai/capabilities")).body.capabilities.configured).toBe(false);
  });

  it("does not call the model when the preview or modality is unavailable", async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("fetch should not run");
    };
    try {
      const stored = await ingestDicomBuffer({
        buffer: buildSampleDicom({ patientId: "MRN-AI-PLAIN", accession: "ACC-AI-PLAIN", patientName: "Plain^Patient", modality: "CT" }),
        facilityId: northId,
        source: "upload",
        fileName: "plain.dcm",
      });
      const reader = await radiologist();
      const unconfigured = await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId, frame: 0 });
      expect(unconfigured.status).toBe(503);
      process.env.AI_BASE_URL = "https://ai.test/chat";
      process.env.AI_API_KEY = "test-key";
      const missing = await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId, frame: 0 });
      expect(missing.status).toBe(201);
      expect(missing.body.analysis.status).toBe("insufficient_quality");
      const other = await ingestDicomBuffer({
        buffer: buildSampleDicom({ patientId: "MRN-AI-OT", accession: "ACC-AI-OT", patientName: "Other^Patient", modality: "OT" }),
        facilityId: northId,
        source: "upload",
        fileName: "other.dcm",
      });
      const unsupported = await reader.post("/api/ai/analyses").send({ studyId: other.studyId, instanceId: other.instanceId });
      expect(unsupported.body.analysis.status).toBe("unsupported");
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("stores text findings without coordinates or patient identifiers and does not change the report", async () => {
    const stored = await ingestDicomBuffer({
      buffer: buildSampleDicom({ patientId: "MRN-AI-HIDDEN", accession: "ACC-AI-HIDDEN", patientName: "Hidden^Patient", modality: "CT" }),
      facilityId: northId,
      source: "upload",
      fileName: "hidden.dcm",
    });
    await Instance.updateOne({ _id: stored.instanceId }, { orthancId: "inst-ai" });
    const created = await (await radiologist()).post("/api/reports").set("x-facility-id", northId).send({ studyId: stored.studyId });
    const before = created.body.report.findings;
    process.env.ORTHANC_URL = "http://orthanc.test";
    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "general-vision";
    const sent = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      if (href.endsWith("/preview")) {
        return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
      }
      sent.push(String(options.body));
      const content = sent.length === 1
        ? { status: "completed", findings: [{ title: "<b>Density</b>", description: "A dense area is visible.", box: { x: 1, y: 1, width: 4, height: 4 }, confidence: 0.9 }], draft: { findings: "A dense area is visible." } }
        : { findings: "A dense area is visible.", impression: "Review the selected image.", clinical: "Not stated.", technique: "CT", comparison: "Not stated.", recommendations: "Not stated." };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
    };
    try {
      const reader = await radiologist();
      const analyzed = await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId, frame: 0 });
      expect(analyzed.status).toBe(201);
      expect(analyzed.body.analysis.status).toBe("review_recommended");
      expect(analyzed.body.analysis.findings[0].box).toBeNull();
      expect(analyzed.body.analysis.findings[0].title).toBe("Density");
      expect(analyzed.body.analysis.imagesAnalyzed).toEqual([{ instanceId: String(stored.instanceId), frame: 0, preview: true }]);
      expect(sent[0]).not.toContain("Hidden");
      expect(sent[0]).not.toContain("MRN-AI-HIDDEN");
      expect(sent[0]).not.toContain("test-key");
      const drafted = await reader.post(`/api/ai/analyses/${analyzed.body.analysis._id}/draft`).send({ clinical: "Cough for two days." });
      expect(drafted.status).toBe(200);
      expect(drafted.body.analysis.draft.impression).toContain("Review");
      expect(sent[1]).toContain("Cough for two days.");
      expect(sent[1]).not.toContain("Hidden");
      const report = await Report.findById(created.body.report._id);
      expect(report.findings).toBe(before);
      const accepted = await reader.post(`/api/ai/analyses/${analyzed.body.analysis._id}/sections`).send({ sections: ["impression"] });
      expect(accepted.body.analysis.acceptedSections.map((item) => item.section)).toEqual(["impression"]);
      expect((await Report.findById(created.body.report._id)).findings).toBe(before);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("records a failed analysis when the model response is invalid and limits repeated requests", async () => {
    const stored = await ingestDicomBuffer({
      buffer: buildSampleDicom({ patientId: "MRN-AI-BAD", accession: "ACC-AI-BAD", patientName: "Bad^Patient", modality: "CT" }),
      facilityId: northId,
      source: "upload",
      fileName: "bad.dcm",
    });
    await Instance.updateOne({ _id: stored.instanceId }, { orthancId: "inst-bad" });
    process.env.ORTHANC_URL = "http://orthanc.test";
    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/preview")) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1]).buffer };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) };
    };
    try {
      const reader = await radiologist();
      const failed = await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId });
      expect(failed.body.analysis.status).toBe("failed");
      resetAiRateLimit();
      for (let index = 0; index < 8; index += 1) {
        expect((await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId })).status).toBe(201);
      }
      expect((await reader.post("/api/ai/analyses").send({ studyId: stored.studyId, instanceId: stored.instanceId })).status).toBe(429);
    } finally {
      globalThis.fetch = original;
    }
  });
});
