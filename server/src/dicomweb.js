import fs from "node:fs";
import { z } from "zod";
import { sortInstances, volumeAssessment } from "../../shared/dicomGeometry.js";
import { readSpatialTags } from "./dicom.js";
import { Instance, Series, Study, ViewerAnnotation, ViewerPreference } from "./models.js";
import { localDicomPath } from "./dicomFiles.js";
import { orthancConfigured, orthancFetch } from "./orthancClient.js";
import { archiveImageCount, backfillStudyByUid } from "./orthancSync.js";

const UID = /^[0-9]+(?:\.[0-9]+)*$/;
const MISSING_FILE = "The DICOM file is missing from storage and the archive. Upload the study again.";

function safeUid(value) {
  const uid = String(value || "").trim();
  return UID.test(uid) ? uid : "";
}

function tag(vr, value) {
  if (value == null || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  const list = Array.isArray(value) ? value : [value];
  if (list.some((item) => item == null || item === "")) return null;
  return { vr, Value: list };
}

function put(target, key, vr, value) {
  const encoded = tag(vr, value);
  if (encoded) target[key] = encoded;
}

export function instanceDicomJson(instance, study, series) {
  const tags = {};
  put(tags, "00080016", "UI", instance.sopClassUid);
  put(tags, "00080018", "UI", instance.sopUid);
  put(tags, "00080060", "CS", series.modality || study.modality);
  put(tags, "00080070", "LO", instance.manufacturer);
  put(tags, "00080080", "LO", instance.institution);
  put(tags, "0008103E", "LO", series.description);
  put(tags, "00020010", "UI", instance.transferSyntax);
  put(tags, "00180050", "DS", instance.sliceThickness);
  put(tags, "00180088", "DS", instance.spacingBetweenSlices);
  put(tags, "0020000D", "UI", study.studyUid);
  put(tags, "0020000E", "UI", series.seriesUid);
  put(tags, "00200011", "IS", series.seriesNumber);
  put(tags, "00200013", "IS", instance.instanceNumber || undefined);
  put(tags, "00200032", "DS", instance.imagePositionPatient);
  put(tags, "00200037", "DS", instance.imageOrientationPatient);
  put(tags, "00200052", "UI", instance.frameOfReferenceUid);
  put(tags, "00280002", "US", instance.samplesPerPixel);
  put(tags, "00280004", "CS", instance.photometric);
  put(tags, "00280008", "IS", instance.numberOfFrames || 1);
  put(tags, "00280010", "US", instance.rows);
  put(tags, "00280011", "US", instance.columns);
  put(tags, "00280030", "DS", instance.pixelSpacing);
  put(tags, "00280100", "US", instance.bitsAllocated);
  put(tags, "00280101", "US", instance.bitsStored);
  put(tags, "00280102", "US", instance.bitsStored ? instance.bitsStored - 1 : 0);
  put(tags, "00280103", "US", instance.pixelRepresentation);
  put(tags, "00281050", "DS", instance.windowCenter);
  put(tags, "00281051", "DS", instance.windowWidth);
  put(tags, "00281052", "DS", instance.intercept);
  put(tags, "00281053", "DS", instance.slope);
  return tags;
}

function studyDicomJson(study, patient) {
  const tags = {};
  put(tags, "00080020", "DA", String(study.studyDate || "").replace(/-/g, ""));
  put(tags, "00080050", "SH", study.accession);
  put(tags, "00080060", "CS", study.modality);
  put(tags, "00081030", "LO", study.description);
  put(tags, "00100010", "PN", patient?.name ? [{ Alphabetic: patient.name }] : undefined);
  put(tags, "00100020", "LO", patient?.mrn);
  put(tags, "0020000D", "UI", study.studyUid);
  return tags;
}

function seriesDicomJson(series, study) {
  const tags = {};
  put(tags, "00080060", "CS", series.modality || study.modality);
  put(tags, "0008103E", "LO", series.description);
  put(tags, "0020000D", "UI", study.studyUid);
  put(tags, "0020000E", "UI", series.seriesUid);
  put(tags, "00200011", "IS", series.seriesNumber);
  return tags;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function ensureGeometry(instance) {
  if (instance.geometryReady) return instance;
  try {
    let buffer = null;
    if (instance.filePath && fs.existsSync(instance.filePath)) {
      buffer = await fs.promises.readFile(instance.filePath);
    }
    if (!buffer) throw new Error("The DICOM file is not in local storage");
    const spatial = readSpatialTags(buffer);
    instance.set({ ...spatial, geometryReady: true });
  } catch {
    instance.geometryReady = true;
  }
  await instance.save();
  return instance;
}

function fileOnDisk(instance) {
  return Boolean(instance.filePath && fs.existsSync(instance.filePath));
}

function publicInstance(instance) {
  const available = fileOnDisk(instance);
  return {
    _id: instance._id,
    sopUid: instance.sopUid,
    sopClassUid: instance.sopClassUid || "",
    instanceNumber: instance.instanceNumber || 0,
    numberOfFrames: instance.numberOfFrames || 1,
    rows: instance.rows || 0,
    columns: instance.columns || 0,
    bitsAllocated: instance.bitsAllocated || 0,
    bitsStored: instance.bitsStored || 0,
    pixelRepresentation: instance.pixelRepresentation || 0,
    photometric: instance.photometric || "",
    samplesPerPixel: instance.samplesPerPixel || 1,
    pixelSpacing: instance.pixelSpacing || [],
    windowCenter: instance.windowCenter,
    windowWidth: instance.windowWidth,
    slope: instance.slope ?? 1,
    intercept: instance.intercept ?? 0,
    sliceThickness: instance.sliceThickness,
    spacingBetweenSlices: instance.spacingBetweenSlices,
    imagePositionPatient: instance.imagePositionPatient || [],
    imageOrientationPatient: instance.imageOrientationPatient || [],
    frameOfReferenceUid: instance.frameOfReferenceUid || "",
    transferSyntax: instance.transferSyntax || "",
    manufacturer: instance.manufacturer || "",
    institution: instance.institution || "",
    fileAvailable: available,
    hasArchiveCopy: available || Boolean(instance.orthancId),
  };
}

async function loadStudyByUid(req, studyUid, loadReadableStudy) {
  const uid = safeUid(studyUid);
  if (!uid) return null;
  const study = await Study.findOne({ $or: [{ studyUid: uid }, { aliases: uid }] });
  if (!study) return null;
  return loadReadableStudy(req, study._id);
}

function sendLocalDicom(req, res, filePath, etag) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.get("if-none-match") === etag) {
    res.status(304).end();
    return true;
  }
  const range = req.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).end();
      return true;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end >= stat.size) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return true;
    }
    res.status(206);
    res.setHeader("Content-Type", "application/dicom");
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }
  res.setHeader("Content-Type", "application/dicom");
  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function sanitizeAnnotations(value) {
  if (!Array.isArray(value)) throw Object.assign(new Error("Annotations must be a list"), { status: 400 });
  if (value.length > 400) throw Object.assign(new Error("Too many annotations"), { status: 400 });
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw Object.assign(new Error("Each annotation must be an object"), { status: 400 });
    }
    const clone = JSON.parse(JSON.stringify(item));
    if (JSON.stringify(clone).length > 80000) {
      throw Object.assign(new Error("An annotation is too large to store"), { status: 400 });
    }
    return clone;
  });
}

