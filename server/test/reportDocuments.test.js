import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildReportDoc, paragraph, text } from "../../shared/reportDocument.js";
import { createApp } from "../src/createApp.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { resetAiRateLimit } from "../src/ai/routes.js";
import { Facility, ReportArtifact, ReportRevision, Template, User } from "../src/models.js";
import { richReportDoc } from "./fixtures/richReportDoc.js";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.COOKIE_SECURE = "false";
process.env.DICOM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pacsd-doc-"));
delete process.env.AI_BASE_URL;
delete process.env.ORTHANC_URL;

const PASSWORD = "Galactic-Demo-2026";
let memory;
let app;
let facilityId;

async function agentFor(email) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

function binary(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function newReport(admin, radiologist, accession, modality = "CT", description = "CT Brain without contrast") {
  const patient = await admin.post("/api/patients").send({ facilityId, name: `Patient ${accession}`, mrn: `MRN-${accession}`, sex: "F", birthDate: "1975-04-02" });
  const study = await admin.post("/api/studies").send({ patientId: patient.body.patient._id, facilityId, accession, modality, description });
  const created = await radiologist.post("/api/reports").set("x-facility-id", facilityId).send({ studyId: study.body.study._id });
  expect(created.status).toBeLessThan(300);
  return created.body.report;
}

function signedDoc() {
  return buildReportDoc({
    subtitle: "CT Brain",
    sections: {
      clinical: ["Headache."],
      technique: ["Non-contrast axial CT."],
      findings: ["No intracranial haemorrhage."],
      impression: ["No acute intracranial abnormality."],
    },
  });
}

beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await connectDb(memory.getUri());
  app = createApp();
  const facility = await Facility.create({ name: "GMS Document Wing", code: "GDW" });
  facilityId = String(facility._id);
  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  await User.create([
    { name: "GMS Administrator", email: "admin@doc.test", passwordHash, role: "system_admin", facilityIds: [facility._id] },
    { name: "Dr. Asha Rao", email: "asha@doc.test", passwordHash, role: "radiologist", facilityIds: [facility._id] },
    { name: "Dr. Ben Iyer", email: "ben@doc.test", passwordHash, role: "radiologist", facilityIds: [facility._id] },
  ]);
});

afterAll(async () => {
  await disconnectDb();
  if (memory) await memory.stop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  resetAiRateLimit();
});

