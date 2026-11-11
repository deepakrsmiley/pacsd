import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { z } from "zod";
import { backupDir, dataDir } from "./config.js";
import { echoThroughOrthanc, probeDicomPort } from "./dicomEcho.js";
import { BackupJob, DicomNode, Facility, Instance, Organization, Share, Study, TransferJob, User } from "./models.js";
import { integrationStatus } from "./notify.js";
import { orthancSystem } from "./orthancClient.js";
import { canAccessFacility, facilityIdsOf } from "./permissions.js";

export async function ensureOrganization() {
  let organization = await Organization.findOne();
  if (!organization) {
    organization = await Organization.create({
      name: "Galactic Medical Systems",
      legalName: "Galactic Medical Systems",
      timezone: "Asia/Kolkata",
      locale: "en-IN",
      status: "active",
    });
  }
  await Facility.updateMany(
    { $or: [{ organizationId: { $exists: false } }, { organizationId: null }] },
    { $set: { organizationId: organization._id } },
  );
  return organization;
}

export function hashBackupContents(root) {
  const hash = crypto.createHash("sha256");
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name !== "manifest.json") files.push(full);
    }
  };
  walk(root);
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).split(path.sep).join("/"));
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(file));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

async function dumpDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const collection of collections.sort((left, right) => left.name.localeCompare(right.name))) {
    if (collection.name.startsWith("system.")) continue;
    const docs = await mongoose.connection.db.collection(collection.name).find().toArray();
    fs.writeFileSync(path.join(dir, `${collection.name}.json`), JSON.stringify(docs));
  }
}

function directoryUsage(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = directoryUsage(full);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += fs.statSync(full).size;
      files += 1;
    }
  }
  return { bytes, files };
}

