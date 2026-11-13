import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import dicomParser from "dicom-parser";

const SHORT_VR = new Set([
  "AE", "AS", "AT", "CS", "DA", "DS", "DT", "FL", "FD", "IS", "LO", "LT",
  "PN", "SH", "SL", "SS", "ST", "TM", "UI", "UL", "US",
]);
const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const IMPLICIT_LE = "1.2.840.10008.1.2";
const MAX_PIXELS = 2048 * 2048;

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function tag(group, element) {
  return Buffer.concat([u16(group), u16(element)]);
}

function padValue(vr, raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  if (buffer.length % 2 === 0) return buffer;
  return Buffer.concat([buffer, Buffer.from([vr === "UI" ? 0 : 0x20])]);
}

function element(group, elementNumber, vr, raw) {
  const value = padValue(vr, raw);
  const head = Buffer.concat([tag(group, elementNumber), Buffer.from(vr, "ascii")]);
  if (SHORT_VR.has(vr)) return Buffer.concat([head, u16(value.length), value]);
  return Buffer.concat([head, u16(0), u32(value.length), value]);
}

function numeric(group, elementNumber, vr, value, bytes) {
  const buffer = Buffer.alloc(bytes);
  if (bytes === 2) buffer.writeUInt16LE(value);
  else buffer.writeUInt32LE(value);
  return element(group, elementNumber, vr, buffer);
}

export function createUid(suffix) {
  const random = crypto.randomInt(1, 1_000_000_000);
  return `1.2.826.0.1.3680043.10.543.${Date.now()}.${random}.${suffix}`;
}

export function buildSampleDicom({
  patientName = "Sample^North",
  patientId = "DEMO-1001",
  accession = "ACC-DEMO-1001",
  modality = "CT",
  description = "Synthetic demonstration study",
  birthDate = "19800101",
  sex = "F",
  patientAge = "",
  rows = 64,
  columns = 64,
  pixelSpacing = "",
  imagerPixelSpacing = "",
  characterSet = "",
  studyUid: studyUidOption = "",
  seriesUid: seriesUidOption = "",
  sopUid: sopUidOption = "",
  instanceNumber = 1,
  imagePosition = "",
  imageOrientation = "",
  sliceThickness = "",
  frameOfReferenceUid = "",
  manufacturer = "",
  institution = "",
  seriesDescription = "Synthetic series",
} = {}) {
  const studyUid = studyUidOption || createUid(1);
  const seriesUid = seriesUidOption || createUid(2);
  const sopUid = sopUidOption || createUid(3);
  const sopClass = "1.2.840.10008.5.1.4.1.1.7";
  const pixels = Buffer.alloc(rows * columns);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const ring = Math.abs(x - columns / 2) + Math.abs(y - rows / 2);
      pixels[y * columns + x] = Math.max(0, 220 - ring * 4);
    }
  }
  const metaRest = Buffer.concat([
    element(0x0002, 0x0001, "OB", Buffer.from([0x00, 0x01])),
    element(0x0002, 0x0002, "UI", sopClass),
    element(0x0002, 0x0003, "UI", sopUid),
    element(0x0002, 0x0010, "UI", EXPLICIT_LE),
    element(0x0002, 0x0012, "UI", "1.2.826.0.1.3680043.10.543.1"),
  ]);
  const fileMeta = Buffer.concat([numeric(0x0002, 0x0000, "UL", metaRest.length, 4), metaRest]);
  const today = new Date();
  const studyDate = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const dataset = Buffer.concat([
    ...(characterSet ? [element(0x0008, 0x0005, "CS", characterSet)] : []),
    element(0x0008, 0x0016, "UI", sopClass),
    element(0x0008, 0x0018, "UI", sopUid),
    element(0x0008, 0x0020, "DA", studyDate),
    element(0x0008, 0x0030, "TM", "120000"),
    element(0x0008, 0x0050, "SH", accession),
    element(0x0008, 0x0060, "CS", modality),
    element(0x0008, 0x1030, "LO", description),
    element(0x0008, 0x103e, "LO", seriesDescription),
    ...(manufacturer ? [element(0x0008, 0x0070, "LO", manufacturer)] : []),
    ...(institution ? [element(0x0008, 0x0080, "LO", institution)] : []),
    element(0x0010, 0x0010, "PN", patientName),
    element(0x0010, 0x0020, "LO", patientId),
    element(0x0010, 0x0030, "DA", birthDate),
    element(0x0010, 0x0040, "CS", sex),
    ...(patientAge ? [element(0x0010, 0x1010, "AS", patientAge)] : []),
    ...(imagerPixelSpacing ? [element(0x0018, 0x1164, "DS", imagerPixelSpacing)] : []),
    ...(sliceThickness ? [element(0x0018, 0x0050, "DS", sliceThickness)] : []),
    element(0x0020, 0x000d, "UI", studyUid),
    element(0x0020, 0x000e, "UI", seriesUid),
    element(0x0020, 0x0011, "IS", "1"),
    element(0x0020, 0x0013, "IS", String(instanceNumber)),
    ...(frameOfReferenceUid ? [element(0x0020, 0x0052, "UI", frameOfReferenceUid)] : []),
    ...(imagePosition ? [element(0x0020, 0x0032, "DS", imagePosition)] : []),
    ...(imageOrientation ? [element(0x0020, 0x0037, "DS", imageOrientation)] : []),
    numeric(0x0028, 0x0002, "US", 1, 2),
    element(0x0028, 0x0004, "CS", "MONOCHROME2"),
    numeric(0x0028, 0x0010, "US", rows, 2),
    numeric(0x0028, 0x0011, "US", columns, 2),
    ...(pixelSpacing ? [element(0x0028, 0x0030, "DS", pixelSpacing)] : []),
    numeric(0x0028, 0x0100, "US", 8, 2),
    numeric(0x0028, 0x0101, "US", 8, 2),
    numeric(0x0028, 0x0102, "US", 7, 2),
    numeric(0x0028, 0x0103, "US", 0, 2),
    element(0x7fe0, 0x0010, "OB", pixels),
  ]);
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM", "ascii"), fileMeta, dataset]);
}

