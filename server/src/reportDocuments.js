import crypto from "node:crypto";
import { z } from "zod";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_SHORTCUTS,
  appendAddendumSection,
  builtinTemplateDoc,
  docStats,
  isDocNode,
  normalizeLayout,
} from "../../shared/reportDocument.js";
import { AuditLog, Facility, Patient, Report, ReportArtifact, ReportRevision, ReportShortcut, Share, Study, Template, User } from "./models.js";
import { can, canAccessFacility, facilityIdsOf } from "./permissions.js";
import { reportFileName, exportContext } from "./reportExport/common.js";
import { renderDocumentDocx } from "./reportExport/docx.js";
import { renderDocumentPdf } from "./reportExport/pdf.js";

export const MAX_DOC_BYTES = 12 * 1024 * 1024;
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
const MAX_REVISIONS = 200;
const DEFAULT_FOR_MODALITY = new Set(["CT Brain", "MRI Brain", "X-Ray Chest", "Ultrasound Abdomen"]);

const userFields = "name email role qualifications registrationNumber signatureImage";

export function signerIdentity(signer, report) {
  const snap = report?.signatureRecord;
  if (!snap?.name) return signer;
  const base = signer?.toObject ? signer.toObject() : { ...(signer || {}) };
  return {
    ...base,
    name: snap.name,
    qualifications: snap.qualifications || "",
    registrationNumber: snap.registrationNumber || "",
    signatureImage: snap.signatureImage || "",
    designation: snap.designation || "",
    style: snap.style || "",
  };
}

const SIGNATURE_IMAGE = /^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/;

const signatureMethodSchema = z.object({
  id: z.string().trim().max(40).optional(),
  label: z.string().trim().min(1).max(80),
  designation: z.string().trim().max(80).optional(),
  qualifications: z.string().trim().max(200).optional(),
  registrationNumber: z.string().trim().max(40).optional(),
  style: z.enum(["typed", "image", "drawn"]),
  signatureImage: z.string().max(400000).regex(SIGNATURE_IMAGE).optional(),
  isDefault: z.boolean().optional(),
});

export function publicProfile(user) {
  return {
    name: user.name,
    qualifications: user.qualifications || "",
    registrationNumber: user.registrationNumber || "",
    signatureImage: user.signatureImage || "",
    signatureMethods: (user.signatureMethods || []).map((method) => ({
      id: method.id,
      label: method.label,
      designation: method.designation || "",
      qualifications: method.qualifications || "",
      registrationNumber: method.registrationNumber || "",
      style: method.style || "typed",
      signatureImage: method.signatureImage || "",
      isDefault: Boolean(method.isDefault),
    })),
  };
}

export function normalizeSignatureMethods(list) {
  const parsed = z.array(signatureMethodSchema).max(8).parse(list);
  let defaultSeen = false;
  const methods = parsed.map((item) => {
    const isDefault = Boolean(item.isDefault) && !defaultSeen;
    if (isDefault) defaultSeen = true;
    const style = item.style;
    return {
      id: item.id || crypto.randomUUID(),
      label: item.label.trim(),
      designation: (item.designation || "Consultant Radiologist").trim(),
      qualifications: (item.qualifications || "").trim(),
      registrationNumber: (item.registrationNumber || "").trim(),
      style,
      signatureImage: style === "typed" ? "" : (item.signatureImage || ""),
      isDefault,
    };
  });
  if (methods.length && !methods.some((item) => item.isDefault)) methods[0].isDefault = true;
  return methods;
}

function syncLegacyFromMethods(user) {
  const chosen = (user.signatureMethods || []).find((item) => item.isDefault) || user.signatureMethods?.[0];
  if (!chosen) return;
  user.qualifications = chosen.qualifications || "";
  user.registrationNumber = chosen.registrationNumber || "";
  user.signatureImage = chosen.style === "typed" ? "" : (chosen.signatureImage || "");
}

