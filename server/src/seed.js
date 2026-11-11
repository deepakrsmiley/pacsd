import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { buildSampleDicom, parseDicomBuffer } from "./dicom.js";
import { Facility, Instance, Patient, Series, Study, Template, User } from "./models.js";
import { ensureOrganization } from "./enterprise.js";

export async function seedIfEmpty() {
  if (await User.countDocuments()) return { seeded: false };
  const password = process.env.DEMO_PASSWORD || "Galactic-Demo-2026";
  const passwordHash = await bcrypt.hash(password, 10);
  const north = await Facility.create({ name: "GMS North Wing", code: "GNW" });
  const south = await Facility.create({ name: "GMS South Wing", code: "GSW" });
  const organization = await ensureOrganization();
  north.organizationId = organization._id;
  south.organizationId = organization._id;
  await north.save();
  await south.save();
  const [admin, radiologist, technologist] = await User.create([
    { name: "GMS Administrator", email: "admin@galactic.test", passwordHash, role: "system_admin", facilityIds: [north._id, south._id] },
    { name: "Dr. Kavita Menon", email: "kavita.menon@galactic.test", passwordHash, role: "radiologist", facilityIds: [north._id, south._id] },
    { name: "North Wing Technologist", email: "tech.north@galactic.test", passwordHash, role: "technologist", facilityIds: [north._id] },
  ]);
  await User.create({
    name: "North Wing Desk",
    email: "desk.north@galactic.test",
    passwordHash,
    role: "referring_physician",
    facilityIds: [north._id],
  });

  const patient = await Patient.create({
    facilityId: north._id,
    name: "Sample North",
    mrn: "DEMO-1001",
    birthDate: "1980-01-01",
    sex: "F",
    synthetic: true,
  });
  const buffer = buildSampleDicom({
    patientName: "Sample^North",
    patientId: "DEMO-1001",
    accession: "ACC-DEMO-1001",
    modality: "CT",
    description: "Synthetic demonstration head CT",
    birthDate: "19800101",
    sex: "F",
  });
  const parsed = parseDicomBuffer(buffer);
  fs.mkdirSync(dataDir(), { recursive: true });
  const filePath = path.join(dataDir(), `${parsed.sopUid.replace(/[^0-9.]/g, "_")}.dcm`);
  fs.writeFileSync(filePath, buffer);
  const study = await Study.create({
    patientId: patient._id,
    facilityId: north._id,
    readingFacilityId: south._id,
    assignedTo: radiologist._id,
    accession: "ACC-DEMO-1001",
    studyUid: parsed.studyUid,
    modality: "CT",
    description: "Synthetic demonstration head CT",
    studyDate: parsed.studyDate,
    status: "acquired",
    priority: "urgent",
    acquiredAt: new Date(),
  });
  const series = await Series.create({
    studyId: study._id,
    seriesUid: parsed.seriesUid,
    seriesNumber: 1,
    modality: "CT",
    description: "Synthetic series",
  });
  await Instance.create({
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
    slope: parsed.slope,
    intercept: parsed.intercept,
    filePath,
    byteLength: buffer.length,
  });
  await Study.create({
    patientId: patient._id,
    facilityId: north._id,
    readingFacilityId: north._id,
    accession: "ACC-DEMO-1002",
    studyUid: `1.2.826.0.1.3680043.10.543.seed.${Date.now()}`,
    modality: "DX",
    description: "Synthetic chest radiograph order",
    studyDate: new Date().toISOString().slice(0, 10),
    status: "booked",
    priority: "routine",
  });
  await Template.create([
    {
      name: "CT structured draft",
      modality: "CT",
      technique: "Technique is recorded by the technologist and checked by the reporting radiologist.",
      findings: "Clinical information:\n\nComparison:\n\nFindings:\n",
      impression: "Impression:\n",
    },
    {
      name: "Radiograph structured draft",
      modality: "DX",
      technique: "Projection and technique as acquired.",
      findings: "Clinical information:\n\nFindings:\n",
      impression: "Impression:\n",
    },
  ]);
  return { seeded: true, admin: admin.email, technologist: technologist.email };
}