function numberFrom(dataSet, tagName) {
  const raw = dataSet.string(tagName);
  if (!raw) return null;
  const value = Number(String(raw).split("\\")[0]);
  return Number.isFinite(value) ? value : null;
}

const OPPOSITE_DIRECTION = { L: "R", R: "L", A: "P", P: "A", H: "F", F: "H" };

function orientationMarkers(dataSet) {
  const patient = String(dataSet.string("x00200020") || "").split("\\").map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (patient.length >= 2) return markersFromDirections(patient[0], patient[1]);
  const cosines = String(dataSet.string("x00200037") || "").split("\\").map(Number);
  if (cosines.length < 6 || cosines.some((value) => !Number.isFinite(value))) return null;
  return markersFromDirections(directionLetter(cosines.slice(0, 3)), directionLetter(cosines.slice(3, 6)));
}

function markersFromDirections(rowDirection, columnDirection) {
  const right = String(rowDirection || "").replace(/[^LRAPFH]/g, "").slice(0, 1);
  const bottom = String(columnDirection || "").replace(/[^LRAPFH]/g, "").slice(0, 1);
  const left = OPPOSITE_DIRECTION[right];
  const top = OPPOSITE_DIRECTION[bottom];
  if (!left || !top) return null;
  return { left, right, top, bottom };
}

function directionLetter(vector) {
  const axes = [
    [Math.abs(vector[0]), vector[0] >= 0 ? "L" : "R"],
    [Math.abs(vector[1]), vector[1] >= 0 ? "P" : "A"],
    [Math.abs(vector[2]), vector[2] >= 0 ? "H" : "F"],
  ].sort((a, b) => b[0] - a[0]);
  return axes[0][0] >= 0.2 ? axes[0][1] : "";
}

function decimalList(dataSet, tagName, count) {
  const raw = dataSet.string(tagName);
  if (!raw) return [];
  const parts = String(raw).split("\\").slice(0, count).map((item) => Number(item));
  if (parts.length < count || parts.some((value) => !Number.isFinite(value))) return [];
  return parts;
}

export function spatialFromDataSet(dataSet) {
  const bitsStored = dataSet.uint16("x00280101") || dataSet.uint16("x00280100") || 0;
  return {
    instanceNumber: Number(dataSet.string("x00200013") || 0) || 0,
    numberOfFrames: Number(dataSet.string("x00280008") || 1) || 1,
    sliceThickness: numberFrom(dataSet, "x00180050"),
    spacingBetweenSlices: numberFrom(dataSet, "x00180088"),
    imagePositionPatient: decimalList(dataSet, "x00200032", 3),
    imageOrientationPatient: decimalList(dataSet, "x00200037", 6),
    frameOfReferenceUid: (dataSet.string("x00200052") || "").trim(),
    sliceLocation: numberFrom(dataSet, "x00201041"),
    sopClassUid: (dataSet.string("x00080016") || "").trim(),
    manufacturer: (dataSet.string("x00080070") || "").trim(),
    institution: (dataSet.string("x00080080") || "").trim(),
    highBit: dataSet.uint16("x00280102") ?? (bitsStored ? bitsStored - 1 : 0),
  };
}

export function readSpatialTags(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 132 || Buffer.from(bytes.subarray(128, 132)).toString("ascii") !== "DICM") {
    throw new Error("File is not a DICOM part 10 object");
  }
  return spatialFromDataSet(dicomParser.parseDicom(bytes));
}

