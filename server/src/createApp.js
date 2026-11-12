import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import multer from "multer";
import { z } from "zod";
import { cookieSecure, dataDir, publicBaseUrl, sessionSecret, webOrigin } from "./config.js";
import { createUid, dicomTagSummary, isUncompressedLittleEndian, orthancDecodedFrameName, parseDicomBuffer } from "./dicom.js";
import { registerAi } from "./ai/routes.js";
import { registerDictation } from "./dictation/routes.js";
import { registerDicomweb } from "./dicomweb.js";
import { registerEnterprise } from "./enterprise.js";
import { ingestDicomBuffer } from "./ingest.js";
import { subscribeStudyChanges } from "./liveEvents.js";
import { importNotifiedInstance } from "./orthancSync.js";
import {
  AuditLog,
  Facility,
  Instance,
  Patient,
  Report,
  Series,
  Share,
  Study,
  User,
} from "./models.js";
import { integrationStatus, normalizePhone, orthancPreview, requestReportAssist, sendReportEmail, sendWhatsApp, sendWhatsAppDocument, whatsappConfigured, whatsappWebUrl } from "./notify.js";
import { localDicomPath } from "./dicomFiles.js";
import { orthancBytes, orthancSystem } from "./orthancClient.js";
import { can, canAccessFacility, facilityIdsOf, ROLES } from "./permissions.js";
import { DOC_FORMAT, SECTION_KEYS, extractSections, finalizationProblems, isDocNode, normalizeLayout } from "../../shared/reportDocument.js";
import {
  addendumDoc,
  attachSignedArtifacts,
  canEditReport,
  registerReportDocuments,
  renderReportFile,
  signatureAppearance,
  signerIdentity,
  snapshotRevision,
  validateDoc,
} from "./reportDocuments.js";
import { renderDocumentPdf } from "./reportExport/pdf.js";

const COOKIE = "pacsd_session";
const uploadDir = path.join(os.tmpdir(), "pacsd-uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, `${crypto.randomBytes(12).toString("hex")}${path.extname(file.originalname || "").replace(/[^.a-zA-Z0-9]/g, "")}`),
  }),
  limits: { fileSize: 16 * 1024 * 1024, files: 8 },
});

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function asyncHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion || 0 }, sessionSecret(), { expiresIn: "12h" });
}

function setSession(res, user) {
  res.cookie(COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

async function audit(req, action, entity, entityId, facilityId, meta = {}) {
  await AuditLog.create({
    actorId: req.user?._id,
    actorEmail: req.user?.email || "",
    action,
    entity,
    entityId: entityId ? String(entityId) : "",
    facilityId: facilityId || undefined,
    ip: req.ip,
    meta,
  });
}

function requireUser(req, res, next) {
  const token = req.cookies?.[COOKIE] || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    req.auth = jwt.verify(token, sessionSecret());
  } catch {
    return res.status(401).json({ error: "Sign in required" });
  }
  User.findById(req.auth.sub)
    .then((user) => {
      if (!user?.active) return res.status(401).json({ error: "Sign in required" });
      if ((user.tokenVersion || 0) !== (req.auth.tv || 0)) return res.status(401).json({ error: "Sign in required" });
      req.user = user;
      if (user.mustChangePassword && !passwordChangeAllowed(req)) {
        return res.status(403).json({ error: "Change your password before continuing" });
      }
      return next();
    })
    .catch(next);
}

function passwordChangeAllowed(req) {
  return req.path === "/api/auth/me" || req.path === "/api/auth/logout" || req.path === "/api/auth/change-password";
}

function bumpToken(user) {
  user.tokenVersion = (user.tokenVersion || 0) + 1;
}

function accountScopeError(actor, role, facilityIds, existingIds = []) {
  if (actor.role !== "system_admin" && role === "system_admin") return "You cannot create a system administrator";
  const existing = new Set((existingIds || []).map((id) => String(id)));
  for (const facilityId of facilityIds || []) {
    if (actor.role === "system_admin" || canAccessFacility(actor, facilityId) || existing.has(String(facilityId))) continue;
    return "Facility is outside your administration scope";
  }
  return "";
}

async function loadManagedUser(actor, id) {
  const user = await User.findById(id);
  if (!user) return null;
  if (actor.role === "system_admin") return user;
  if (user.role === "system_admin") return null;
  const allowed = new Set(facilityIdsOf(actor));
  return user.facilityIds.some((facilityId) => allowed.has(String(facilityId))) ? user : null;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) return res.status(403).json({ error: "You do not have permission for that action" });
    return next();
  };
}

function scopedFacilityFilter(user, requested) {
  if (user.role === "system_admin") {
    return requested ? { facilityId: requested } : {};
  }
  const allowed = facilityIdsOf(user);
  if (requested) {
    if (!allowed.includes(String(requested))) return null;
    return { facilityId: requested };
  }
  return { facilityId: { $in: allowed } };
}

