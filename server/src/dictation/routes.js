import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { TERM_CATEGORIES, VOCABULARY_NOTICE } from "../../../shared/dictation/terms.js";
import { interpretDictation } from "../../../shared/dictation/pipeline.js";
import { suggestCodes } from "../../../shared/dictation/coding.js";
import { imagingContext } from "../../../shared/dictation/context.js";
import { searchVocabulary } from "../../../shared/dictation/vocabulary.js";
import { DictationTurn, MedicalTerm, Report } from "../models.js";
import { can, canAccessFacility, facilityIdsOf } from "../permissions.js";
import { canEditReport } from "../reportDocuments.js";
import { inspectAudio, transcribeDictation } from "./transcribe.js";

const LICENSED_SOURCES = new Set(["radlex", "snomed", "icd10", "loinc"]);
const termFields = {
  term: z.string().trim().min(2).max(120),
  spoken: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  category: z.enum(TERM_CATEGORIES).optional(),
  modalities: z.array(z.string().trim().max(12)).max(8).optional(),
  bodyParts: z.array(z.string().trim().max(40)).max(8).optional(),
  contexts: z.array(z.string().trim().max(40)).max(12).optional(),
  abbreviation: z.string().trim().max(20).optional(),
  source: z.enum(["custom", "radlex", "snomed", "icd10", "loinc"]).optional(),
  code: z.string().trim().max(32).optional(),
  codeSystem: z.string().trim().max(40).optional(),
};

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (!["audio/webm", "audio/wav", "audio/wave", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/flac", "application/octet-stream", ""].includes(mime)) {
      const error = new Error("Upload a WAV, WebM, MP3, M4A, or Ogg audio file.");
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const speechLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  validate: false,
  keyGenerator: (req) => String(req.user?._id || "speech"),
  message: { error: "Too many transcription requests. Wait a moment and continue." },
});

function licenseProblem(items, acknowledged) {
  if (items.some((item) => LICENSED_SOURCES.has(item.source || "custom")) && !acknowledged) {
    return "RadLex, SNOMED CT, LOINC, and ICD-10 can be imported only after the facility accepts the publisher license.";
  }
  return "";
}

function publicTerm(item) {
  return {
    id: item._id ? String(item._id) : "",
    term: item.term,
    spoken: item.spoken || [],
    category: item.category || "clinical",
    modalities: item.modalities || [],
    bodyParts: item.bodyParts || [],
    contexts: item.contexts || [],
    abbreviation: item.abbreviation || "",
    source: item.source || "curated",
    code: item.code || "",
    codeSystem: item.codeSystem || "",
    managed: Boolean(item._id),
    active: item.active !== false,
  };
}

async function loadTerms(req) {
  const facilityId = req.selectedFacilityId || "";
  const filter = { active: true };
  if (req.user.role === "system_admin") {
    filter.$or = facilityId ? [{ facilityId }, { facilityId: null }] : [{ facilityId: null }, { facilityId: { $exists: true } }];
  } else {
    filter.$or = [{ facilityId: { $in: facilityIdsOf(req.user) } }, { facilityId: null }];
  }
  return MedicalTerm.find(filter).limit(2000).lean();
}

async function loadReport(req, id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) return null;
  const report = await Report.findById(id);
  if (!report || !canAccessFacility(req.user, report.facilityId)) return null;
  return report;
}