describe("report documents", () => {
  it("saves a document, derives the sections, and refuses a stale revision", async () => {
    const admin = await agentFor("admin@doc.test");
    const asha = await agentFor("asha@doc.test");
    const report = await newReport(admin, asha, "ACC-DOC-1");

    const opened = await asha.get(`/api/reports/${report._id}`).set("x-facility-id", facilityId);
    expect(opened.status).toBe(200);
    expect(opened.body.patient.mrn).toBe("MRN-ACC-DOC-1");
    expect(opened.body.permissions.edit).toBe(true);

    const doc = richReportDoc();
    const saved = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId)
      .send({ doc, baseRevision: opened.body.report.revision || 0, reason: "manual" });
    expect(saved.status).toBe(200);
    expect(saved.body.report.revision).toBe(1);
    expect(saved.body.report.clinical).toContain("Headache");
    expect(saved.body.report.findings).toContain("Bold");

    const stale = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId)
      .send({ doc, baseRevision: 0, reason: "autosave" });
    expect(stale.status).toBe(409);
    expect(stale.body.revision).toBe(1);

    const revisions = await asha.get(`/api/reports/${report._id}/revisions`).set("x-facility-id", facilityId);
    expect(revisions.status).toBe(200);
    expect(revisions.body.revisions.length).toBeGreaterThan(0);
    expect(await ReportRevision.countDocuments({ reportId: report._id })).toBeGreaterThan(0);

    const pdf = await asha.get(`/api/reports/${report._id}/pdf`).set("x-facility-id", facilityId).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
    const docx = await asha.get(`/api/reports/${report._id}/docx`).set("x-facility-id", facilityId).buffer(true).parse(binary);
    expect(docx.status).toBe(200);
    expect(docx.headers["content-disposition"]).toMatch(/attachment/);
    expect(docx.body.slice(0, 2).toString()).toBe("PK");

    const other = await agentFor("ben@doc.test");
    const blocked = await other.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc, baseRevision: 1 });
    expect(blocked.status).toBe(403);
  });

  it("blocks signing while AI suggestions remain and stores the signed files", async () => {
    const admin = await agentFor("admin@doc.test");
    const asha = await agentFor("asha@doc.test");
    const report = await newReport(admin, asha, "ACC-DOC-2");

    const pending = signedDoc();
    const findings = pending.content.find((node) => node.type === "heading" && node.attrs?.sectionKey === "findings");
    const index = pending.content.indexOf(findings);
    pending.content.splice(index + 1, 0, paragraph([text("AI suggested sentence.", [{ type: "aiSuggestion", attrs: { id: "s1" } }])]));
    await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc: pending, baseRevision: 0 });
    const refused = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "final" });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/AI/i);

    await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc: signedDoc(), baseRevision: 1 });
    const signed = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "final" });
    expect(signed.status).toBe(200);
    expect(signed.body.report.status).toBe("final");
    const artifacts = await ReportArtifact.find({ reportId: report._id });
    expect(artifacts.map((item) => item.kind).sort()).toEqual(["docx", "pdf"]);
    expect(artifacts.every((item) => item.accession === "ACC-DOC-2")).toBe(true);

    const files = await asha.get(`/api/reports/${report._id}/files`).set("x-facility-id", facilityId);
    expect(files.status).toBe(200);
    expect(files.body.files).toHaveLength(2);
    const edit = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc: signedDoc(), baseRevision: 3 });
    expect(edit.status).toBe(409);
  });

  it("manages templates and picks one default per modality", async () => {
    const asha = await agentFor("asha@doc.test");
    const ben = await agentFor("ben@doc.test");
    const list = await asha.get("/api/templates").set("x-facility-id", facilityId);
    expect(list.status).toBe(200);
    const names = list.body.templates.map((item) => item.name);
    for (const name of ["CT Brain", "CT Chest", "CT Abdomen", "CT KUB", "MRI Brain", "MRI Spine", "MRI Knee", "MRI Shoulder", "X-Ray Chest", "X-Ray KUB", "X-Ray Spine", "X-Ray Extremities", "Ultrasound Abdomen", "Ultrasound Pelvis"]) {
      expect(names).toContain(name);
    }
    const builtin = list.body.templates.find((item) => item.name === "CT Brain");
    expect((await asha.delete(`/api/templates/${builtin._id}`).set("x-facility-id", facilityId)).status).toBe(403);

    const created = await asha.post("/api/templates").set("x-facility-id", facilityId)
      .send({ name: "CT Brain stroke", modality: "CT", description: "Stroke protocol", keywords: ["stroke"], doc: signedDoc() });
    expect(created.status).toBe(201);
    const id = created.body.template._id;
    expect((await ben.patch(`/api/templates/${id}`).set("x-facility-id", facilityId).send({ name: "Taken" })).status).toBe(403);
    const renamed = await asha.patch(`/api/templates/${id}`).set("x-facility-id", facilityId).send({ name: "CT Brain stroke v2" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.template.name).toBe("CT Brain stroke v2");

    expect((await asha.post(`/api/templates/${id}/default`).set("x-facility-id", facilityId)).status).toBe(200);
    const defaults = await Template.find({ modality: "CT", isDefault: true });
    expect(defaults.map((item) => String(item._id))).toEqual([id]);

    expect((await asha.delete(`/api/templates/${id}`).set("x-facility-id", facilityId)).status).toBe(200);
    expect(await Template.findById(id)).toBeNull();
  });

  it("returns AI writing help as an unapplied suggestion", async () => {
    const admin = await agentFor("admin@doc.test");
    const asha = await agentFor("asha@doc.test");
    const report = await newReport(admin, asha, "ACC-DOC-3");

    const offline = await asha.post(`/api/reports/${report._id}/ai`).set("x-facility-id", facilityId).send({ task: "grammar", text: "teh lung" });
    expect(offline.status).toBe(503);

    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "The lung is clear." }) } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const missing = await asha.post(`/api/reports/${report._id}/ai`).set("x-facility-id", facilityId).send({ task: "grammar" });
    expect(missing.status).toBe(400);
    const answered = await asha.post(`/api/reports/${report._id}/ai`).set("x-facility-id", facilityId).send({ task: "grammar", text: "teh lung is clear" });
    expect(answered.status).toBe(200);
    expect(answered.body.result).toMatchObject({ task: "grammar", text: "The lung is clear.", applied: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps personal shortcuts and locks a finalized report", async () => {
    const admin = await agentFor("admin@doc.test");
    const asha = await agentFor("asha@doc.test");
    const shortcuts = await asha.get("/api/me/report-shortcuts");
    expect(shortcuts.status).toBe(200);
    expect(shortcuts.body.shortcuts.map((item) => item.trigger)).toEqual(expect.arrayContaining(["nh", "nch", "nlf"]));
    const replaced = await asha.put("/api/me/report-shortcuts").send({
      shortcuts: [
        { trigger: "nh", expansion: "No significant abnormality.", favourite: true },
        { trigger: "nad", expansion: "No acute abnormality.", favourite: false },
      ],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.shortcuts).toHaveLength(2);

    const report = await newReport(admin, asha, "ACC-DOC-SIGN");
    const saved = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId)
      .send({ doc: signedDoc(), baseRevision: 0, reason: "manual" });
    expect(saved.status).toBe(200);
    expect(saved.body.report.workflow).toBe("in_progress");
    const pending = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "preliminary" });
    expect(pending.status).toBe(200);
    expect(pending.body.report.workflow).toBe("pending_signature");
    expect(pending.body.report.signatureRecord.method).toBe("authenticated-session");
    const final = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "final" });
    expect(final.status).toBe(200);
    expect(final.body.report.workflow).toBe("finalized");
    const locked = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc: signedDoc(), baseRevision: final.body.report.revision });
    expect(locked.status).toBe(409);
    const addendum = await asha.post(`/api/reports/${report._id}/addendum`).set("x-facility-id", facilityId).send({});
    expect(addendum.status).toBe(201);
    expect(String(addendum.body.report.priorReportId)).toBe(String(report._id));
    expect(addendum.body.original.status).toBe("final");
  });

  it("stores the radiologist signature profile", async () => {
    const asha = await agentFor("asha@doc.test");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const saved = await asha.patch("/api/me/report-profile").send({ qualifications: "MD, DNB (Radiology)", signatureImage: png });
    expect(saved.status).toBe(200);
    const profile = await asha.get("/api/me/report-profile");
    expect(profile.body.profile.qualifications).toBe("MD, DNB (Radiology)");
    expect(profile.body.profile.signatureMethods[0].style).toBe("image");
    expect((await asha.patch("/api/me/report-profile").send({ signatureImage: "javascript:alert(1)" })).status).toBe(400);
    const created = await asha.patch("/api/me/report-profile").send({
      signatureMethods: [{
        id: "consultant-signature",
        label: "Consultant signature",
        designation: "Consultant Radiologist",
        qualifications: "MD, DNB (Radiodiagnosis)",
        registrationNumber: "TN-12345",
        style: "typed",
        isDefault: true,
      }],
    });
    expect(created.status).toBe(200);
    expect(created.body.profile.signatureMethods[0]).toMatchObject({
      label: "Consultant signature",
      designation: "Consultant Radiologist",
      qualifications: "MD, DNB (Radiodiagnosis)",
    });
    expect(created.body.profile.name).toBeTruthy();
    const admin = await agentFor("admin@doc.test");
    const report = await newReport(admin, asha, "ACC-DOC-METHOD");
    const drafted = await asha.patch(`/api/reports/${report._id}`).set("x-facility-id", facilityId).send({ doc: signedDoc(), baseRevision: 0, reason: "manual" });
    expect(drafted.status).toBe(200);
    const missing = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "preliminary", signatureMethodId: "missing" });
    expect(missing.status).toBe(400);
    const signed = await asha.post(`/api/reports/${report._id}/sign`).set("x-facility-id", facilityId).send({ level: "preliminary", signatureMethodId: "consultant-signature" });
    expect(signed.status).toBe(200);
    expect(signed.body.report.signatureRecord.method).toBe("authenticated-session");
    expect(signed.body.report.signatureRecord.designation).toBe("Consultant Radiologist");
    expect(signed.body.report.signatureRecord.name).toBe(created.body.profile.name);
  });
});
