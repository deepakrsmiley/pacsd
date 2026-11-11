export const ROLES = [
  "system_admin",
  "facility_admin",
  "radiologist",
  "technologist",
  "referring_physician",
];

const MATRIX = {
  system_admin: ["*"],
  facility_admin: [
    "facility.read",
    "facility.write",
    "user.read",
    "user.write",
    "patient.read",
    "study.read",
    "report.read",
    "report.share",
    "audit.read",
    "dashboard.read",
    "template.read",
    "template.write",
    "vocabulary.read",
    "vocabulary.write",
    "dictation.read",
    "dicom.read",
    "dicom.node",
    "archive.read",
    "org.read",
    "transfer.read",
  ],
  radiologist: [
    "facility.read",
    "patient.read",
    "study.read",
    "study.assign",
    "report.read",
    "report.write",
    "report.sign",
    "report.share",
    "dicom.read",
    "dashboard.read",
    "template.read",
    "template.write",
    "vocabulary.read",
    "dictation.read",
    "ai.use",
  ],
  technologist: [
    "facility.read",
    "patient.read",
    "patient.write",
    "study.read",
    "study.write",
    "dicom.read",
    "dicom.write",
    "transfer.read",
    "dashboard.read",
  ],
  referring_physician: ["facility.read", "patient.read", "study.read", "report.read", "dashboard.read"],
};

export function can(user, permission) {
  if (!user?.active) return false;
  const list = MATRIX[user.role] || [];
  return list.includes("*") || list.includes(permission);
}

export function facilityIdsOf(user) {
  return (user?.facilityIds || []).map((id) => String(id));
}

export function canAccessFacility(user, facilityId) {
  if (!user?.active || !facilityId) return false;
  if (user.role === "system_admin") return true;
  return facilityIdsOf(user).includes(String(facilityId));
}