export function registerEnterprise(app, { requireUser, requirePermission, wrap, audit, selectedFacility, scopedFacilityFilter }) {
  app.get("/api/organization", requireUser, requirePermission("org.read"), wrap(async (_req, res) => {
    const organization = await ensureOrganization();
    const facilities = await Facility.find({ organizationId: organization._id }).sort({ name: 1 });
    res.json({ organization, facilities });
  }));

  app.patch("/api/organization", requireUser, requirePermission("org.read"), wrap(async (req, res) => {
    if (req.user.role !== "system_admin") return res.status(403).json({ error: "Only a system administrator can change the organization" });
    const body = z.object({
      legalName: z.string().max(160).optional(),
      timezone: z.string().min(1).max(64).optional(),
      locale: z.string().min(2).max(16).optional(),
      supportEmail: z.string().email().or(z.literal("")).optional(),
    }).parse(req.body);
    const organization = await ensureOrganization();
    Object.assign(organization, body);
    await organization.save();
    await audit(req, "organization.update", "organization", organization._id, null, { fields: Object.keys(body) });
    res.json({ organization });
  }));

  app.get("/api/dicom-nodes", requireUser, requirePermission("dicom.node"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const nodes = await DicomNode.find(scope).sort({ name: 1 });
    res.json({
      nodes,
      listener: {
        implemented: false,
        detail: "PACSD does not open a DICOM port. C-STORE listening is performed by Orthanc when ORTHANC_URL is configured.",
      },
    });
  }));

  app.post("/api/dicom-nodes", requireUser, requirePermission("dicom.node"), wrap(async (req, res) => {
    const body = z.object({
      facilityId: z.string().min(1),
      name: z.string().min(2).max(80),
      aeTitle: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
      host: z.string().min(1).max(255),
      port: z.number().int().min(1).max(65535),
      modality: z.string().max(8).optional(),
      enabled: z.boolean().optional(),
    }).parse(req.body);
    if (!canAccessFacility(req.user, body.facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const node = await DicomNode.create({
      ...body,
      aeTitle: body.aeTitle.toUpperCase(),
      modality: (body.modality || "").toUpperCase(),
    });
    await audit(req, "dicom.node.create", "dicom-node", node._id, node.facilityId, { aeTitle: node.aeTitle, host: node.host, port: node.port });
    res.status(201).json({ node });
  }));

  app.post("/api/dicom-nodes/:id/echo", requireUser, requirePermission("dicom.node"), wrap(async (req, res) => {
    const node = await DicomNode.findById(req.params.id);
    if (!node || !canAccessFacility(req.user, node.facilityId)) return res.status(404).json({ error: "DICOM node not found" });
    const result = process.env.ORTHANC_URL ? await echoThroughOrthanc(node) : await probeDicomPort(node.host, node.port);
    node.lastEchoAt = new Date();
    node.lastEchoOk = result.echo === true;
    node.lastEchoError = result.error || "";
    await node.save();
    await audit(req, "dicom.echo", "dicom-node", node._id, node.facilityId, { echo: node.lastEchoOk, error: node.lastEchoError });
    res.json({ echo: node.lastEchoOk, reachable: result.reachable, error: result.error, durationMs: result.durationMs, node });
  }));

  app.get("/api/transfers", requireUser, requirePermission("transfer.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const jobs = await TransferJob.find(scope).sort({ createdAt: -1 }).limit(100);
    const [stored, duplicate, rejected] = await Promise.all([
      TransferJob.countDocuments({ ...scope, status: "stored" }),
      TransferJob.countDocuments({ ...scope, status: "duplicate" }),
      TransferJob.countDocuments({ ...scope, status: "rejected" }),
    ]);
    res.json({ jobs, counts: { stored, duplicate, rejected } });
  }));

  app.get("/api/critical", requireUser, requirePermission("study.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const studies = await Study.find({ ...scope, priority: "stat" }).sort({ updatedAt: -1 }).limit(100).populate("patientId", "name mrn").populate("assignedTo", "name");
    res.json({ studies });
  }));

  app.get("/api/archive", requireUser, requirePermission("archive.read"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    const scope = scopedFacilityFilter(req.user, facilityId);
    if (!scope) return res.status(403).json({ error: "Facility is outside your access" });
    const studies = await Study.find(scope).select("_id");
    const studyIds = studies.map((study) => study._id);
    const [instances, bytesAgg] = await Promise.all([
      Instance.countDocuments({ studyId: { $in: studyIds } }),
      Instance.aggregate([
        { $match: { studyId: { $in: studyIds } } },
        { $group: { _id: null, bytes: { $sum: "$byteLength" } } },
      ]),
    ]);
    const disk = directoryUsage(dataDir());
    res.json({
      instanceCount: instances,
      indexedBytes: bytesAgg[0]?.bytes || 0,
      directoryBytes: disk.bytes,
      directoryFiles: disk.files,
      orthancConfigured: Boolean(process.env.ORTHANC_URL),
      note: "Indexed bytes come from stored instance records. Directory bytes are the local DICOM folder. Orthanc object counts are not included unless that archive is configured and queried.",
    });
  }));

  app.get("/api/system/health", requireUser, requirePermission("archive.read"), wrap(async (_req, res) => {
    const memory = process.memoryUsage();
    const failed = await TransferJob.countDocuments({ status: "rejected" });
    res.json({
      database: "connected",
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rss: memory.rss, heapUsed: memory.heapUsed },
      integrations: integrationStatus(),
      rejectedTransfers: failed,
      dicomListener: false,
      orthancHealth: await orthancSystem(),
    });
  }));

  app.get("/api/notifications", requireUser, requirePermission("report.share"), wrap(async (req, res) => {
    const facilityId = selectedFacility(req);
    if (facilityId && !canAccessFacility(req.user, facilityId)) return res.status(403).json({ error: "Facility is outside your access" });
    const shares = await Share.find().sort({ createdAt: -1 }).limit(200).populate({ path: "reportId", select: "facilityId status" });
    const allowed = req.user.role === "system_admin" && !facilityId ? null : (facilityId ? [String(facilityId)] : facilityIdsOf(req.user));
    const visible = shares.filter((share) => share.reportId && (allowed === null || allowed.includes(String(share.reportId.facilityId))));
    res.json({
      integrations: integrationStatus(),
      notifications: visible.map((share) => ({
        id: share._id,
        channel: share.channel,
        recipient: share.recipient,
        delivery: share.delivery,
        deliveryDetail: share.deliveryDetail,
        expiresAt: share.expiresAt,
        revoked: share.revoked,
        createdAt: share.createdAt,
      })),
    });
  }));

  app.get("/api/referring-doctors", requireUser, requirePermission("user.read"), wrap(async (req, res) => {
    const filter = { role: "referring_physician" };
    if (req.user.role !== "system_admin") filter.facilityIds = { $in: req.user.facilityIds };
    const users = await User.find(filter).select("name email facilityIds active").sort({ name: 1 });
    res.json({ users });
  }));

  app.post("/api/archive/backup", requireUser, requirePermission("archive.read"), wrap(async (req, res) => {
    if (req.user.role !== "system_admin") return res.status(403).json({ error: "Only a system administrator can copy the archive" });
    const organization = await ensureOrganization();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(backupDir(), stamp);
    try {
      fs.mkdirSync(destination, { recursive: true });
      const source = dataDir();
      if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, "dicom"), { recursive: true });
      await dumpDatabase(path.join(destination, "mongo"));
      const dicomUsage = directoryUsage(path.join(destination, "dicom"));
      const mongoUsage = directoryUsage(path.join(destination, "mongo"));
      const usage = { files: dicomUsage.files + mongoUsage.files, bytes: dicomUsage.bytes + mongoUsage.bytes };
      const manifest = {
        copiedAt: new Date().toISOString(),
        fileCount: usage.files,
        bytes: usage.bytes,
        restoreTested: false,
        digest: hashBackupContents(destination),
      };
      fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2));
      const job = await BackupJob.create({
        organizationId: organization._id,
        status: "copied",
        restoreTested: false,
        bytes: usage.bytes,
        fileCount: usage.files,
        location: destination,
        digest: manifest.digest,
        createdBy: req.user._id,
      });
      await audit(req, "backup.copy", "backup", job._id, null, { fileCount: usage.files, bytes: usage.bytes, restoreTested: false });
      res.status(201).json({ job, note: "Files were copied. Restoration has not been tested, so this backup is not marked verified." });
    } catch (error) {
      const job = await BackupJob.create({
        organizationId: organization._id,
        status: "failed",
        restoreTested: false,
        error: error.message,
        createdBy: req.user._id,
      });
      res.status(500).json({ job, error: error.message });
    }
  }));

  app.get("/api/archive/backups", requireUser, requirePermission("archive.read"), wrap(async (_req, res) => {
    const jobs = await BackupJob.find().sort({ createdAt: -1 }).limit(20);
    res.json({ jobs, restoreTested: jobs.some((job) => job.restoreTested) });
  }));
}