function absorbLegacyProfile(user) {
  const methods = (user.signatureMethods || []).map((item) => ({ ...item.toObject?.() || item }));
  const index = methods.findIndex((item) => item.isDefault);
  const current = index >= 0 ? methods[index] : null;
  const next = {
    id: current?.id || crypto.randomUUID(),
    label: current?.label || "Radiologist signature",
    designation: current?.designation || "Consultant Radiologist",
    qualifications: user.qualifications || "",
    registrationNumber: user.registrationNumber || "",
    style: user.signatureImage ? (current?.style === "drawn" ? "drawn" : "image") : "typed",
    signatureImage: user.signatureImage || "",
    isDefault: true,
  };
  if (current) methods[index] = next;
  else methods.unshift(next);
  user.signatureMethods = methods.map((item, position) => ({ ...item, isDefault: position === (current ? index : 0) }));
  user.markModified("signatureMethods");
}

export function signatureAppearance(user, signatureMethodId) {
  const methods = user.signatureMethods || [];
  if (signatureMethodId) {
    const chosen = methods.find((item) => item.id === signatureMethodId);
    if (!chosen) return { error: "That signature method is not saved on this account." };
    return appearanceFrom(user, chosen);
  }
  const fallback = methods.find((item) => item.isDefault) || null;
  return appearanceFrom(user, fallback);
}

function appearanceFrom(user, chosen) {
  if (!chosen) {
    return {
      qualifications: user.qualifications || "",
      registrationNumber: user.registrationNumber || "",
      signatureImage: user.signatureImage || "",
      designation: "",
      style: user.signatureImage ? "image" : "typed",
      methodLabel: "",
      methodId: "",
    };
  }
  const style = chosen.style || "typed";
  return {
    qualifications: chosen.qualifications || "",
    registrationNumber: chosen.registrationNumber || "",
    signatureImage: style === "typed" ? "" : (chosen.signatureImage || ""),
    designation: chosen.designation || "",
    style,
    methodLabel: chosen.label || "",
    methodId: chosen.id || "",
  };
}

export async function reportRecords(report) {
  const study = await Study.findById(report.studyId);
  const patient = study ? await Patient.findById(study.patientId) : null;
  const facility = study ? await Facility.findById(study.facilityId) : null;
  const author = report.authorId ? await User.findById(report.authorId).select(userFields) : null;
  const signerId = report.signedBy?._id || report.signedBy;
  const signer = signerId ? await User.findById(signerId).select(userFields) : null;
  return { report, study, patient, facility, author, signer: signerIdentity(signer, report) };
}

export function docBytes(doc) {
  return Buffer.byteLength(JSON.stringify(doc || {}), "utf8");
}

export function validateDoc(doc) {
  if (!isDocNode(doc)) return "The report document is not valid";
  if (docBytes(doc) > MAX_DOC_BYTES) return "The report document is too large. Reduce the size or number of images.";
  return "";
}

export function canEditReport(user, report) {
  if (!can(user, "report.write") || !canAccessFacility(user, report.facilityId)) return false;
  if (report.status === "final") return false;
  if (report.status === "draft") {
    const isAuthor = report.authorId && String(report.authorId) === String(user._id);
    return user.role === "system_admin" || Boolean(isAuthor);
  }
  return true;
}

// Stores a snapshot when forced, or when the last one is older than five minutes.
export async function snapshotRevision(report, user, reason, force = false) {
  const now = Date.now();
  const due = !report.lastSnapshotAt || now - new Date(report.lastSnapshotAt).getTime() > SNAPSHOT_EVERY_MS;
  if (!force && !due) return null;
  if (!isDocNode(report.doc)) return null;
  const revision = await ReportRevision.create({
    reportId: report._id,
    facilityId: report.facilityId,
    revision: report.revision || 0,
    reason,
    status: report.status,
    doc: report.doc,
    layout: report.layout,
    words: docStats(report.doc).words,
    savedBy: user?._id,
  });
  report.lastSnapshotAt = new Date(now);
  const stale = await ReportRevision.find({ reportId: report._id }).sort({ createdAt: -1 }).skip(MAX_REVISIONS).select("_id");
  if (stale.length) await ReportRevision.deleteMany({ _id: { $in: stale.map((item) => item._id) } });
  return revision;
}