function decimalPair(dataSet, tagName) {
  const raw = dataSet.string(tagName);
  if (!raw) return [];
  const parts = String(raw).split("\\").slice(0, 2).map((item) => Number(item));
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value) || value <= 0)) return [];
  return parts;
}

const CHARSET_LABEL = {
  "ISO_IR 6": "latin1",
  "ISO_IR 100": "iso-8859-1",
  "ISO_IR 101": "iso-8859-2",
  "ISO_IR 109": "iso-8859-3",
  "ISO_IR 110": "iso-8859-4",
  "ISO_IR 126": "iso-8859-7",
  "ISO_IR 127": "iso-8859-6",
  "ISO_IR 138": "iso-8859-8",
  "ISO_IR 144": "iso-8859-5",
  "ISO_IR 148": "iso-8859-9",
  "ISO_IR 166": "tis-620",
  "ISO_IR 192": "utf-8",
  GB18030: "gb18030",
  GBK: "gbk",
};

function textBytes(dataSet, bytes, tagName) {
  const item = dataSet.elements[tagName];
  if (!item?.length) return null;
  return Buffer.from(bytes.subarray(item.dataOffset, item.dataOffset + item.length));
}

export function decodeDicomText(raw, specificCharacterSet) {
  if (!raw?.length) return "";
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0 || raw[end - 1] === 32)) end -= 1;
  const token = String(specificCharacterSet || "").split("\\").map((item) => item.trim()).filter(Boolean)[0] || "";
  const label = CHARSET_LABEL[token] || (token ? "utf-8" : "latin1");
  return new TextDecoder(label).decode(raw.subarray(0, end));
}

function personName(raw, specificCharacterSet) {
  const decoded = decodeDicomText(raw, specificCharacterSet).replace(/[\\^=]/g, " ").replace(/\s+/g, " ").trim();
  return decoded || "Unknown";
}

function formatDicomDate(value) {
  if (!value || value.length < 8) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatPatientAge(value) {
  const match = String(value || "").trim().match(/^0*(\d{1,3})\s*([DWMY])$/i);
  if (!match) return "";
  const count = Number(match[1]);
  const unit = match[2].toUpperCase();
  const limit = { Y: 130, M: 240, W: 260, D: 999 }[unit];
  return count > 0 && count <= limit ? `${count}${unit}` : "";
}

const UNCOMPRESSED_LE = new Set([EXPLICIT_LE, IMPLICIT_LE]);

export function isUncompressedLittleEndian(transferSyntax) {
  return UNCOMPRESSED_LE.has(transferSyntax);
}

export function orthancDecodedFrameName({ samplesPerPixel = 1, bitsAllocated = 8, pixelRepresentation = 0 } = {}) {
  if (samplesPerPixel > 1 || bitsAllocated <= 8) return "image-uint8";
  if (pixelRepresentation === 1) return "image-int16";
  return "image-uint16";
}

export function parseDicomBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 132 || Buffer.from(bytes.subarray(128, 132)).toString("ascii") !== "DICM") {
    throw new Error("File is not a DICOM part 10 object");
  }
  const dataSet = dicomParser.parseDicom(bytes);
  const pixelElement = dataSet.elements.x7fe00010;
  let pixels = null;
  if (pixelElement && pixelElement.length > 0) {
    pixels = Buffer.from(bytes.subarray(pixelElement.dataOffset, pixelElement.dataOffset + pixelElement.length));
  }
  const specificCharacterSet = dataSet.string("x00080005") || "";
  const transferSyntax = dataSet.string("x00020010") || "";
  const rows = dataSet.uint16("x00280010") || 0;
  const columns = dataSet.uint16("x00280011") || 0;
  const bitsAllocated = dataSet.uint16("x00280100") || 0;
  const photometric = dataSet.string("x00280004") || "";
  const samples = dataSet.uint16("x00280002") || 1;
  const supportedSyntax = transferSyntax === EXPLICIT_LE || transferSyntax === IMPLICIT_LE;
  const supportedPixels = samples === 1 && (photometric === "MONOCHROME1" || photometric === "MONOCHROME2")
    && (bitsAllocated === 8 || bitsAllocated === 16)
    && rows > 0 && columns > 0 && rows * columns <= MAX_PIXELS
    && pixels
    && pixels.length >= rows * columns * (bitsAllocated / 8);
  return {
    patientName: personName(textBytes(dataSet, bytes, "x00100010"), specificCharacterSet),
    patientId: (dataSet.string("x00100020") || "").trim(),
    birthDate: formatDicomDate(dataSet.string("x00100030") || ""),
    sex: (dataSet.string("x00100040") || "U").slice(0, 1).toUpperCase(),
    patientAge: formatPatientAge(dataSet.string("x00101010") || ""),
    accession: (dataSet.string("x00080050") || "").trim(),
    modality: (dataSet.string("x00080060") || "OT").trim().toUpperCase(),
    description: dataSet.string("x00081030") || "",
    studyDate: formatDicomDate(dataSet.string("x00080020") || ""),
    studyUid: dataSet.string("x0020000d") || createUid(4),
    seriesUid: dataSet.string("x0020000e") || createUid(5),
    seriesNumber: Number(dataSet.string("x00200011") || 1) || 1,
    seriesDescription: dataSet.string("x0008103e") || "",
    sopUid: dataSet.string("x00080018") || createUid(6),
    transferSyntax,
    rows,
    columns,
    bitsAllocated,
    bitsStored: dataSet.uint16("x00280101") || bitsAllocated,
    pixelRepresentation: dataSet.uint16("x00280103") || 0,
    photometric,
    samplesPerPixel: samples,
    numberOfFrames: Number(dataSet.string("x00280008") || 1) || 1,
    numberOfStudyRelatedInstances: (() => {
      const raw = Number(dataSet.string("x00201208") || 0);
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    })(),
    pixelSpacing: decimalPair(dataSet, "x00280030"),
    imagerPixelSpacing: decimalPair(dataSet, "x00181164"),
    orientation: orientationMarkers(dataSet),
    windowCenter: numberFrom(dataSet, "x00281050"),
    windowWidth: numberFrom(dataSet, "x00281051"),
    slope: numberFrom(dataSet, "x00281053") ?? 1,
    intercept: numberFrom(dataSet, "x00281052") ?? 0,
    ...spatialFromDataSet(dataSet),
    pixels,
    previewSupported: Boolean(supportedSyntax && supportedPixels),
    previewReason: supportedSyntax && supportedPixels
      ? ""
      : "Built-in viewer supports uncompressed little-endian single-frame grayscale up to 2048 square. Use an Orthanc archive for other transfer syntaxes.",
  };
}

