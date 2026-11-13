import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ageTokenFromName, normalizeAgeToken, sexFromName } from "../../shared/reportDocument.js";
import { dataDir } from "./config.js";
import { parseDicomBuffer } from "./dicom.js";
import { publishStudyChange } from "./liveEvents.js";
import { Instance, Patient, Series, Study, TransferJob } from "./models.js";
import { storeInOrthanc } from "./notify.js";
import { recordInstanceReceived } from "./transferProgress.js";

function asyncHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function ingestDicomBuffer({
  buffer,
  facilityId,
  source = "upload",
  fileName = "",
  orthancId: knownOrthancId = "",
  orthancStudyId = "",
  expectedFromOrthanc = null,
}) {
  const started = Date.now();
  let parsed;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    parsed = parseDicomBuffer(buffer);
    const foreignStudy = await Study.findOne({
      facilityId: { $ne: facilityId },
      $or: [{ studyUid: parsed.studyUid }, { aliases: parsed.studyUid }],
    }).select("_id");
    if (foreignStudy) throw new Error("Study UID already exists in another facility");
    const foreignInstance = await Instance.findOne({ sopUid: parsed.sopUid }).select("studyId filePath");
    if (foreignInstance) {
      const instanceStudy = await Study.findById(foreignInstance.studyId).select("facilityId");
      if (!instanceStudy || String(instanceStudy.facilityId) !== String(facilityId)) {
        throw new Error("SOP UID already exists in another facility");
      }
    }
    const sex = ["F", "M", "O", "U"].includes(parsed.sex) ? parsed.sex : "U";
    const recordedSex = sex !== "U" ? sex : (sexFromName(parsed.patientName) || "U");
    const ageToken = normalizeAgeToken(parsed.patientAge) || ageTokenFromName(parsed.patientName);
    const mrn = parsed.patientId || `NO-MRN-${asyncHash(parsed.studyUid).slice(0, 10)}`;
    let patient = await Patient.findOne({ facilityId, mrn });
    if (!patient) {
      patient = await Patient.create({
        facilityId,
        name: parsed.patientName || "Unknown",
        mrn,
        birthDate: parsed.birthDate,
        sex: recordedSex,
      });
    } else {
      if (!patient.birthDate && parsed.birthDate) patient.birthDate = parsed.birthDate;
      if ((!patient.sex || patient.sex === "U") && recordedSex !== "U") patient.sex = recordedSex;
      if ((!patient.name || patient.name === "Unknown") && parsed.patientName && parsed.patientName !== "Unknown") patient.name = parsed.patientName;
      if (patient.isModified()) await patient.save();
    }
    const accession = parsed.accession || `UID-${parsed.studyUid.slice(-12)}`;
    let study = await Study.findOne({
      facilityId,
      $or: [{ studyUid: parsed.studyUid }, { aliases: parsed.studyUid }],
    });
    if (!study) {
      study = await Study.findOne({ facilityId, accession });
    }
    const createdStudy = !study;
    if (!study) {
      study = await Study.create({
        patientId: patient._id,
        facilityId,
        readingFacilityId: facilityId,
        accession,
        studyUid: parsed.studyUid,
        modality: parsed.modality,
        description: parsed.description,
        studyDate: parsed.studyDate,
        patientAge: ageToken,
        status: "acquired",
        acquiredAt: new Date(),
        transferPhase: "receiving",
        transferStartedAt: new Date(),
        orthancStudyId: orthancStudyId || "",
        receivedInstances: 0,
        receivedBytes: 0,
        expectedInstances: parsed.numberOfStudyRelatedInstances || null,
      });
    } else {
      const known = study.studyUid === parsed.studyUid || (study.aliases || []).includes(parsed.studyUid);
      if (!known) {
        study.aliases = [...(study.aliases || []), study.studyUid];
        study.studyUid = parsed.studyUid;
      }
      if (study.status === "booked") {
        study.status = "acquired";
        study.acquiredAt = study.acquiredAt || new Date();
      }
      if (ageToken && !normalizeAgeToken(study.patientAge)) study.patientAge = ageToken;
      if (study.isModified()) await study.save();
    }
    let series = await Series.findOne({ seriesUid: parsed.seriesUid });
    if (series) {
      const seriesStudy = await Study.findById(series.studyId).select("facilityId");
      if (!seriesStudy || String(seriesStudy.facilityId) !== String(facilityId) || String(series.studyId) !== String(study._id)) {
        throw new Error("Series UID already exists in another facility");
      }
    } else {
      series = await Series.create({
        studyId: study._id,
        seriesUid: parsed.seriesUid,
        seriesNumber: parsed.seriesNumber,
        modality: parsed.modality,
        description: parsed.seriesDescription,
      });
    }
    const safeName = parsed.sopUid.replace(/[^0-9.]/g, "_");
    const filePath = path.join(dataDir(), `${safeName}.dcm`);
    const existing = foreignInstance;
    fs.writeFileSync(filePath, buffer);
    let orthancId = knownOrthancId || "";
    if (!orthancId && process.env.ORTHANC_URL && source !== "orthanc") {
      orthancId = await storeInOrthanc(buffer);
    }
    const priorInstance = await Instance.findOne({ sopUid: parsed.sopUid }).select("_id");
    const instance = await Instance.findOneAndUpdate(
      { sopUid: parsed.sopUid },
      {
        seriesId: series._id,
        studyId: study._id,
        sopUid: parsed.sopUid,
        transferSyntax: parsed.transferSyntax,
        rows: parsed.rows,
        columns: parsed.columns,
        bitsAllocated: parsed.bitsAllocated,
        bitsStored: parsed.bitsStored,
        pixelRepresentation: parsed.pixelRepresentation,
        photometric: parsed.photometric,
        samplesPerPixel: parsed.samplesPerPixel,
        pixelSpacing: parsed.pixelSpacing,
        imagerPixelSpacing: parsed.imagerPixelSpacing,
        windowCenter: parsed.windowCenter,
        windowWidth: parsed.windowWidth,
        slope: parsed.slope,
        intercept: parsed.intercept,
        filePath,
        orthancId,
        byteLength: buffer.length,
        instanceNumber: parsed.instanceNumber || 0,
        numberOfFrames: parsed.numberOfFrames || 1,
        sliceThickness: parsed.sliceThickness ?? undefined,
        spacingBetweenSlices: parsed.spacingBetweenSlices ?? undefined,
        imagePositionPatient: parsed.imagePositionPatient?.length ? parsed.imagePositionPatient : undefined,
        imageOrientationPatient: parsed.imageOrientationPatient?.length ? parsed.imageOrientationPatient : undefined,
        frameOfReferenceUid: parsed.frameOfReferenceUid || "",
        sliceLocation: parsed.sliceLocation ?? undefined,
        sopClassUid: parsed.sopClassUid || "",
        manufacturer: parsed.manufacturer || "",
        institution: parsed.institution || "",
        geometryReady: true,
      },
      { upsert: true, new: true },
    );
    const isNewInstance = !priorInstance;
    await TransferJob.create({
      facilityId,
      direction: "inbound",
      source,
      fileName,
      sopUid: parsed.sopUid,
      studyUid: parsed.studyUid,
      accession: parsed.accession || "",
      modality: parsed.modality || "",
      status: existing || priorInstance ? "duplicate" : "stored",
      instanceId: instance._id,
      bytes: buffer.length,
      durationMs: Date.now() - started,
    });
    await recordInstanceReceived({
      study,
      bytes: buffer.length,
      isNewInstance,
      orthancStudyId,
      expectedFromDicom: parsed.numberOfStudyRelatedInstances,
      expectedFromOrthanc,
    });
    publishStudyChange(facilityId, study._id, createdStudy ? "study.created" : "study.updated");
    return { instanceId: instance._id, patientId: patient._id, studyId: study._id, sopUid: parsed.sopUid };
  } catch (error) {
    await TransferJob.create({
      facilityId,
      direction: "inbound",
      source,
      fileName,
      sopUid: parsed?.sopUid || "",
      studyUid: parsed?.studyUid || "",
      status: "rejected",
      error: error.message,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
