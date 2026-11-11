import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sortInstances, volumeAssessment } from "../../shared/dicomGeometry.js";
import { createApp } from "../src/createApp.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { buildSampleDicom } from "../src/dicom.js";
import { ingestDicomBuffer } from "../src/ingest.js";
import { Facility, User } from "../src/models.js";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.COOKIE_SECURE = "false";
process.env.DICOM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pacsd-dicomweb-"));
delete process.env.ORTHANC_URL;
delete process.env.ORTHANC_USERNAME;
delete process.env.ORTHANC_PASSWORD;

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
    { name: "Dr. Kavita Menon", email: "kavita.menon@galactic.test", passwordHash, role: "radiologist", facilityIds: [north._id] },
    { name: "South Desk", email: "desk.south@galactic.test", passwordHash, role: "referring_physician", facilityIds: [south._id] },
    { name: "South Reader", email: "reader.south@galactic.test", passwordHash, role: "radiologist", facilityIds: [south._id] },
  ]);
});

afterAll(async () => {
  await disconnectDb();
  if (memory) await memory.stop();
});

describe("DICOM geometry", () => {
  it("sorts slices along the patient normal and rejects an inconsistent stack", () => {
    const orientation = [1, 0, 0, 0, 1, 0];
    const slices = [
      { sopUid: "1.2.3", instanceNumber: 2, rows: 4, columns: 4, pixelSpacing: [0.5, 0.5], imageOrientationPatient: orientation, imagePositionPatient: [0, 0, 5], numberOfFrames: 1 },
      { sopUid: "1.2.2", instanceNumber: 1, rows: 4, columns: 4, pixelSpacing: [0.5, 0.5], imageOrientationPatient: orientation, imagePositionPatient: [0, 0, 0], numberOfFrames: 1 },
    ];
    expect(sortInstances(slices).map((item) => item.sopUid)).toEqual(["1.2.2", "1.2.3"]);
    expect(volumeAssessment(slices).ready).toBe(true);
    expect(volumeAssessment([{ ...slices[1], imageOrientationPatient: [0, 1, 0, 0, 0, -1] }, slices[0]]).ready).toBe(false);
    expect(volumeAssessment([slices[1]]).ready).toBe(false);
  });
});