const TAG_CATALOG = [
  ["0002,0010", "Transfer Syntax UID", "x00020010"],
  ["0008,0018", "SOP Instance UID", "x00080018"],
  ["0008,0020", "Study Date", "x00080020"],
  ["0008,0030", "Study Time", "x00080030"],
  ["0008,0050", "Accession Number", "x00080050"],
  ["0008,0060", "Modality", "x00080060"],
  ["0008,0070", "Manufacturer", "x00080070"],
  ["0008,0080", "Institution Name", "x00080080"],
  ["0008,1030", "Study Description", "x00081030"],
  ["0008,103E", "Series Description", "x0008103e"],
  ["0008,1090", "Manufacturer Model", "x00081090"],
  ["0010,0010", "Patient Name", "x00100010"],
  ["0010,0020", "Patient ID", "x00100020"],
  ["0010,0030", "Patient Birth Date", "x00100030"],
  ["0010,0040", "Patient Sex", "x00100040"],
  ["0018,0050", "Slice Thickness", "x00180050"],
  ["0018,0088", "Spacing Between Slices", "x00180088"],
  ["0018,5100", "Patient Position", "x00185100"],
  ["0020,000D", "Study Instance UID", "x0020000d"],
  ["0020,000E", "Series Instance UID", "x0020000e"],
  ["0020,0011", "Series Number", "x00200011"],
  ["0020,0013", "Instance Number", "x00200013"],
  ["0020,0032", "Image Position Patient", "x00200032"],
  ["0020,0037", "Image Orientation Patient", "x00200037"],
  ["0028,0010", "Rows", "x00280010"],
  ["0028,0011", "Columns", "x00280011"],
  ["0028,0030", "Pixel Spacing", "x00280030"],
  ["0028,0100", "Bits Allocated", "x00280100"],
  ["0028,0101", "Bits Stored", "x00280101"],
  ["0028,1050", "Window Center", "x00281050"],
  ["0028,1051", "Window Width", "x00281051"],
  ["0028,1052", "Rescale Intercept", "x00281052"],
  ["0028,1053", "Rescale Slope", "x00281053"],
];

export function dicomTagSummary(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(bytes);
  return TAG_CATALOG.map(([tag, name, key]) => {
    const element = dataSet.elements[key];
    let value = "";
    if (element) {
      if (element.vr === "US" || element.vr === "SS") value = String(dataSet.uint16(key) ?? dataSet.int16(key) ?? "");
      else if (element.vr === "UL" || element.vr === "SL") value = String(dataSet.uint32(key) ?? "");
      else value = dataSet.string(key) || "";
    }
    return { tag, name, value };
  }).filter((item) => item.value);
}