export async function renderReportFile(report, kind) {
  const records = await reportRecords(report);
  const ctx = exportContext(records);
  const bytes = kind === "docx" ? await renderDocumentDocx(records) : await renderDocumentPdf(records);
  return {
    bytes,
    fileName: reportFileName(ctx, kind),
    contentType: kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
    records,
  };
}

// Renders and stores the signed PDF and DOCX against the report's patient and study.
export async function attachSignedArtifacts(report, user) {
  const stored = [];
  for (const kind of ["pdf", "docx"]) {
    const file = await renderReportFile(report, kind);
    const { study, patient } = file.records;
    await ReportArtifact.deleteMany({ reportId: report._id, kind, status: report.status });
    const artifact = await ReportArtifact.create({
      reportId: report._id,
      studyId: report.studyId,
      patientId: patient?._id,
      facilityId: report.facilityId,
      accession: study?.accession || "",
      mrn: patient?.mrn || "",
      kind,
      status: report.status,
      reportVersion: report.version || 1,
      revision: report.revision || 0,
      fileName: file.fileName,
      contentType: file.contentType,
      bytes: file.bytes,
      size: file.bytes.length,
      sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      createdBy: user?._id,
    });
    stored.push(artifactSummary(artifact));
  }
  return stored;
}

export function artifactSummary(artifact) {
  return {
    _id: artifact._id,
    kind: artifact.kind,
    status: artifact.status,
    fileName: artifact.fileName,
    size: artifact.size,
    sha256: artifact.sha256,
    accession: artifact.accession,
    mrn: artifact.mrn,
    reportVersion: artifact.reportVersion,
    revision: artifact.revision,
    createdAt: artifact.createdAt,
  };
}

export function addendumDoc(original, user) {
  if (!isDocNode(original.doc)) return null;
  return appendAddendumSection(original.doc, { author: user?.name || "" });
}

let builtinsReady = null;

export function ensureBuiltinTemplates() {
  if (!builtinsReady) {
    builtinsReady = (async () => {
      for (const spec of BUILTIN_TEMPLATES) {
        const exists = await Template.exists({ builtin: true, name: spec.name });
        if (exists) continue;
        await Template.create({
          name: spec.name,
          modality: spec.modality,
          keywords: spec.keywords,
          description: `Standard ${spec.name} structure. Section labels only; no findings are pre-filled.`,
          doc: builtinTemplateDoc(spec),
          builtin: true,
          isDefault: DEFAULT_FOR_MODALITY.has(spec.name),
        });
      }
    })().catch((error) => {
      builtinsReady = null;
      throw error;
    });
  }
  return builtinsReady;
}

export function resetBuiltinTemplateCache() {
  builtinsReady = null;
}

function templateFilter(user) {
  if (user.role === "system_admin") return {};
  const ids = facilityIdsOf(user);
  return {
    $or: [
      { personal: { $ne: true }, facilityId: null },
      { personal: { $ne: true }, facilityId: { $exists: false } },
      { personal: { $ne: true }, facilityId: { $in: ids } },
      { personal: true, createdBy: user._id },
    ],
  };
}

function canManageTemplate(user, template) {
  if (!can(user, "template.write")) return false;
  if (user.role === "system_admin") return true;
  if (template.builtin) return false;
  if (template.personal) return Boolean(template.createdBy && String(template.createdBy) === String(user._id));
  if (user.role === "facility_admin") return Boolean(template.facilityId && canAccessFacility(user, template.facilityId));
  return Boolean(template.createdBy && String(template.createdBy) === String(user._id));
}