describe("DICOMweb proxy", () => {
  it("serves an authorized local instance and refuses everyone else", async () => {
    const studyUid = "1.2.826.0.1.3680043.10.543.77";
    const seriesUid = "1.2.826.0.1.3680043.10.543.78";
    const frame = "1.2.826.0.1.3680043.10.543.79";
    const orientation = "1\\0\\0\\0\\1\\0";
    const first = buildSampleDicom({
      studyUid,
      seriesUid,
      sopUid: "1.2.826.0.1.3680043.10.543.77.1",
      instanceNumber: 1,
      imagePosition: "0\\0\\0",
      imageOrientation: orientation,
      pixelSpacing: "0.5\\0.5",
      sliceThickness: "1",
      frameOfReferenceUid: frame,
      manufacturer: "Galactic",
      institution: "North Wing",
      modality: "CT",
      patientId: "VOL-1",
      patientName: "Volume^One",
      accession: "ACC-VOL-1",
    });
    const stored = await ingestDicomBuffer({ buffer: first, facilityId: northId, fileName: "slice-1.dcm" });
    await ingestDicomBuffer({
      buffer: buildSampleDicom({
        studyUid,
        seriesUid,
        sopUid: "1.2.826.0.1.3680043.10.543.77.2",
        instanceNumber: 2,
        imagePosition: "0\\0\\5",
        imageOrientation: orientation,
        pixelSpacing: "0.5\\0.5",
        sliceThickness: "1",
        frameOfReferenceUid: frame,
        modality: "CT",
        patientId: "VOL-1",
        patientName: "Volume^One",
        accession: "ACC-VOL-1",
      }),
      facilityId: northId,
      fileName: "slice-2.dcm",
    });

    const reader = request.agent(app);
    await reader.post("/api/auth/login").send({ email: "kavita.menon@galactic.test", password: "Galactic-Demo-2026" });
    const catalog = await reader.get(`/api/viewer/studies/${stored.studyId}/catalog`).set("x-facility-id", northId);
    expect(catalog.status).toBe(200);
    expect(JSON.stringify(catalog.body)).not.toContain("filePath");
    expect(catalog.body.patient.mrn).toBe("VOL-1");
    expect(catalog.body.series[0].volume.ready).toBe(true);
    expect(catalog.body.series[0].instances[0].manufacturer).toBe("Galactic");
    expect(catalog.body.orthancConfigured).toBe(false);

    const qido = await reader.get(`/api/dicomweb/studies?StudyInstanceUID=${studyUid}`).set("x-facility-id", northId);
    expect(qido.status).toBe(200);
    expect(qido.body[0]["0020000D"].Value[0]).toBe(studyUid);
    const metadata = await reader.get(`/api/dicomweb/studies/${studyUid}/series/${seriesUid}/metadata`).set("x-facility-id", northId);
    expect(metadata.status).toBe(200);
    expect(metadata.headers["content-type"]).toContain("application/dicom+json");
    expect(metadata.body).toHaveLength(2);
    expect(metadata.body[0]["00200032"].Value).toEqual([0, 0, 0]);

    const file = await reader.get(`/api/dicomweb/instances/${stored.instanceId}/file`).set("x-facility-id", northId).buffer(true).parse(readBody);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("application/dicom");
    expect(file.body.equals(first)).toBe(true);
    const cached = await reader.get(`/api/dicomweb/instances/${stored.instanceId}/file`).set("x-facility-id", northId).set("If-None-Match", file.headers.etag);
    expect(cached.status).toBe(304);

    const anonymous = await request(app).get(`/api/dicomweb/instances/${stored.instanceId}/file`);
    expect(anonymous.status).toBe(401);
    const referrer = request.agent(app);
    await referrer.post("/api/auth/login").send({ email: "desk.south@galactic.test", password: "Galactic-Demo-2026" });
    expect((await referrer.get(`/api/viewer/studies/${stored.studyId}/catalog`).set("x-facility-id", southId)).status).toBe(403);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ email: "reader.south@galactic.test", password: "Galactic-Demo-2026" });
    expect((await other.get(`/api/dicomweb/instances/${stored.instanceId}/file`).set("x-facility-id", southId)).status).toBe(404);

    const missingOrthanc = await reader.get(`/api/dicomweb/studies/${studyUid}/series/${seriesUid}/orthanc/metadata`).set("x-facility-id", northId);
    expect(missingOrthanc.status).toBe(503);
    expect(JSON.stringify(missingOrthanc.body)).not.toMatch(/password/i);

    const seriesId = catalog.body.series[0]._id;
    const saved = await reader.put(`/api/viewer/studies/${stored.studyId}/annotations`).set("x-facility-id", northId).send({
      seriesId,
      annotations: [{ annotationUID: "length-1", metadata: { toolName: "Length" }, data: { cachedStats: { a: { length: 12.5, unit: "mm" } } } }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.dicomSr).toBe(false);
    expect(saved.body.standard).toBe("application");
    const loaded = await reader.get(`/api/viewer/studies/${stored.studyId}/annotations`).set("x-facility-id", northId);
    expect(loaded.body.records[0].annotations[0].annotationUID).toBe("length-1");
    expect(loaded.body.notice).toMatch(/not DICOM SR/i);

    const preference = await reader.put("/api/viewer/preferences").set("x-facility-id", northId).send({
      layout: "1x2",
      windowPresets: [{ id: "narrow-liver", label: "Narrow liver", center: 90, width: 160 }],
    });
    expect(preference.status).toBe(200);
    const again = await reader.get("/api/viewer/preferences").set("x-facility-id", northId);
    expect(again.body.preference.layout).toBe("1x2");
    expect(again.body.preference.windowPresets[0].label).toBe("Narrow liver");
  });
});