export function registerDictation(app, { requireUser, requirePermission, wrap, audit, selectedFacility }) {
  function withFacility(req, _res, next) {
    req.selectedFacilityId = selectedFacility(req);
    next();
  }

  app.get("/api/vocabulary", requireUser, requirePermission("vocabulary.read"), withFacility, wrap(async (req, res) => {
    const stored = await loadTerms(req);
    const context = imagingContext({
      modality: req.query.modality,
      description: req.query.description,
      bodyPart: req.query.bodyPart,
    });
    const terms = searchVocabulary(req.query.q || "", {
      context: req.query.context || context.key,
      category: req.query.category || "",
      extraTerms: stored,
      limit: req.query.limit || 80,
    }).map(publicTerm);
    res.json({
      context: { key: context.key, label: context.label },
      terms,
      notice: VOCABULARY_NOTICE,
      canWrite: can(req.user, "vocabulary.write"),
    });
  }));

  app.post("/api/vocabulary", requireUser, requirePermission("vocabulary.write"), withFacility, wrap(async (req, res) => {
    const body = z.object({ ...termFields, licenseAcknowledged: z.boolean().optional() }).parse(req.body);
    const problem = licenseProblem([body], body.licenseAcknowledged);
    if (problem) return res.status(400).json({ error: problem });
    const facilityId = req.user.role === "system_admin" ? (req.selectedFacilityId || null) : req.selectedFacilityId;
    if (req.user.role !== "system_admin" && !canAccessFacility(req.user, facilityId)) {
      return res.status(403).json({ error: "Facility is outside your access" });
    }
    const existing = await MedicalTerm.findOne({ facilityId, term: body.term, active: true });
    if (existing) return res.status(409).json({ error: "That medical term is already in the vocabulary" });
    const created = await MedicalTerm.create({ ...body, facilityId, createdBy: req.user._id, source: body.source || "custom" });
    await audit(req, "vocabulary.create", "vocabulary", created._id, facilityId, { source: created.source });
    res.status(201).json({ term: publicTerm(created.toObject()) });
  }));

  app.patch("/api/vocabulary/:id", requireUser, requirePermission("vocabulary.write"), withFacility, wrap(async (req, res) => {
    const body = z.object({ ...termFields, active: z.boolean().optional(), licenseAcknowledged: z.boolean().optional() }).partial().parse(req.body);
    const term = await MedicalTerm.findById(req.params.id);
    if (!term || (term.facilityId && !canAccessFacility(req.user, term.facilityId))) return res.status(404).json({ error: "Term not found" });
    const problem = licenseProblem([{ source: body.source || term.source }], body.licenseAcknowledged);
    if (problem) return res.status(400).json({ error: problem });
    Object.assign(term, body);
    await term.save();
    await audit(req, "vocabulary.update", "vocabulary", term._id, term.facilityId, { source: term.source });
    res.json({ term: publicTerm(term.toObject()) });
  }));

  app.delete("/api/vocabulary/:id", requireUser, requirePermission("vocabulary.write"), wrap(async (req, res) => {
    const term = await MedicalTerm.findById(req.params.id);
    if (!term || (term.facilityId && !canAccessFacility(req.user, term.facilityId))) return res.status(404).json({ error: "Term not found" });
    term.active = false;
    await term.save();
    await audit(req, "vocabulary.retire", "vocabulary", term._id, term.facilityId, {});
    res.json({ ok: true });
  }));

  app.post("/api/vocabulary/import", requireUser, requirePermission("vocabulary.write"), withFacility, wrap(async (req, res) => {
    const body = z.object({
      licenseAcknowledged: z.boolean().optional(),
      items: z.array(z.object(termFields)).min(1).max(1000),
    }).parse(req.body);
    const problem = licenseProblem(body.items, body.licenseAcknowledged);
    if (problem) return res.status(400).json({ error: problem });
    const facilityId = req.user.role === "system_admin" ? (req.selectedFacilityId || null) : req.selectedFacilityId;
    if (req.user.role !== "system_admin" && !canAccessFacility(req.user, facilityId)) {
      return res.status(403).json({ error: "Facility is outside your access" });
    }
    const existing = new Set((await MedicalTerm.find({ facilityId, active: true }).select("term").lean()).map((item) => item.term.toLowerCase()));
    const docs = body.items
      .filter((item) => !existing.has(item.term.toLowerCase()))
      .map((item) => ({ ...item, facilityId, createdBy: req.user._id, source: item.source || "custom", active: true }));
    if (docs.length) await MedicalTerm.insertMany(docs);
    await audit(req, "vocabulary.import", "vocabulary", "", facilityId, { count: docs.length });
    res.status(201).json({ imported: docs.length, skipped: body.items.length - docs.length });
  }));

  app.post("/api/dictation/format", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const body = z.object({
      text: z.string().max(20000),
      modality: z.string().max(16).optional(),
      description: z.string().max(300).optional(),
      bodyPart: z.string().max(80).optional(),
    }).parse(req.body);
    res.json(interpretDictation(body.text, body));
  }));

  app.post("/api/dictation/coding", requireUser, requirePermission("report.write"), withFacility, wrap(async (req, res) => {
    const body = z.object({
      impression: z.string().max(8000),
      modality: z.string().max(16).optional(),
      description: z.string().max(300).optional(),
      bodyPart: z.string().max(80).optional(),
    }).parse(req.body);
    const context = imagingContext(body);
    const stored = await loadTerms(req);
    res.json(suggestCodes({ impression: body.impression, context, vocabulary: stored }));
  }));

  app.get("/api/reports/:id/dictation", requireUser, requirePermission("dictation.read"), wrap(async (req, res) => {
    const report = await loadReport(req, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const turns = await DictationTurn.find({ reportId: report._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ turns });
  }));

  app.post("/api/reports/:id/dictation", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const report = await loadReport(req, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (!canEditReport(req.user, report)) return res.status(403).json({ error: "Only the report author or a system administrator can edit this draft" });
    const body = z.object({
      originalText: z.string().max(20000).optional(),
      text: z.string().max(20000).optional(),
      language: z.string().max(12).optional(),
      model: z.string().max(80).optional(),
      contextKey: z.string().max(40).optional(),
    }).parse(req.body);
    if (!String(body.originalText || body.text || "").trim()) return res.status(400).json({ error: "Dictation text is required" });
    const turn = await DictationTurn.create({
      reportId: report._id,
      studyId: report.studyId,
      facilityId: report.facilityId,
      authorId: req.user._id,
      language: body.language || "",
      model: body.model || "",
      contextKey: body.contextKey || "",
      originalText: body.originalText || "",
      text: body.text || "",
    });
    await audit(req, "report.dictation", "report", report._id, report.facilityId, { characters: (body.originalText || "").length, model: body.model || "" });
    res.status(201).json({ id: turn._id, createdAt: turn.createdAt });
  }));

  app.post("/api/reports/:id/coding", requireUser, requirePermission("report.write"), withFacility, wrap(async (req, res) => {
    const report = await loadReport(req, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (!canEditReport(req.user, report)) return res.status(403).json({ error: "Only the report author or a system administrator can edit this draft" });
    if (report.status === "final") return res.status(409).json({ error: "A final report cannot be edited" });
    const body = z.object({
      confirm: z.literal(true),
      impression: z.string().min(1).max(8000),
      modality: z.string().max(16).optional(),
      description: z.string().max(300).optional(),
      bodyPart: z.string().max(80).optional(),
      codes: z.array(z.object({
        system: z.string().trim().min(2).max(40),
        code: z.string().trim().regex(/^[A-Za-z0-9.\-]{2,32}$/),
        description: z.string().trim().min(3).max(200),
        sourceText: z.string().max(200).optional(),
        manual: z.boolean().optional(),
      })).max(12),
    }).parse(req.body);
    const context = imagingContext({ modality: body.modality, description: body.description, bodyPart: body.bodyPart });
    const allowed = suggestCodes({ impression: body.impression, context, vocabulary: await loadTerms(req) });
    const allowedKeys = new Set(allowed.suggestions.map((item) => `${item.system}:${item.code}`));
    const approved = [];
    for (const item of body.codes) {
      const known = allowed.suggestions.find((suggestion) => suggestion.system === item.system && suggestion.code === item.code);
      if (!known && !item.manual) {
        return res.status(400).json({ error: "That code is not a suggestion for this impression. Enter it as a manual correction if you have confirmed it." });
      }
      if (!item.manual && !allowedKeys.has(`${item.system}:${item.code}`)) {
        return res.status(400).json({ error: "That code is not a suggestion for this impression." });
      }
      approved.push({
        system: item.system,
        code: item.code,
        description: item.manual ? item.description : (known?.description || item.description),
        confidence: item.manual ? null : (known?.confidence ?? null),
        sourceText: (item.sourceText || known?.sourceText || "").slice(0, 200),
        caveat: known?.caveat || "",
        manual: Boolean(item.manual),
        approvedBy: req.user._id,
        approvedAt: new Date(),
      });
    }
    report.coding = approved;
    report.markModified("coding");
    await report.save();
    await audit(req, "report.coding", "report", report._id, report.facilityId, { count: approved.length, systems: [...new Set(approved.map((item) => item.system))] });
    res.json({ coding: report.coding });
  }));

  app.post("/api/speech/transcribe", requireUser, requirePermission("report.write"), speechLimiter, audioUpload.single("audio"), withFacility, wrap(async (req, res) => {
    const problem = inspectAudio(req.file);
    if (problem) return res.status(400).json({ error: problem });
    const language = String(req.body?.language || "en").slice(0, 12);
    const modality = String(req.body?.modality || "").slice(0, 16);
    const description = String(req.body?.description || "").slice(0, 300);
    const bodyPart = String(req.body?.bodyPart || "").slice(0, 80);
    req.selectedFacilityId = selectedFacility(req);
    const vocabulary = await loadTerms(req);
    const result = await transcribeDictation({
      bytes: req.file.buffer,
      filename: req.file.originalname || "dictation.wav",
      mime: req.file.mimetype || "audio/wav",
      language,
      modality,
      description,
      bodyPart,
      vocabulary,
    });
    await audit(req, "report.transcribe", "report", "", req.selectedFacilityId || null, {
      bytes: req.file.size,
      language: language.split("-")[0],
      model: result.model,
    });
    res.json(result);
  }));
}