const templateBody = z.object({
  name: z.string().trim().min(2).max(120),
  modality: z.string().trim().max(8).optional(),
  description: z.string().max(500).optional(),
  keywords: z.array(z.string().trim().max(40)).max(20).optional(),
  doc: z.record(z.any()),
  layout: z.record(z.any()).nullable().optional(),
  isDefault: z.boolean().optional(),
  personal: z.boolean().optional(),
  facilityId: z.string().nullable().optional(),
});

async function clearOtherDefaults(template) {
  await Template.updateMany({ _id: { $ne: template._id }, modality: template.modality || "" }, { $set: { isDefault: false } });
}

export function registerReportDocuments(app, { requireUser, requirePermission, wrap, audit }) {
  async function loadReport(req, res) {
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) {
      res.status(404).json({ error: "Report not found" });
      return null;
    }
    if (req.user.role === "referring_physician" && !["preliminary", "final"].includes(report.status)) {
      res.status(404).json({ error: "Report not found" });
      return null;
    }
    return report;
  }

  app.get("/api/reports/:id", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const records = await reportRecords(report);
    const artifacts = await ReportArtifact.find({ reportId: report._id }).select("-bytes").sort({ createdAt: -1 });
    const prior = report.priorReportId ? await Report.findById(report.priorReportId).select("status version signedAt") : null;
    const addendum = report.status === "final" ? await Report.findOne({ priorReportId: report._id }).select("status version") : null;
    res.json({
      report,
      study: records.study,
      patient: records.patient,
      facility: records.facility,
      author: records.author ? { _id: records.author._id, name: records.author.name, qualifications: records.author.qualifications, registrationNumber: records.author.registrationNumber, signatureImage: records.author.signatureImage } : null,
      signer: records.signer ? { _id: records.signer._id, name: records.signer.name, qualifications: records.signer.qualifications, registrationNumber: records.signer.registrationNumber, signatureImage: records.signer.signatureImage } : null,
      prior,
      addendum,
      artifacts: artifacts.map(artifactSummary),
      permissions: {
        edit: canEditReport(req.user, report),
        sign: can(req.user, "report.sign") && report.status !== "final",
        share: can(req.user, "report.share"),
        addendum: can(req.user, "report.write") && report.status === "final",
        templates: can(req.user, "template.read"),
        manageTemplates: can(req.user, "template.write"),
        ai: can(req.user, "ai.use"),
      },
    });
  }));

  app.get("/api/reports/:id/revisions", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const revisions = await ReportRevision.find({ reportId: report._id }).sort({ createdAt: -1 }).limit(100).select("-doc -layout").populate("savedBy", "name");
    res.json({ revisions });
  }));

  app.get("/api/reports/:id/revisions/:revisionId", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const revision = await ReportRevision.findOne({ _id: req.params.revisionId, reportId: report._id }).populate("savedBy", "name");
    if (!revision) return res.status(404).json({ error: "Revision not found" });
    res.json({ revision });
  }));

  async function sendFile(req, res, kind) {
    const report = await loadReport(req, res);
    if (!report) return;
    let file = null;
    if (report.status === "final") {
      const artifact = await ReportArtifact.findOne({ reportId: report._id, kind, status: "final" }).sort({ createdAt: -1 });
      if (artifact) file = { bytes: artifact.bytes, fileName: artifact.fileName, contentType: artifact.contentType };
    }
    if (!file) file = await renderReportFile(report, kind);
    await audit(req, `report.${kind}`, "report", report._id, report.facilityId, { download: req.query.download === "1" });
    res.setHeader("content-type", file.contentType);
    const disposition = kind === "docx" || req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("content-disposition", `${disposition}; filename="${file.fileName}"`);
    res.setHeader("cache-control", "no-store");
    // The editor shows the PDF in a same-origin print preview frame.
    res.setHeader("content-security-policy", "frame-ancestors 'self'");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    res.send(Buffer.from(file.bytes));
  }

  app.get("/api/reports/:id/pdf", requireUser, requirePermission("report.read"), wrap(async (req, res) => sendFile(req, res, "pdf")));
  app.get("/api/reports/:id/docx", requireUser, requirePermission("report.read"), wrap(async (req, res) => sendFile(req, res, "docx")));

  app.get("/api/reports/:id/files", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const artifacts = await ReportArtifact.find({ reportId: report._id }).select("-bytes").sort({ createdAt: -1 });
    res.json({ files: artifacts.map(artifactSummary) });
  }));

  app.get("/api/reports/:id/files/:fileId", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const artifact = await ReportArtifact.findOne({ _id: req.params.fileId, reportId: report._id });
    if (!artifact) return res.status(404).json({ error: "File not found" });
    await audit(req, "report.file_download", "report", report._id, report.facilityId, { kind: artifact.kind, sha256: artifact.sha256 });
    res.setHeader("content-type", artifact.contentType);
    res.setHeader("content-disposition", `attachment; filename="${artifact.fileName}"`);
    res.send(Buffer.from(artifact.bytes));
  }));

  // ---------- templates ----------

  app.get("/api/templates", requireUser, requirePermission("template.read"), wrap(async (req, res) => {
    await ensureBuiltinTemplates();
    const filter = templateFilter(req.user);
    if (req.query.modality) filter.modality = String(req.query.modality).toUpperCase();
    const templates = await Template.find(filter).sort({ builtin: -1, modality: 1, name: 1 }).populate("createdBy", "name");
    res.json({
      templates: templates.map((template) => ({ ...template.toObject(), canManage: canManageTemplate(req.user, template) })),
    });
  }));

  app.post("/api/templates", requireUser, requirePermission("template.write"), wrap(async (req, res) => {
    const body = templateBody.parse(req.body);
    const problem = validateDoc(body.doc);
    if (problem) return res.status(400).json({ error: problem });
    const personal = Boolean(body.personal);
    if (!personal && body.facilityId && !canAccessFacility(req.user, body.facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const template = await Template.create({
      name: body.name,
      modality: (body.modality || "").toUpperCase(),
      description: body.description || "",
      keywords: (body.keywords || []).map((item) => item.toLowerCase()).filter(Boolean),
      doc: body.doc,
      layout: body.layout ? normalizeLayout(body.layout) : null,
      isDefault: Boolean(body.isDefault),
      personal,
      facilityId: personal ? undefined : (body.facilityId || undefined),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    if (template.isDefault) await clearOtherDefaults(template);
    await audit(req, "template.create", "template", template._id, template.facilityId, { name: template.name, modality: template.modality });
    res.status(201).json({ template: { ...template.toObject(), canManage: true } });
  }));

  app.patch("/api/templates/:id", requireUser, requirePermission("template.write"), wrap(async (req, res) => {
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (!canManageTemplate(req.user, template)) return res.status(403).json({ error: "Only the template owner or a system administrator can change this template" });
    const body = templateBody.partial().parse(req.body);
    if (body.doc !== undefined) {
      const problem = validateDoc(body.doc);
      if (problem) return res.status(400).json({ error: problem });
      template.doc = body.doc;
      template.markModified("doc");
    }
    if (body.name !== undefined) template.name = body.name;
    if (body.modality !== undefined) template.modality = body.modality.toUpperCase();
    if (body.description !== undefined) template.description = body.description;
    if (body.keywords !== undefined) template.keywords = body.keywords.map((item) => item.toLowerCase()).filter(Boolean);
    if (body.layout !== undefined) {
      template.layout = body.layout ? normalizeLayout(body.layout) : null;
      template.markModified("layout");
    }
    if (body.isDefault !== undefined) template.isDefault = body.isDefault;
    template.updatedBy = req.user._id;
    await template.save();
    if (template.isDefault) await clearOtherDefaults(template);
    await audit(req, "template.update", "template", template._id, template.facilityId, { name: template.name });
    res.json({ template: { ...template.toObject(), canManage: true } });
  }));

  app.delete("/api/templates/:id", requireUser, requirePermission("template.write"), wrap(async (req, res) => {
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (!canManageTemplate(req.user, template)) return res.status(403).json({ error: "Only the template owner or a system administrator can delete this template" });
    await template.deleteOne();
    await audit(req, "template.delete", "template", template._id, template.facilityId, { name: template.name });
    res.json({ ok: true });
  }));

  app.post("/api/templates/:id/duplicate", requireUser, requirePermission("template.write"), wrap(async (req, res) => {
    const source = await Template.findById(req.params.id);
    if (!source) return res.status(404).json({ error: "Template not found" });
    const visible = await Template.findOne({ _id: source._id, ...templateFilter(req.user) });
    if (!visible && req.user.role !== "system_admin") return res.status(404).json({ error: "Template not found" });
    const body = z.object({ name: z.string().trim().min(2).max(120).optional(), personal: z.boolean().optional() }).parse(req.body || {});
    const personal = body.personal !== false;
    const template = await Template.create({
      name: body.name || `${source.name} copy`.slice(0, 120),
      modality: source.modality,
      description: source.description,
      keywords: source.keywords,
      doc: source.doc,
      layout: source.layout,
      personal,
      facilityId: personal ? undefined : source.facilityId,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await audit(req, "template.duplicate", "template", template._id, template.facilityId, { source: source.name });
    res.status(201).json({ template: { ...template.toObject(), canManage: true } });
  }));

  app.post("/api/templates/:id/default", requireUser, requirePermission("template.write"), wrap(async (req, res) => {
    const template = await Template.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    const body = z.object({ isDefault: z.boolean().default(true) }).parse(req.body || {});
    template.isDefault = body.isDefault;
    await template.save();
    if (template.isDefault) await clearOtherDefaults(template);
    await audit(req, "template.default", "template", template._id, template.facilityId, { modality: template.modality, isDefault: template.isDefault });
    res.json({ template });
  }));

  // ---------- radiologist profile used in signatures ----------

  app.get("/api/me/report-profile", requireUser, wrap(async (req, res) => {
    res.json({ profile: publicProfile(req.user) });
  }));

  app.patch("/api/me/report-profile", requireUser, requirePermission("report.sign"), wrap(async (req, res) => {
    const body = z.object({
      qualifications: z.string().max(200).optional(),
      registrationNumber: z.string().max(40).optional(),
      signatureImage: z.string().max(400000).regex(SIGNATURE_IMAGE).optional(),
      signatureMethods: z.array(signatureMethodSchema).max(8).optional(),
    }).parse(req.body);
    if (body.signatureMethods) {
      req.user.signatureMethods = normalizeSignatureMethods(body.signatureMethods);
      req.user.markModified("signatureMethods");
      syncLegacyFromMethods(req.user);
    } else {
      if (body.qualifications !== undefined) req.user.qualifications = body.qualifications.trim();
      if (body.registrationNumber !== undefined) req.user.registrationNumber = body.registrationNumber.trim();
      if (body.signatureImage !== undefined) req.user.signatureImage = body.signatureImage;
      absorbLegacyProfile(req.user);
    }
    await req.user.save();
    await audit(req, "user.report_profile", "user", req.user._id, null, { signatureImage: Boolean(req.user.signatureImage), methods: (req.user.signatureMethods || []).length });
    res.json({ profile: publicProfile(req.user) });
  }));

  app.get("/api/me/report-shortcuts", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    let shortcuts = await ReportShortcut.find({ userId: req.user._id }).sort({ trigger: 1 });
    if (!shortcuts.length) {
      shortcuts = await ReportShortcut.insertMany(DEFAULT_SHORTCUTS.map((item) => ({ ...item, userId: req.user._id })));
    }
    res.json({ shortcuts });
  }));

  app.put("/api/me/report-shortcuts", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const body = z.object({
      shortcuts: z.array(z.object({
        trigger: z.string().trim().min(1).max(12).regex(/^[a-z0-9]+$/i),
        expansion: z.string().trim().min(1).max(500),
        favourite: z.boolean().optional(),
      })).max(200),
    }).parse(req.body);
    const seen = new Set();
    const rows = [];
    for (const item of body.shortcuts) {
      const trigger = item.trigger.toLowerCase();
      if (seen.has(trigger)) continue;
      seen.add(trigger);
      rows.push({ userId: req.user._id, trigger, expansion: item.expansion, favourite: Boolean(item.favourite) });
    }
    await ReportShortcut.deleteMany({ userId: req.user._id });
    const shortcuts = rows.length ? await ReportShortcut.insertMany(rows) : [];
    await audit(req, "report.shortcuts", "user", req.user._id, null, { count: shortcuts.length });
    res.json({ shortcuts });
  }));

  app.get("/api/reports/:id/priors", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const study = await Study.findById(report.studyId);
    if (!study) return res.json({ priors: [] });
    const studies = await Study.find({ patientId: study.patientId, facilityId: report.facilityId }).select("accession modality description studyDate");
    const byId = new Map(studies.map((item) => [String(item._id), item]));
    const priors = await Report.find({
      studyId: { $in: studies.map((item) => item._id) },
      _id: { $ne: report._id },
      status: { $in: ["preliminary", "final"] },
    }).sort({ signedAt: -1 }).limit(20).select("studyId status workflow signedAt impression version");
    res.json({
      priors: priors.map((item) => {
        const priorStudy = byId.get(String(item.studyId));
        return {
          _id: item._id,
          status: item.status,
          workflow: item.workflow,
          signedAt: item.signedAt,
          version: item.version,
          impression: String(item.impression || "").slice(0, 400),
          accession: priorStudy?.accession || "",
          modality: priorStudy?.modality || "",
          description: priorStudy?.description || "",
          studyDate: priorStudy?.studyDate || "",
        };
      }),
    });
  }));

  app.get("/api/reports/:id/deliveries", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const shares = await Share.find({ reportId: report._id }).sort({ createdAt: -1 }).limit(50).select("-tokenHash");
    res.json({ deliveries: shares });
  }));

  app.get("/api/reports/:id/audit", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const shares = await Share.find({ reportId: report._id }).select("_id");
    const ids = [String(report._id), ...shares.map((item) => String(item._id))];
    const entries = await AuditLog.find({ entityId: { $in: ids } }).sort({ createdAt: -1 }).limit(100).select("action actorEmail entity createdAt meta");
    res.json({ entries });
  }));

  app.patch("/api/reports/:id/contact", requireUser, requirePermission("report.share"), wrap(async (req, res) => {
    const report = await loadReport(req, res);
    if (!report) return;
    const body = z.object({
      phone: z.string().max(20).optional(),
      email: z.string().max(160).optional(),
      countryCode: z.string().max(6).optional(),
      consent: z.boolean().optional(),
    }).parse(req.body);
    const study = await Study.findById(report.studyId);
    const patient = study ? await Patient.findById(study.patientId) : null;
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    if (body.phone !== undefined) patient.phone = body.phone.trim();
    if (body.email !== undefined) patient.email = body.email.trim();
    if (body.countryCode !== undefined) patient.countryCode = body.countryCode.trim();
    if (body.consent !== undefined) {
      patient.reportingConsent = body.consent;
      patient.reportingConsentAt = body.consent ? new Date() : undefined;
    }
    await patient.save();
    await audit(req, "patient.report_contact", "patient", patient._id, report.facilityId, { consent: patient.reportingConsent });
    res.json({
      contact: {
        phone: patient.phone,
        email: patient.email,
        countryCode: patient.countryCode,
        reportingConsent: patient.reportingConsent,
      },
    });
  }));
}