async function proxyOrthanc(res, path) {
  const upstream = await orthancFetch(path, { timeoutMs: 120000 });
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.setHeader("cache-control", "private, max-age=60");
  const body = Buffer.from(await upstream.arrayBuffer());
  res.send(body);
}

export function registerDicomweb(app, { requireUser, requirePermission, wrap, audit, loadReadableStudy }) {
  const read = [requireUser, requirePermission("dicom.read")];

  app.get("/api/dicomweb/studies", ...read, wrap(async (req, res) => {
    const uid = safeUid(req.query.StudyInstanceUID);
    const filter = uid ? { $or: [{ studyUid: uid }, { aliases: uid }] } : {};
    const studies = await Study.find(filter).sort({ updatedAt: -1 }).limit(50).populate("patientId", "name mrn");
    const visible = [];
    for (const study of studies) {
      const allowed = await loadReadableStudy(req, study._id);
      if (allowed) visible.push(studyDicomJson(allowed, study.patientId));
    }
    res.json(visible);
  }));

  app.get("/api/dicomweb/studies/:studyUid/series", ...read, wrap(async (req, res) => {
    const study = await loadStudyByUid(req, req.params.studyUid, loadReadableStudy);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const series = await Series.find({ studyId: study._id }).sort({ seriesNumber: 1 });
    res.json(series.map((item) => seriesDicomJson(item, study)));
  }));

  app.get("/api/dicomweb/studies/:studyUid/series/:seriesUid/instances", ...read, wrap(async (req, res) => {
    const loaded = await loadSeries(req, loadReadableStudy);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    res.json(loaded.instances.map((instance) => instanceDicomJson(instance, loaded.study, loaded.series)));
  }));

  app.get("/api/dicomweb/studies/:studyUid/series/:seriesUid/metadata", ...read, wrap(async (req, res) => {
    const loaded = await loadSeries(req, loadReadableStudy);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    await audit(req, "dicom.metadata", "series", loaded.series._id, loaded.study.facilityId, { count: loaded.instances.length });
    res.setHeader("content-type", "application/dicom+json");
    res.send(JSON.stringify(loaded.instances.map((instance) => instanceDicomJson(instance, loaded.study, loaded.series))));
  }));

  app.get("/api/dicomweb/studies/:studyUid/series/:seriesUid/instances/:sopUid", ...read, wrap(async (req, res) => {
    const loaded = await loadInstanceByUid(req, loadReadableStudy);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const sent = sendLocalDicom(req, res, await localDicomPath(loaded.instance), dicomEtag(loaded.instance));
    if (!sent) return res.status(404).json({ error: MISSING_FILE });
  }));

  app.get("/api/dicomweb/instances/:id/file", ...read, wrap(async (req, res) => {
    const loaded = await loadInstanceById(req, loadReadableStudy);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const sent = sendLocalDicom(req, res, await localDicomPath(loaded.instance), dicomEtag(loaded.instance));
    if (!sent) return res.status(404).json({ error: MISSING_FILE });
  }));

  app.get("/api/dicomweb/studies/:studyUid/series/:seriesUid/orthanc/metadata", ...read, wrap(async (req, res) => {
    if (!orthancConfigured()) return res.status(503).json({ error: "Orthanc is not configured" });
    const studyUid = safeUid(req.params.studyUid);
    const seriesUid = safeUid(req.params.seriesUid);
    const study = await loadStudyByUid(req, studyUid, loadReadableStudy);
    if (!study || !seriesUid) return res.status(404).json({ error: "Study not found" });
    const series = await Series.findOne({ studyId: study._id, seriesUid });
    if (!series) return res.status(404).json({ error: "Series not found" });
    try {
      await proxyOrthanc(res, `/dicom-web/studies/${studyUid}/series/${seriesUid}/metadata`);
    } catch (error) {
      const status = error.orthancStatus === 404 ? 404 : (error.status || 502);
      res.status(status).json({ error: error.orthancStatus === 404 ? "Orthanc has no DICOMweb metadata for this series" : error.message });
    }
  }));

  app.get("/api/dicomweb/studies/:studyUid/series/:seriesUid/instances/:sopUid/frames/:frames", ...read, wrap(async (req, res) => {
    if (!orthancConfigured()) return res.status(503).json({ error: "Orthanc is not configured" });
    if (!/^[0-9]+(?:,[0-9]+)*$/.test(req.params.frames || "")) return res.status(400).json({ error: "Frame number is invalid" });
    const loaded = await loadInstanceByUid(req, loadReadableStudy);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const studyUid = safeUid(req.params.studyUid);
    const seriesUid = safeUid(req.params.seriesUid);
    const sopUid = safeUid(req.params.sopUid);
    try {
      await proxyOrthanc(res, `/dicom-web/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/frames/${req.params.frames}`);
    } catch (error) {
      const status = error.orthancStatus === 404 ? 404 : (error.status || 502);
      res.status(status).json({ error: error.orthancStatus === 404 ? "Orthanc did not return that frame" : error.message });
    }
  }));

  app.get("/api/viewer/studies/:id/catalog", ...read, wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const patient = await study.populate("patientId", "name mrn birthDate sex");
    const series = await Series.find({ studyId: study._id }).sort({ seriesNumber: 1 });
    const instances = await Instance.find({ studyId: study._id });
    await mapPool(instances, 4, (instance) => ensureGeometry(instance));
    const bySeries = new Map(series.map((item) => [String(item._id), []]));
    for (const instance of instances) {
      const bucket = bySeries.get(String(instance.seriesId));
      if (bucket) bucket.push(instance);
    }
    const availableCount = instances.filter(fileOnDisk).length;
    const archiveCount = await archiveImageCount(study.studyUid);
    if (archiveCount > instances.length) backfillStudyByUid(study.studyUid).catch(() => {});
    await audit(req, "dicom.catalog", "study", study._id, study.facilityId, { series: series.length, instances: instances.length });
    res.json({
      source: "local-dicom",
      orthancConfigured: orthancConfigured(),
      storedInstances: instances.length,
      availableInstances: availableCount,
      archiveInstances: archiveCount,
      pixelsMissing: availableCount === 0 && archiveCount === 0 && instances.length > 0,
      annotationStandard: "application-json",
      dicomSr: false,
      patient: {
        name: patient.patientId?.name || "",
        mrn: patient.patientId?.mrn || "",
        birthDate: patient.patientId?.birthDate || "",
        sex: patient.patientId?.sex || "",
      },
      study: {
        _id: study._id,
        studyUid: study.studyUid,
        accession: study.accession,
        modality: study.modality,
        description: study.description,
        studyDate: study.studyDate,
        status: study.status,
      },
      series: series.map((item) => {
        const sorted = sortInstances((bySeries.get(String(item._id)) || []).map(publicInstance));
        return {
          _id: item._id,
          seriesUid: item.seriesUid,
          seriesNumber: item.seriesNumber,
          modality: item.modality || study.modality,
          description: item.description || "",
          imageCount: sorted.reduce((sum, instance) => sum + (instance.numberOfFrames || 1), 0),
          volume: volumeAssessment(sorted),
          instances: sorted,
        };
      }),
    });
  }));

  app.get("/api/viewer/studies/:id/annotations", ...read, wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const records = await ViewerAnnotation.find({ studyId: study._id });
    res.json({
      standard: "application",
      dicomSr: false,
      notice: "These are application annotations. They are not DICOM SR or DICOM SEG objects, and they do not modify the source images.",
      records: records.map(publicAnnotation),
    });
  }));

  app.put("/api/viewer/studies/:id/annotations", ...read, wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const body = z.object({
      seriesId: z.string().min(1),
      annotations: z.array(z.record(z.any())).max(400),
    }).parse(req.body);
    const series = await Series.findOne({ _id: body.seriesId, studyId: study._id });
    if (!series) return res.status(404).json({ error: "Series not found" });
    const annotations = sanitizeAnnotations(body.annotations);
    const record = await ViewerAnnotation.findOneAndUpdate(
      { studyId: study._id, seriesId: series._id },
      {
        studyId: study._id,
        seriesId: series._id,
        facilityId: study.facilityId,
        format: "application-json",
        standard: "application",
        dicomSr: false,
        annotations,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true },
    );
    await audit(req, "viewer.annotation.save", "series", series._id, study.facilityId, { count: annotations.length });
    res.json({ record: publicAnnotation(record), dicomSr: false, standard: "application" });
  }));

  app.post("/api/viewer/studies/:id/exports", ...read, wrap(async (req, res) => {
    const study = await loadReadableStudy(req, req.params.id);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const kind = z.enum(["png", "jpeg", "measurements", "print"]).parse(req.body?.kind);
    await audit(req, "viewer.export", "study", study._id, study.facilityId, { kind });
    res.json({ recorded: true, storedImage: false });
  }));

  app.get("/api/viewer/preferences", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const preference = await ViewerPreference.findOne({ userId: req.user._id });
    res.json({ preference: preference || defaultPreference(req.user._id) });
  }));

  app.put("/api/viewer/preferences", requireUser, requirePermission("dicom.read"), wrap(async (req, res) => {
    const body = z.object({
      layout: z.string().max(16).optional(),
      hiddenTools: z.array(z.string().max(40)).max(40).optional(),
      shortcuts: z.record(z.string().max(24)).optional(),
      windowPresets: z.array(z.object({
        id: z.string().max(40),
        label: z.string().max(40),
        center: z.number(),
        width: z.number().positive(),
      })).max(20).optional(),
      volumePresets: z.array(z.object({
        id: z.string().max(40),
        label: z.string().max(40),
        base: z.string().max(80),
        opacity: z.number().min(0).max(4),
        brightness: z.number().min(-2000).max(2000),
        background: z.array(z.number().min(0).max(1)).length(3),
      })).max(20).optional(),
      volume: z.object({
        preset: z.string().max(80).optional(),
        opacity: z.number().min(0).max(4).optional(),
        brightness: z.number().min(-2000).max(2000).optional(),
        background: z.array(z.number().min(0).max(1)).length(3).optional(),
      }).optional(),
      panelLeft: z.number().min(180).max(480).optional(),
      panelRight: z.number().min(220).max(520).optional(),
    }).parse(req.body);
    const preference = await ViewerPreference.findOneAndUpdate(
      { userId: req.user._id },
      { userId: req.user._id, ...body },
      { upsert: true, new: true },
    );
    await audit(req, "viewer.preference.save", "user", req.user._id, undefined, { layout: preference.layout });
    res.json({ preference });
  }));

  async function loadSeries(req, loadStudy) {
    const study = await loadStudyByUid(req, req.params.studyUid, loadStudy);
    const seriesUid = safeUid(req.params.seriesUid);
    if (!study || !seriesUid) return { status: 404, error: "Study not found" };
    const series = await Series.findOne({ studyId: study._id, seriesUid });
    if (!series) return { status: 404, error: "Series not found" };
    const instances = await Instance.find({ seriesId: series._id });
    await mapPool(instances, 4, (instance) => ensureGeometry(instance));
    return { study, series, instances: sortInstances(instances) };
  }

  async function loadInstanceByUid(req, loadStudy) {
    const loaded = await loadSeries(req, loadStudy);
    if (loaded.error) return loaded;
    const sopUid = safeUid(req.params.sopUid);
    const instance = loaded.instances.find((item) => item.sopUid === sopUid);
    if (!instance) return { status: 404, error: "Instance not found" };
    return { ...loaded, instance };
  }

  async function loadInstanceById(req, loadStudy) {
    const instance = await Instance.findById(req.params.id);
    if (!instance) return { status: 404, error: "Instance not found" };
    const study = await loadStudy(req, instance.studyId);
    if (!study) return { status: 404, error: "Instance not found" };
    return { instance, study };
  }
}

function dicomEtag(instance) {
  return `"dcm-${instance.sopUid}-${instance.byteLength || 0}"`;
}

function publicAnnotation(record) {
  return {
    _id: record._id,
    seriesId: record.seriesId,
    format: "application-json",
    standard: "application",
    dicomSr: false,
    annotations: record.annotations || [],
    updatedAt: record.updatedAt,
  };
}

function defaultPreference(userId) {
  return {
    userId,
    layout: "1",
    hiddenTools: [],
    shortcuts: {},
    windowPresets: [],
    volumePresets: [],
    volume: {},
    panelLeft: 280,
    panelRight: 300,
  };
}