function selectedFacility(req) {
  return req.get("x-facility-id") || req.query.facilityId || "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadReadableStudy(req, id) {
  const study = await Study.findById(id);
  if (!study || !canAccessFacility(req.user, study.facilityId)) return null;
  return study;
}

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  facilityIds: user.facilityIds,
  active: user.active,
  mustChangePassword: Boolean(user.mustChangePassword),
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use((req, _res, next) => {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] !== "string") req.query[key] = "";
    }
    next();
  });
  app.use(cors({ origin: webOrigin(), credentials: true }));
  app.use(cookieParser());
  const smallJson = express.json({ limit: "2mb" });
  const documentJson = express.json({ limit: "16mb" });
  app.use((req, res, next) => {
    const documentRoute = /^\/api\/(reports\/[^/]+$|templates(\/[^/]+)?$|me\/report-profile$)/.test(req.path);
    return (documentRoute ? documentJson : smallJson)(req, res, next);
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
  });
  const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.PACSD_PUBLIC_RATE_LIMIT || 60),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test" && !process.env.PACSD_PUBLIC_RATE_LIMIT,
  });
  app.use("/api/public", publicLimiter);

  app.get("/api/health", (_req, res) => {
    const database = mongoose.connection.readyState === 1;
    let storage = false;
    try {
      const dir = dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, ".health-probe");
      fs.writeFileSync(probe, "ok");
      fs.rmSync(probe, { force: true });
      storage = true;
    } catch {
      storage = false;
    }
    const ok = database && storage;
    res.status(ok ? 200 : 503).json({
      ok,
      service: "pacsd",
      database: database ? "connected" : "unavailable",
      storage: storage ? "writable" : "unavailable",
    });
  });

  app.post("/api/orthanc/notify", (req, res) => {
    const expected = String(process.env.ORTHANC_WEBHOOK_TOKEN || "");
    if (!expected) return res.status(404).json({ error: "Not found" });
    const given = String(req.get("x-pacsd-token") || "");
    const valid = given.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!valid) return res.status(401).json({ error: "Invalid token" });
    const instanceId = String(req.body?.instance || "");
    if (!/^[0-9a-f-]{8,64}$/i.test(instanceId)) return res.status(400).json({ error: "Invalid input" });
    importNotifiedInstance(instanceId).catch((error) => console.error(`Orthanc notify import failed: ${error.message}`));
    res.status(202).json({ accepted: true });
  });

  app.get("/api/events", requireUser, (req, res) => {
    res.set({
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");
    const stop = subscribeStudyChanges((event) => {
      if (!canAccessFacility(req.user, event.facilityId)) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      stop();
    });
  });

  app.post("/api/auth/login", loginLimiter, wrap(async (req, res) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await audit(req, "auth.login_locked", "user", user._id, null, { email: body.email.toLowerCase() });
      return res.status(423).json({ error: "This account is locked for 15 minutes" });
    }
    if (user?.lockedUntil) {
      user.lockedUntil = null;
      user.failedLoginCount = 0;
    }
    const valid = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
    if (!user || !valid || !user.active) {
      if (user?.active) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        if (user.failedLoginCount >= 5) {
          user.failedLoginCount = 0;
          user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        await user.save();
      }
      await audit(req, "auth.login_failed", "user", user?._id, null, { email: body.email.toLowerCase() });
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();
    setSession(res, user);
    await audit(req, "auth.login", "user", user._id, user.facilityIds?.[0]);
    res.json({ user: publicUser(user) });
  }));

  app.post("/api/auth/logout", requireUser, wrap(async (req, res) => {
    bumpToken(req.user);
    await req.user.save();
    await audit(req, "auth.logout", "user", req.user._id);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  }));

  app.post("/api/auth/change-password", requireUser, wrap(async (req, res) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      password: z.string().min(10).max(128),
    }).parse(req.body);
    const valid = await bcrypt.compare(body.currentPassword, req.user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    req.user.passwordHash = await bcrypt.hash(body.password, 10);
    req.user.mustChangePassword = false;
    req.user.failedLoginCount = 0;
    req.user.lockedUntil = null;
    bumpToken(req.user);
    await req.user.save();
    setSession(res, req.user);
    await audit(req, "auth.password_change", "user", req.user._id);
    res.json({ user: publicUser(req.user) });
  }));

  app.get("/api/auth/me", requireUser, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.get("/api/system/status", requireUser, wrap(async (_req, res) => {
    const flags = integrationStatus();
    res.json({
      archive: "local",
      database: "connected",
      viewer: "uncompressed-grayscale",
      mpr: false,
      ...flags,
      orthancHealth: await orthancSystem(),
    });
  }));

  app.get("/api/facilities", requireUser, requirePermission("facility.read"), wrap(async (req, res) => {
    const filter = req.user.role === "system_admin" ? {} : { _id: { $in: req.user.facilityIds } };
    const facilities = await Facility.find(filter).sort({ name: 1 });
    res.json({ facilities });
  }));

  app.post("/api/facilities", requireUser, requirePermission("facility.write"), wrap(async (req, res) => {
    if (req.user.role !== "system_admin") return res.status(403).json({ error: "Only a system administrator can add a facility" });
    const body = z.object({
      name: z.string().min(2).max(120),
      code: z.string().min(2).max(12),
    }).parse(req.body);
    const facility = await Facility.create({ name: body.name, code: body.code.toUpperCase() });
    await audit(req, "facility.create", "facility", facility._id, facility._id);
    res.status(201).json({ facility });
  }));

  app.get("/api/assignees", requireUser, wrap(async (req, res) => {
    if (!can(req.user, "study.assign") && !can(req.user, "study.write")) {
      return res.status(403).json({ error: "You do not have permission for that action" });
    }
    const facilityId = selectedFacility(req);
    if (!facilityId || !canAccessFacility(req.user, facilityId)) {
      return res.status(400).json({ error: "Choose a facility first" });
    }
    const users = await User.find({ role: "radiologist", active: true, facilityIds: facilityId }).select("name role");
    res.json({ users });
  }));

  app.get("/api/users", requireUser, requirePermission("user.read"), wrap(async (req, res) => {
    const filter = req.user.role === "system_admin" ? {} : { facilityIds: { $in: req.user.facilityIds } };
    const users = await User.find(filter).select("-passwordHash").sort({ name: 1 });
    res.json({ users });
  }));

  app.post("/api/users", requireUser, requirePermission("user.write"), wrap(async (req, res) => {
    const body = z.object({
      name: z.string().min(2).max(120),
      email: z.string().email(),
      password: z.string().min(10).max(128),
      role: z.enum(ROLES),
      facilityIds: z.array(z.string()).min(1),
    }).parse(req.body);
    const scopeError = accountScopeError(req.user, body.role, body.facilityIds);
    if (scopeError) return res.status(403).json({ error: scopeError });
    const user = await User.create({
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash: await bcrypt.hash(body.password, 10),
      role: body.role,
      facilityIds: body.facilityIds,
    });
    await audit(req, "user.create", "user", user._id, body.facilityIds[0], { role: body.role });
    res.status(201).json({ user: publicUser(user) });
  }));

  app.patch("/api/users/:id", requireUser, requirePermission("user.write"), wrap(async (req, res) => {
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      role: z.enum(ROLES).optional(),
      facilityIds: z.array(z.string()).min(1).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const user = await loadManagedUser(req.user, req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const scopeError = accountScopeError(req.user, body.role || user.role, body.facilityIds || [], user.facilityIds);
    if (scopeError) return res.status(403).json({ error: scopeError });
    if (body.name !== undefined) user.name = body.name;
    if (body.role !== undefined) user.role = body.role;
    if (body.facilityIds !== undefined) user.facilityIds = body.facilityIds;
    if (body.active === false && user.active) bumpToken(user);
    if (body.active !== undefined) user.active = body.active;
    await user.save();
    await audit(req, "user.update", "user", user._id, user.facilityIds?.[0], { active: user.active, role: user.role });
    res.json({ user: publicUser(user) });
  }));

  app.post("/api/users/:id/reset-password", requireUser, requirePermission("user.write"), wrap(async (req, res) => {
    const user = await loadManagedUser(req.user, req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const temporaryPassword = crypto.randomBytes(12).toString("base64url");
    user.passwordHash = await bcrypt.hash(temporaryPassword, 10);
    user.mustChangePassword = true;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    bumpToken(user);
    await user.save();
    await audit(req, "user.reset_password", "user", user._id, user.facilityIds?.[0]);
    res.json({ temporaryPassword, user: publicUser(user) });
  }));

  app.get("/api/patients", requireUser, requirePermission("patient.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const q = String(req.query.q || "").trim();
    const filter = { ...scope };
    if (q) {
      const pattern = new RegExp(escapeRegex(q), "i");
      const studyPatientIds = await Study.find({ ...scope, accession: pattern }).distinct("patientId");
      filter.$or = [{ name: pattern }, { mrn: pattern }, { _id: { $in: studyPatientIds } }];
    }
    const patients = await Patient.find(filter).sort({ name: 1 }).limit(50);
    if (q) await audit(req, "patient.search", "patient", "", facilityId || undefined, { q });
    res.json({ patients });
  }));

  app.post("/api/patients", requireUser, requirePermission("patient.write"), wrap(async (req, res) => {
    const body = z.object({
      facilityId: z.string().min(1),
      name: z.string().min(1).max(120),
      mrn: z.string().min(1).max(64),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
      sex: z.enum(["F", "M", "O", "U"]).optional(),
      phone: z.string().max(32).optional(),
    }).parse(req.body);
    if (!canAccessFacility(req.user, body.facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const patient = await Patient.create({
      facilityId: body.facilityId,
      name: body.name,
      mrn: body.mrn,
      birthDate: body.birthDate || "",
      sex: body.sex || "U",
      phone: body.phone || "",
    });
    await audit(req, "patient.create", "patient", patient._id, patient.facilityId);
    res.status(201).json({ patient });
  }));

  app.get("/api/studies", requireUser, requirePermission("study.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const filter = { ...scope };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.modality) filter.modality = String(req.query.modality).toUpperCase();
    if (req.query.mine === "1") filter.assignedTo = req.user._id;
    if (req.query.remote === "1") filter.$expr = { $ne: ["$readingFacilityId", "$facilityId"] };
    if (req.query.patientId) filter.patientId = req.query.patientId;
    const studies = await Study.find(filter).sort({ updatedAt: -1 }).limit(100).populate("patientId", "name mrn sex birthDate").populate("assignedTo", "name");
    res.json({ studies });
  }));

  app.post("/api/studies", requireUser, requirePermission("study.write"), wrap(async (req, res) => {
    const body = z.object({
      patientId: z.string().min(1),
      facilityId: z.string().min(1),
      accession: z.string().min(1).max(64),
      modality: z.string().min(1).max(8),
      description: z.string().max(200).optional(),
      priority: z.enum(["routine", "urgent", "stat"]).optional(),
      readingFacilityId: z.string().optional(),
      studyDate: z.string().optional(),
    }).parse(req.body);
    if (!canAccessFacility(req.user, body.facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const patient = await Patient.findById(body.patientId);
    if (!patient || String(patient.facilityId) !== body.facilityId) {
      return res.status(400).json({ error: "Patient was not found in that facility" });
    }
    const assignment = await assignmentError(req.user, body.facilityId, { readingFacilityId: body.readingFacilityId });
    if (assignment) return res.status(assignment.status).json({ error: assignment.error });
    const study = await Study.create({
      patientId: patient._id,
      facilityId: body.facilityId,
      readingFacilityId: body.readingFacilityId || body.facilityId,
      accession: body.accession,
      studyUid: createUid("order"),
      modality: body.modality.toUpperCase(),
      description: body.description || "",
      priority: body.priority || "routine",
      studyDate: body.studyDate || new Date().toISOString().slice(0, 10),
      status: "booked",
    });
    await audit(req, "study.create", "study", study._id, study.facilityId, { accession: study.accession });
    res.status(201).json({ study });
  }));

  app.patch("/api/studies/:id", requireUser, wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const body = z.object({
      status: z.enum(["booked", "acquired", "reporting"]).optional(),
      priority: z.enum(["routine", "urgent", "stat"]).optional(),
      assignedTo: z.string().nullable().optional(),
      readingFacilityId: z.string().optional(),
      description: z.string().max(200).optional(),
    }).parse(req.body);
    if (body.status && !can(req.user, "study.write") && !can(req.user, "study.assign")) {
      return res.status(403).json({ error: "You do not have permission for that action" });
    }
    if (body.assignedTo !== undefined || body.readingFacilityId) {
      if (!can(req.user, "study.assign") && !can(req.user, "study.write")) {
        return res.status(403).json({ error: "You do not have permission for that action" });
      }
    }
    if (body.status === "reporting" && !can(req.user, "report.write") && req.user.role !== "system_admin") {
      return res.status(403).json({ error: "Only a radiologist can move a study into reporting" });
    }
    if (body.assignedTo !== undefined || body.readingFacilityId) {
      const assignment = await assignmentError(req.user, body.readingFacilityId || study.readingFacilityId || study.facilityId, {
        assignedTo: body.assignedTo === undefined ? study.assignedTo : body.assignedTo,
        readingFacilityId: body.readingFacilityId,
      });
      if (assignment) return res.status(assignment.status).json({ error: assignment.error });
    }
    if (body.status) study.status = body.status;
    if (body.priority) study.priority = body.priority;
    if (body.description !== undefined) study.description = body.description;
    if (body.readingFacilityId) study.readingFacilityId = body.readingFacilityId;
    if (body.assignedTo !== undefined) study.assignedTo = body.assignedTo || null;
    if (body.status === "acquired" && !study.acquiredAt) study.acquiredAt = new Date();
    await study.save();
    await audit(req, "study.update", "study", study._id, study.facilityId, { status: study.status });
    res.json({ study });
  }));

  app.get("/api/studies/:id/series", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const series = await Series.find({ studyId: study._id }).sort({ seriesNumber: 1 });
    const instances = await Instance.find({ studyId: study._id }).sort({ createdAt: 1 }).select("-filePath");
    await audit(req, "viewer.open", "study", study._id, study.facilityId);
    res.json({ study, series, instances });
  }));

  app.post("/api/dicom", requireUser, requirePermission("dicom.write"), upload.array("files", 8), wrap(async (req, res) => {
    const facilityId = req.body.facilityId || selectedFacility(req);
    if (!canAccessFacility(req.user, facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const stored = [];
    const rejected = [];
    for (const file of req.files || []) {
      try {
        stored.push(await ingestDicomBuffer({
          buffer: fs.readFileSync(file.path),
          facilityId,
          source: "upload",
          fileName: file.originalname,
        }));
      } catch (error) {
        rejected.push({ file: file.originalname, error: error.message });
      } finally {
        fs.rmSync(file.path, { force: true });
      }
    }
    await audit(req, "dicom.store", "facility", facilityId, facilityId, { stored: stored.length, rejected: rejected.length });
    res.status(stored.length ? 201 : 400).json({ stored, rejected });
  }));

  app.get("/api/instances/:id/pixels/raw", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const loaded = await loadInstancePixels(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    if (!loaded.meta.supported || !loaded.pixels) return res.status(404).json({ error: "Pixel data is not available" });
    const body = Buffer.from(loaded.pixels);
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex")}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.setHeader("content-type", "application/octet-stream");
    res.send(body);
  }));

  app.get("/api/instances/:id/pixels", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const loaded = await loadInstancePixels(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    res.json(loaded.meta);
  }));

  app.get("/api/instances/:id/orthanc-preview", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const instance = await Instance.findById(req.params.id);
    if (!instance) return res.status(404).json({ error: "Instance not found" });
    const study = await loadReadableStudy(req, instance.studyId);
    if (!study) return res.status(404).json({ error: "Instance not found" });
    const preview = await orthancPreview(instance.orthancId);
    if (!preview) return res.status(404).json({ error: "Orthanc preview is not available" });
    res.type("png").send(preview);
  }));

  app.get("/api/instances/:id/tags", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const instance = await Instance.findById(req.params.id);
    if (!instance) return res.status(404).json({ error: "Instance not found" });
    const study = await loadReadableStudy(req, instance.studyId);
    if (!study) return res.status(404).json({ error: "Instance not found" });
    const filePath = await localDicomPath(instance);
    if (!filePath) return res.status(404).json({ error: "The DICOM file is missing from storage and the archive" });
    res.json({ tags: dicomTagSummary(await fs.promises.readFile(filePath)) });
  }));

  app.get("/api/dashboard", requireUser, requirePermission("dashboard.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const studies = await Study.find(scope).select("status modality priority facilityId readingFacilityId signedAt acquiredAt createdAt");
    const counts = { booked: 0, acquired: 0, reporting: 0, preliminary: 0, finalized: 0 };
    const modalities = {};
    let stat = 0;
    let remote = 0;
    for (const study of studies) {
      counts[study.status] = (counts[study.status] || 0) + 1;
      modalities[study.modality] = (modalities[study.modality] || 0) + 1;
      if (study.priority === "stat") stat += 1;
      if (study.readingFacilityId && String(study.readingFacilityId) !== String(study.facilityId)) remote += 1;
    }
    const finalized = await Report.find({
      facilityId: scope.facilityId || { $exists: true },
      status: "final",
      signedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }).select("studyId signedAt");
    let tatMinutes = null;
    if (finalized.length && scope.facilityId) {
      const related = await Study.find({ _id: { $in: finalized.map((item) => item.studyId) } }).select("acquiredAt createdAt");
      const byId = new Map(related.map((item) => [String(item._id), item]));
      const samples = finalized.map((report) => {
        const study = byId.get(String(report.studyId));
        const start = study?.acquiredAt || study?.createdAt;
        if (!start || !report.signedAt) return null;
        return (new Date(report.signedAt) - new Date(start)) / 60000;
      }).filter((value) => Number.isFinite(value) && value >= 0);
      if (samples.length) tatMinutes = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    }
    res.json({ counts, modalities, stat, remote, tatMinutes, total: studies.length });
  }));

  app.get("/api/reports", requireUser, requirePermission("report.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const filter = { ...scope };
    if (req.query.studyId) filter.studyId = req.query.studyId;
    if (req.user.role === "referring_physician") filter.status = { $in: ["preliminary", "final"] };
    const reports = await Report.find(filter).sort({ updatedAt: -1 }).limit(100).populate("signedBy", "name");
    res.json({ reports });
  }));

  app.post("/api/reports", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const body = z.object({ studyId: z.string().min(1) }).parse(req.body);
    const study = await loadReadableStudy(req, body.studyId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    let report = await Report.findOne({ studyId: study._id }).sort({ version: -1 });
    if (!report) {
      report = await Report.create({
        studyId: study._id,
        facilityId: study.facilityId,
        authorId: req.user._id,
      });
      if (study.status === "booked" || study.status === "acquired") study.status = "reporting";
      study.assignedTo = study.assignedTo || req.user._id;
      await study.save();
      await audit(req, "report.create", "report", report._id, study.facilityId);
    }
    res.status(201).json({ report });
  }));

  app.patch("/api/reports/:id", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Report not found" });
    if (report.status === "final") return res.status(409).json({ error: "A final report cannot be edited" });
    if (!canEditReport(req.user, report)) {
      return res.status(403).json({ error: "Only the report author or a system administrator can edit this draft" });
    }
    const body = z.object({
      clinical: z.string().max(8000).optional(),
      indication: z.string().max(8000).optional(),
      technique: z.string().max(8000).optional(),
      comparison: z.string().max(8000).optional(),
      findings: z.string().max(20000).optional(),
      impression: z.string().max(8000).optional(),
      recommendations: z.string().max(8000).optional(),
      doc: z.record(z.any()).optional(),
      layout: z.record(z.any()).optional(),
      templateId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
      baseRevision: z.number().int().min(0).optional(),
      reason: z.enum(["autosave", "manual", "restore", "template"]).optional(),
    }).parse(req.body);
    if (body.baseRevision !== undefined && body.baseRevision !== (report.revision || 0)) {
      const editor = report.updatedBy ? await User.findById(report.updatedBy).select("name") : null;
      return res.status(409).json({
        error: "This report was saved from another window or by another user since you opened it.",
        conflict: true,
        revision: report.revision || 0,
        updatedAt: report.updatedAt,
        updatedBy: editor?.name || "",
      });
    }
    if (body.doc !== undefined) {
      const problem = validateDoc(body.doc);
      if (problem) return res.status(400).json({ error: problem });
      report.doc = body.doc;
      report.docFormat = DOC_FORMAT;
      report.markModified("doc");
      const sections = extractSections(body.doc);
      for (const key of SECTION_KEYS) report[key] = sections[key];
    } else {
      for (const key of ["clinical", "indication", "technique", "comparison", "findings", "impression", "recommendations"]) {
        if (body[key] !== undefined) report[key] = body[key];
      }
    }
    if (body.layout !== undefined) {
      report.layout = normalizeLayout(body.layout);
      report.markModified("layout");
    }
    if (body.templateId !== undefined) report.templateId = body.templateId || undefined;
    report.revision = (report.revision || 0) + 1;
    report.updatedBy = req.user._id;
    if (report.status === "draft" && (!report.workflow || report.workflow === "draft")) report.workflow = "in_progress";
    const reason = body.reason || "manual";
    const snapshot = await snapshotRevision(report, req.user, reason, reason !== "autosave");
    await report.save();
    if (reason !== "autosave" || snapshot) {
      await audit(req, "report.update", "report", report._id, report.facilityId, { reason, revision: report.revision });
    }
    const payload = report.toObject();
    if (body.doc !== undefined) {
      delete payload.doc;
      delete payload.layout;
    }
    res.json({ report: payload, snapshot: Boolean(snapshot) });
  }));

  app.post("/api/reports/:id/sign", requireUser, requirePermission("report.sign"), wrap(async (req, res) => {
    const body = z.object({
      level: z.enum(["preliminary", "final"]),
      signatureMethodId: z.string().trim().max(40).optional(),
    }).parse(req.body);
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Report not found" });
    if (report.status === "final") return res.status(409).json({ error: "A final report cannot be signed again" });
    if (!report.findings.trim() || !report.impression.trim()) {
      return res.status(400).json({ error: "Findings and impression are required before signature" });
    }
    if (isDocNode(report.doc)) {
      const problems = finalizationProblems(report.doc);
      if (problems.length) return res.status(400).json({ error: `Review the report before signing: ${problems.join("; ")}.`, problems });
    }
    report.status = body.level;
    report.workflow = body.level === "final"
      ? (report.priorReportId ? "amended" : "finalized")
      : "pending_signature";
    const appearance = signatureAppearance(req.user, body.signatureMethodId);
    if (appearance.error) return res.status(400).json({ error: appearance.error });
    report.signedBy = req.user._id;
    report.signedAt = new Date();
    report.signatureRecord = {
      userId: String(req.user._id),
      name: req.user.name,
      qualifications: appearance.qualifications,
      registrationNumber: appearance.registrationNumber,
      signatureImage: appearance.signatureImage,
      designation: appearance.designation,
      style: appearance.style,
      methodLabel: appearance.methodLabel,
      methodId: appearance.methodId,
      method: "authenticated-session",
      signedAt: report.signedAt.toISOString(),
    };
    report.markModified("signatureRecord");
    report.revision = (report.revision || 0) + 1;
    report.updatedBy = req.user._id;
    await snapshotRevision(report, req.user, "sign", true);
    await report.save();
    await Study.findByIdAndUpdate(report.studyId, { status: body.level === "final" ? "finalized" : "preliminary" });
    await audit(req, "report.sign", "report", report._id, report.facilityId, { level: body.level });
    let artifacts = [];
    if (body.level === "final") {
      try {
        artifacts = await attachSignedArtifacts(report, req.user);
        await audit(req, "report.attach", "report", report._id, report.facilityId, { files: artifacts.map((item) => ({ kind: item.kind, sha256: item.sha256 })) });
      } catch (error) {
        console.error(error);
        await audit(req, "report.attach_failed", "report", report._id, report.facilityId, { error: String(error.message || error).slice(0, 300) });
      }
    }
    res.json({ report, artifacts });
  }));

  app.post("/api/reports/:id/addendum", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const original = await Report.findById(req.params.id);
    if (!original || !canAccessFacility(req.user, original.facilityId)) return res.status(404).json({ error: "Report not found" });
    if (original.status !== "final") return res.status(409).json({ error: "An addendum can only be added to a final report" });
    const openDraft = await Report.findOne({ priorReportId: original._id, status: "draft" });
    if (openDraft) return res.json({ report: openDraft, originalId: original._id });
    const latest = await Report.findOne({ studyId: original.studyId }).sort({ version: -1 }).select("version");
    const report = await Report.create({
      studyId: original.studyId,
      facilityId: original.facilityId,
      clinical: original.clinical,
      indication: original.indication,
      technique: original.technique,
      comparison: original.comparison,
      findings: original.findings,
      impression: original.impression,
      recommendations: original.recommendations,
      doc: addendumDoc(original, req.user),
      docFormat: original.doc ? DOC_FORMAT : "",
      layout: original.layout,
      templateId: original.templateId,
      status: "draft",
      workflow: "draft",
      version: (latest?.version || 1) + 1,
      priorReportId: original._id,
      authorId: req.user._id,
    });
    const kept = await Report.findById(original._id);
    await audit(req, "report.addendum", "report", report._id, report.facilityId, { priorReportId: String(original._id), version: report.version });
    res.status(201).json({ report, original: kept });
  }));

  app.post("/api/reports/:id/assist", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Report not found" });
    const study = await Study.findById(report.studyId);
    const suggestion = await requestReportAssist({
      findings: report.findings,
      impression: report.impression,
      modality: study?.modality,
      description: study?.description,
    });
    await audit(req, "report.assist", "report", report._id, report.facilityId);
    res.json({ suggestion, applied: false });
  }));

  app.post("/api/reports/:id/share", requireUser, requirePermission("report.share"), wrap(async (req, res) => {
    const body = z.object({
      channel: z.enum(["link", "email", "whatsapp", "facebook"]),
      recipient: z.string().max(160).optional(),
      expiresInHours: z.number().int().min(1).max(24 * 14).optional(),
      subject: z.string().max(200).optional(),
      message: z.string().max(2000).optional(),
      countryCode: z.string().max(6).optional(),
      consent: z.boolean().optional(),
    }).parse(req.body);
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Report not found" });
    if (report.status === "draft") return res.status(400).json({ error: "Sign the report before sharing it" });
    if (body.channel !== "link" && body.channel !== "facebook" && !body.recipient) return res.status(400).json({ error: "A recipient is required" });
    if (body.channel !== "link" && body.consent !== true) {
      return res.status(400).json({ error: "Record the patient's consent before sending a report by email, WhatsApp, or Facebook" });
    }
    const token = crypto.randomBytes(24).toString("hex");
    const hours = body.expiresInHours || 72;
    const link = `${publicBaseUrl()}/share/${token}`;
    const patient = await patientForReport(report);
    const study = await Study.findById(report.studyId);
    const phone = normalizePhone(body.recipient, body.countryCode || patient?.countryCode);
    const text = (body.message || "").trim()
      || `Galactic Medical Systems radiology report for ${patient?.name || "the patient"} (accession ${study?.accession || "n/a"}) is ready until ${new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()}. Secure link: ${link}`;
    const share = await Share.create({
      reportId: report._id,
      tokenHash: asyncHash(token),
      channel: body.channel,
      recipient: body.channel === "whatsapp" ? phone : (body.recipient || ""),
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      createdBy: req.user._id,
      delivery: "stored",
      subject: (body.subject || `Radiology report ${patient?.mrn || ""}`).trim(),
      message: text.replace(link, "{LINK}"),
      consent: body.channel === "link" ? false : true,
    });
    const result = await dispatchShare(req, share, report, link, patient);
    if (result.error) return res.status(result.status || 502).json({ ...result, link, shareId: share._id });
    res.status(201).json({ shareId: share._id, link, expiresAt: share.expiresAt, ...result });
  }));

  app.post("/api/shares/:id/retry", requireUser, requirePermission("report.share"), wrap(async (req, res) => {
    const share = await Share.findById(req.params.id);
    if (!share) return res.status(404).json({ error: "Share not found" });
    const report = await Report.findById(share.reportId);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Share not found" });
    if (share.channel !== "link" && !share.consent) return res.status(400).json({ error: "This delivery has no recorded consent" });
    const token = crypto.randomBytes(24).toString("hex");
    share.tokenHash = asyncHash(token);
    const link = `${publicBaseUrl()}/share/${token}`;
    const patient = await patientForReport(report);
    const result = await dispatchShare(req, share, report, link, patient);
    if (result.error) return res.status(result.status || 502).json({ ...result, link, shareId: share._id });
    res.json({ shareId: share._id, link, expiresAt: share.expiresAt, ...result });
  }));

  app.post("/api/shares/:id/revoke", requireUser, requirePermission("report.share"), wrap(async (req, res) => {
    const share = await Share.findById(req.params.id);
    if (!share) return res.status(404).json({ error: "Share not found" });
    const report = await Report.findById(share.reportId);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Share not found" });
    share.revoked = true;
    await share.save();
    await audit(req, "share.revoke", "share", share._id, report.facilityId);
    res.json({ share: { id: share._id, revoked: true } });
  }));

  app.get("/api/public/share/:token", wrap(async (req, res) => {
    const payload = await publicShare(req.params.token);
    if (!payload) return res.status(404).json({ error: "This share link is unavailable" });
    const { share, report, study, patient, facility, signer } = payload;
    await audit(req, "share.view", "share", share._id, study?.facilityId);
    res.json({
      facilityName: facility?.name || "",
      patientName: patient?.name || "",
      mrn: patient?.mrn || "",
      modality: study?.modality || "",
      accession: study?.accession || "",
      description: study?.description || "",
      studyDate: study?.studyDate || "",
      technique: report.technique,
      findings: report.findings,
      impression: report.impression,
      status: report.status,
      signedAt: report.signedAt,
      signerName: signer?.name || "",
      disclaimer: "Shared PACSD report. Not a certified diagnostic device.",
    });
  }));

  app.get("/api/public/share/:token/pdf", wrap(async (req, res) => {
    const payload = await publicShare(req.params.token);
    if (!payload) return res.status(404).json({ error: "This share link is unavailable" });
    await audit(req, "share.pdf", "share", payload.share._id, payload.study?.facilityId);
    const pdf = await renderDocumentPdf(payload);
    res.setHeader("content-type", "application/pdf");
    res.send(pdf);
  }));

  app.get("/api/audit", requireUser, requirePermission("audit.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const filter = {};
    if (req.user.role !== "system_admin") filter.facilityId = { $in: req.user.facilityIds };
    else if (facilityId) filter.facilityId = facilityId;
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ logs });
  }));

  registerReportDocuments(app, { requireUser, requirePermission, wrap, audit });
  registerDictation(app, { requireUser, requirePermission, wrap, audit, selectedFacility });
  registerEnterprise(app, { requireUser, requirePermission, wrap, audit, selectedFacility, scopedFacilityFilter });
  registerAi(app, { requireUser, requirePermission, wrap, audit, loadReadableStudy });
  registerDicomweb(app, { requireUser, requirePermission, wrap, audit, loadReadableStudy });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) return res.sendFile(path.join(dist, "index.html"));
      return next();
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error, _req, res, _next) => {
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input", details: error.issues.map((issue) => issue.message) });
    }
    if (error?.code === 11000) return res.status(409).json({ error: "A record with that identifier already exists" });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
    if (typeof error.status === "number" && error.status >= 400 && error.status < 600) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "Unexpected server error" });
  });

  return app;

  async function dispatchShare(req, share, report, link, patient) {
    const message = String(share.message || "").split("{LINK}").join(link);
    if (share.channel === "link") {
      share.delivery = "stored";
      share.attachmentSent = false;
      await share.save();
      await audit(req, "report.share", "share", share._id, report.facilityId, { channel: "link" });
      return { delivery: "stored", attachmentSent: false };
    }
    if (share.channel === "facebook") {
      share.delivery = "not_sent";
      share.attachmentSent = false;
      share.fallback = "web";
      share.deliveryDetail = "Facebook was opened with the secure link. The PDF was not posted.";
      await share.save();
      await audit(req, "report.share", "share", share._id, report.facilityId, { channel: "facebook", fallback: "web" });
      return {
        delivery: "not_sent",
        attachmentSent: false,
        fallback: "web",
        fbUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
      };
    }
    if (share.channel === "email") {
      try {
        const pdf = await pdfForReport(report);
        await sendReportEmail({
          to: share.recipient,
          subject: share.subject || "Radiology report",
          text: message,
          pdf,
          filename: `pacsd-report-${patient?.mrn || "report"}.pdf`,
        });
        share.delivery = "sent";
        share.attachmentSent = true;
        share.deliveryDetail = "";
        share.fallback = "";
      } catch (error) {
        share.delivery = "failed";
        share.attachmentSent = false;
        share.deliveryDetail = error.message;
        await share.save();
        await audit(req, "report.share_failed", "share", share._id, report.facilityId, { channel: "email" });
        return { error: error.message, status: error.status || 502, delivery: "failed", attachmentSent: false };
      }
    } else if (!whatsappConfigured()) {
      share.delivery = "not_sent";
      share.attachmentSent = false;
      share.fallback = "web";
      share.deliveryDetail = "WhatsApp Business is not configured. A WhatsApp Web link was prepared. The PDF was not sent.";
      await share.save();
      await audit(req, "report.share", "share", share._id, report.facilityId, { channel: "whatsapp", fallback: "web" });
      return { delivery: "not_sent", attachmentSent: false, fallback: "web", waUrl: whatsappWebUrl(share.recipient, message) };
    } else {
      try {
        const pdf = await pdfForReport(report);
        const filename = `pacsd-report-${patient?.mrn || "report"}.pdf`;
        let providerId = "";
        let attachmentSent = false;
        let detail = "";
        try {
          providerId = await sendWhatsAppDocument({ to: share.recipient, filename, pdf, caption: message.slice(0, 1024) });
          attachmentSent = true;
        } catch (error) {
          if (!process.env.WHATSAPP_TEMPLATE_NAME) throw error;
          detail = "The PDF could not be attached. A template message with the secure link was sent instead.";
        }
        if (!attachmentSent) await sendWhatsApp({ to: share.recipient, patientName: patient?.name || "patient", link });
        share.delivery = "sent";
        share.attachmentSent = attachmentSent;
        share.providerId = providerId || "";
        share.fallback = "";
        share.deliveryDetail = detail;
      } catch (error) {
        share.delivery = "failed";
        share.attachmentSent = false;
        share.deliveryDetail = error.message;
        await share.save();
        await audit(req, "report.share_failed", "share", share._id, report.facilityId, { channel: "whatsapp" });
        return {
          error: error.message,
          status: error.status || 502,
          delivery: "failed",
          attachmentSent: false,
          fallback: "web",
          waUrl: whatsappWebUrl(share.recipient, message),
        };
      }
    }
    await share.save();
    await audit(req, "report.share", "share", share._id, report.facilityId, { channel: share.channel, attachmentSent: Boolean(share.attachmentSent) });
    return {
      delivery: share.delivery,
      attachmentSent: Boolean(share.attachmentSent),
      fallback: share.fallback || "",
      providerId: share.providerId || "",
      detail: share.deliveryDetail || "",
    };
  }
}

async function assignmentError(actor, facilityId, { assignedTo, readingFacilityId } = {}) {
  if (readingFacilityId) {
    const facility = await Facility.findById(readingFacilityId);
    if (!facility?.active) return { status: 400, error: "Reading facility was not found" };
    if (!canAccessFacility(actor, facility._id)) return { status: 403, error: "Reading facility is outside your access" };
  }
  if (assignedTo) {
    const assignee = await User.findById(assignedTo);
    const home = String(readingFacilityId || facilityId);
    const covers = (assignee?.facilityIds || []).some((id) => String(id) === home);
    if (!assignee?.active || assignee.role !== "radiologist" || !covers) {
      return { status: 400, error: "Assignee must be an active radiologist in that facility" };
    }
  }
  return null;
}

async function loadInstancePixels(req) {
  const instance = await Instance.findById(req.params.id);
  if (!instance) return { status: 404, error: "Instance not found" };
  const study = await loadReadableStudy(req, instance.studyId);
  if (!study) return { status: 404, error: "Instance not found" };
  const filePath = await localDicomPath(instance);
  if (!filePath) return { status: 404, error: "The DICOM file is missing from storage and the archive" };
  const parsed = parseDicomBuffer(await fs.promises.readFile(filePath));
  const frame = Number.isFinite(Number(req.query.frame)) ? Math.max(0, Math.trunc(Number(req.query.frame))) : 0;
  const samples = parsed.samplesPerPixel || 1;
  const frames = parsed.numberOfFrames || 1;
  const transferSyntax = instance.transferSyntax || parsed.transferSyntax;
  let supported = parsed.previewSupported || (isUncompressedLittleEndian(transferSyntax) && (samples === 1 || samples === 3) && parsed.pixels);
  let reason = supported ? "" : parsed.previewReason;
  let pixels = parsed.pixels;
  if (!isUncompressedLittleEndian(transferSyntax) && instance.orthancId && process.env.ORTHANC_URL) {
    const name = orthancDecodedFrameName(parsed);
    const decoded = await orthancDecodedFrame(instance.orthancId, frame, name);
    if (!decoded) {
      supported = false;
      reason = "Orthanc did not return a decoded frame";
      pixels = null;
    } else {
      supported = true;
      reason = "";
      pixels = decoded;
    }
  } else if (pixels && (samples === 1 || samples === 3)) {
    const frameBytes = parsed.rows * parsed.columns * samples * (parsed.bitsAllocated / 8);
    if (!frameBytes || frame >= frames || pixels.length < (frame + 1) * frameBytes) {
      return { status: 404, error: "Frame not found" };
    }
    pixels = pixels.subarray(frame * frameBytes, (frame + 1) * frameBytes);
  }
  return {
    pixels,
    meta: {
      id: instance._id,
      rows: parsed.rows,
      columns: parsed.columns,
      bitsAllocated: parsed.bitsAllocated,
      bitsStored: parsed.bitsStored,
      pixelRepresentation: parsed.pixelRepresentation,
      photometric: parsed.photometric,
      samplesPerPixel: samples,
      numberOfFrames: frames,
      pixelSpacing: parsed.pixelSpacing,
      imagerPixelSpacing: parsed.imagerPixelSpacing,
      orientation: parsed.orientation,
      frame,
      windowCenter: parsed.windowCenter ?? 128,
      windowWidth: parsed.windowWidth ?? 256,
      slope: parsed.slope,
      intercept: parsed.intercept,
      transferSyntax,
      supported,
      reason,
      orthancPreview: Boolean(instance.orthancId),
    },
  };
}

async function orthancDecodedFrame(orthancId, frame, name) {
  if (!orthancId) return null;
  try {
    return await orthancBytes(`/instances/${encodeURIComponent(orthancId)}/frames/${frame}/${name}`);
  } catch {
    return null;
  }
}

async function patientForReport(report) {
  const study = await Study.findById(report.studyId);
  if (!study) return null;
  return Patient.findById(study.patientId);
}

async function pdfForReport(report) {
  const file = await renderReportFile(report, "pdf");
  return file.bytes;
}

async function publicShare(token) {
  const share = await Share.findOne({ tokenHash: asyncHash(token), revoked: false, expiresAt: { $gt: new Date() } });
  if (!share) return null;
  const report = await Report.findById(share.reportId);
  if (!report || report.status === "draft") return null;
  const study = await Study.findById(report.studyId);
  const patient = study ? await Patient.findById(study.patientId) : null;
  const facility = study ? await Facility.findById(study.facilityId) : null;
  const signer = report.signedBy ? await User.findById(report.signedBy).select("name qualifications registrationNumber signatureImage") : null;
  const author = report.authorId ? await User.findById(report.authorId).select("name qualifications registrationNumber") : null;
  return { share, report, study, patient, facility, signer: signerIdentity(signer, report), author };
}
