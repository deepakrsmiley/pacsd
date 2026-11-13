import mongoose from "mongoose";

const { Schema } = mongoose;

const Organization = mongoose.model(
  "Organization",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      legalName: { type: String, default: "", trim: true },
      timezone: { type: String, default: "Asia/Kolkata" },
      locale: { type: String, default: "en-IN" },
      supportEmail: { type: String, default: "" },
      status: { type: String, enum: ["active", "suspended"], default: "active" },
    },
    { timestamps: true },
  ),
);

const Facility = mongoose.model(
  "Facility",
  new Schema(
    {
      organizationId: { type: Schema.Types.ObjectId, ref: "Organization", index: true },
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, unique: true, uppercase: true, trim: true },
      active: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);

const User = mongoose.model(
  "User",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      role: {
        type: String,
        required: true,
        enum: ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"],
      },
      facilityIds: [{ type: Schema.Types.ObjectId, ref: "Facility" }],
      active: { type: Boolean, default: true },
      tokenVersion: { type: Number, default: 0 },
      mustChangePassword: { type: Boolean, default: false },
      failedLoginCount: { type: Number, default: 0 },
      lockedUntil: { type: Date },
      qualifications: { type: String, default: "", trim: true },
      registrationNumber: { type: String, default: "", trim: true },
      signatureImage: { type: String, default: "" },
      signatureMethods: {
        type: [{
          id: { type: String, required: true },
          label: { type: String, required: true, trim: true },
          designation: { type: String, default: "", trim: true },
          qualifications: { type: String, default: "", trim: true },
          registrationNumber: { type: String, default: "", trim: true },
          style: { type: String, enum: ["typed", "image", "drawn"], default: "typed" },
          signatureImage: { type: String, default: "" },
          isDefault: { type: Boolean, default: false },
        }],
        default: [],
      },
    },
    { timestamps: true },
  ),
);

const patientSchema = new Schema(
  {
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
    name: { type: String, required: true, trim: true },
    mrn: { type: String, required: true, trim: true },
    birthDate: { type: String, default: "" },
    sex: { type: String, enum: ["F", "M", "O", "U"], default: "U" },
    phone: { type: String, default: "" },
    email: { type: String, default: "", trim: true },
    countryCode: { type: String, default: "+91", trim: true },
    reportingConsent: { type: Boolean, default: false },
    reportingConsentAt: { type: Date },
    synthetic: { type: Boolean, default: false },
  },
  { timestamps: true },
);
patientSchema.index({ facilityId: 1, mrn: 1 }, { unique: true });
const Patient = mongoose.model("Patient", patientSchema);

const studySchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
    readingFacilityId: { type: Schema.Types.ObjectId, ref: "Facility" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    accession: { type: String, required: true, trim: true },
    studyUid: { type: String, required: true, unique: true },
    aliases: [{ type: String }],
    modality: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, default: "" },
    studyDate: { type: String, default: "" },
    patientAge: { type: String, default: "" },
    status: {
      type: String,
      enum: ["booked", "acquired", "reporting", "preliminary", "finalized"],
      default: "booked",
      index: true,
    },
    priority: { type: String, enum: ["routine", "urgent", "stat"], default: "routine" },
    acquiredAt: { type: Date },
    // Ingest/transfer lifecycle (separate from clinical status above).
    transferPhase: {
      type: String,
      enum: ["waiting", "receiving", "finalizing", "verifying", "processing", "indexing", "completed", "failed", "interrupted", "incomplete"],
      default: "completed",
      index: true,
    },
    orthancStudyId: { type: String, default: "", index: true },
    receivedInstances: { type: Number, default: 0 },
    expectedInstances: { type: Number, default: null },
    receivedBytes: { type: Number, default: 0 },
    transferStartedAt: { type: Date },
    transferCompletedAt: { type: Date },
    lastInstanceAt: { type: Date },
    transferError: { type: String, default: "" },
  },
  { timestamps: true },
);
studySchema.index({ facilityId: 1, accession: 1 }, { unique: true });
studySchema.index({ facilityId: 1, transferPhase: 1, updatedAt: -1 });
studySchema.index({ facilityId: 1, updatedAt: -1 });
const Study = mongoose.model("Study", studySchema);

const Series = mongoose.model(
  "Series",
  new Schema(
    {
      studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
      seriesUid: { type: String, required: true, unique: true },
      seriesNumber: { type: Number, default: 1 },
      modality: { type: String, default: "" },
      description: { type: String, default: "" },
    },
    { timestamps: true },
  ),
);

const Instance = mongoose.model(
  "Instance",
  new Schema(
    {
      seriesId: { type: Schema.Types.ObjectId, ref: "Series", required: true, index: true },
      studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
      sopUid: { type: String, required: true, unique: true },
      transferSyntax: { type: String, default: "" },
      rows: { type: Number, default: 0 },
      columns: { type: Number, default: 0 },
      bitsAllocated: { type: Number, default: 0 },
      bitsStored: { type: Number, default: 0 },
      pixelRepresentation: { type: Number, default: 0 },
      photometric: { type: String, default: "" },
      samplesPerPixel: { type: Number, default: 1 },
      pixelSpacing: { type: [Number], default: undefined },
      imagerPixelSpacing: { type: [Number], default: undefined },
      windowCenter: { type: Number },
      windowWidth: { type: Number },
      slope: { type: Number, default: 1 },
      intercept: { type: Number, default: 0 },
      filePath: { type: String, required: true },
      orthancId: { type: String, default: "", index: true },
      byteLength: { type: Number, default: 0 },
      instanceNumber: { type: Number, default: 0 },
      numberOfFrames: { type: Number, default: 1 },
      sliceThickness: { type: Number },
      spacingBetweenSlices: { type: Number },
      imagePositionPatient: { type: [Number], default: undefined },
      imageOrientationPatient: { type: [Number], default: undefined },
      frameOfReferenceUid: { type: String, default: "" },
      sliceLocation: { type: Number },
      sopClassUid: { type: String, default: "" },
      manufacturer: { type: String, default: "" },
      institution: { type: String, default: "" },
      geometryReady: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);

const reportSchema = new Schema(
  {
    studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
    clinical: { type: String, default: "" },
    indication: { type: String, default: "" },
    technique: { type: String, default: "" },
    comparison: { type: String, default: "" },
    findings: { type: String, default: "" },
    impression: { type: String, default: "" },
    recommendations: { type: String, default: "" },
    coding: {
      type: [
        {
          system: { type: String, default: "" },
          code: { type: String, default: "" },
          description: { type: String, default: "" },
          confidence: { type: Number, default: null },
          sourceText: { type: String, default: "" },
          caveat: { type: String, default: "" },
          manual: { type: Boolean, default: false },
          approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
          approvedAt: { type: Date },
        },
      ],
      default: [],
    },
    status: { type: String, enum: ["draft", "preliminary", "final"], default: "draft" },
    workflow: { type: String, enum: ["draft", "in_progress", "pending_signature", "finalized", "amended"], default: "draft" },
    signatureRecord: { type: Schema.Types.Mixed, default: null },
    version: { type: Number, default: 1 },
    priorReportId: { type: Schema.Types.ObjectId, ref: "Report" },
    authorId: { type: Schema.Types.ObjectId, ref: "User" },
    signedBy: { type: Schema.Types.ObjectId, ref: "User" },
    signedAt: { type: Date },
    // Word-style document. `doc` is Tiptap JSON; the text fields above are derived from it.
    doc: { type: Schema.Types.Mixed, default: null },
    docFormat: { type: String, default: "" },
    layout: { type: Schema.Types.Mixed, default: null },
    templateId: { type: Schema.Types.ObjectId, ref: "Template" },
    revision: { type: Number, default: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastSnapshotAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);
reportSchema.index({ studyId: 1, version: 1 }, { unique: true });
const Report = mongoose.model("Report", reportSchema);

const reportRevisionSchema = new Schema(
  {
    reportId: { type: Schema.Types.ObjectId, ref: "Report", required: true, index: true },
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true },
    revision: { type: Number, required: true },
    reason: { type: String, enum: ["autosave", "manual", "sign", "restore", "template"], default: "manual" },
    status: { type: String, default: "draft" },
    doc: { type: Schema.Types.Mixed, default: null },
    layout: { type: Schema.Types.Mixed, default: null },
    words: { type: Number, default: 0 },
    savedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
reportRevisionSchema.index({ reportId: 1, createdAt: -1 });
const ReportRevision = mongoose.model("ReportRevision", reportRevisionSchema);

// Rendered copies of a signed report, attached to its patient and study.
const ReportArtifact = mongoose.model(
  "ReportArtifact",
  new Schema(
    {
      reportId: { type: Schema.Types.ObjectId, ref: "Report", required: true, index: true },
      studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
      patientId: { type: Schema.Types.ObjectId, ref: "Patient", index: true },
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true },
      accession: { type: String, default: "" },
      mrn: { type: String, default: "" },
      kind: { type: String, enum: ["pdf", "docx"], required: true },
      status: { type: String, default: "final" },
      reportVersion: { type: Number, default: 1 },
      revision: { type: Number, default: 0 },
      fileName: { type: String, default: "" },
      contentType: { type: String, default: "" },
      bytes: { type: Buffer, required: true },
      size: { type: Number, default: 0 },
      sha256: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

const Template = mongoose.model(
  "Template",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      modality: { type: String, default: "", uppercase: true, trim: true },
      description: { type: String, default: "" },
      keywords: { type: [String], default: [] },
      technique: { type: String, default: "" },
      findings: { type: String, default: "" },
      impression: { type: String, default: "" },
      doc: { type: Schema.Types.Mixed, default: null },
      layout: { type: Schema.Types.Mixed, default: null },
      isDefault: { type: Boolean, default: false },
      builtin: { type: Boolean, default: false },
      personal: { type: Boolean, default: false },
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true, minimize: false },
  ),
);

const Share = mongoose.model(
  "Share",
  new Schema(
    {
      reportId: { type: Schema.Types.ObjectId, ref: "Report", required: true, index: true },
      tokenHash: { type: String, required: true, unique: true },
      channel: { type: String, enum: ["link", "email", "whatsapp", "facebook"], required: true },
      recipient: { type: String, default: "" },
      expiresAt: { type: Date, required: true },
      revoked: { type: Boolean, default: false },
      delivery: { type: String, enum: ["stored", "sent", "failed", "not_sent"], default: "stored" },
      deliveryDetail: { type: String, default: "" },
      subject: { type: String, default: "" },
      message: { type: String, default: "" },
      consent: { type: Boolean, default: false },
      attachmentSent: { type: Boolean, default: false },
      providerId: { type: String, default: "" },
      fallback: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
);

const ReportShortcut = mongoose.model(
  "ReportShortcut",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      trigger: { type: String, required: true, trim: true, lowercase: true },
      expansion: { type: String, required: true, trim: true },
      favourite: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);

const DicomNode = mongoose.model(
  "DicomNode",
  new Schema(
    {
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
      name: { type: String, required: true, trim: true },
      aeTitle: { type: String, required: true, uppercase: true, trim: true },
      host: { type: String, required: true, trim: true },
      port: { type: Number, required: true },
      modality: { type: String, default: "", uppercase: true, trim: true },
      enabled: { type: Boolean, default: true },
      lastEchoAt: { type: Date },
      lastEchoOk: { type: Boolean, default: false },
      lastEchoError: { type: String, default: "" },
      lastTransferAt: { type: Date },
    },
    { timestamps: true },
  ),
);

const TransferJob = mongoose.model(
  "TransferJob",
  new Schema(
    {
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility", index: true },
      direction: { type: String, enum: ["inbound"], default: "inbound" },
      source: { type: String, default: "upload" },
      fileName: { type: String, default: "" },
      sopUid: { type: String, default: "" },
      studyUid: { type: String, default: "" },
      accession: { type: String, default: "" },
      modality: { type: String, default: "" },
      status: { type: String, enum: ["stored", "duplicate", "rejected"], required: true, index: true },
      instanceId: { type: Schema.Types.ObjectId, ref: "Instance" },
      bytes: { type: Number, default: 0 },
      durationMs: { type: Number, default: 0 },
      error: { type: String, default: "" },
    },
    { timestamps: true },
  ),
);

const OrthancCursor = mongoose.model(
  "OrthancCursor",
  new Schema(
    {
      key: { type: String, required: true, unique: true },
      lastSeq: { type: Number, default: 0 },
    },
    { timestamps: true },
  ),
);

const BackupJob = mongoose.model(
  "BackupJob",
  new Schema(
    {
      organizationId: { type: Schema.Types.ObjectId, ref: "Organization" },
      status: { type: String, enum: ["copied", "failed"], required: true },
      restoreTested: { type: Boolean, default: false },
      bytes: { type: Number, default: 0 },
      fileCount: { type: Number, default: 0 },
      location: { type: String, default: "" },
      digest: { type: String, default: "" },
      error: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
);

const AuditLog = mongoose.model(
  "AuditLog",
  new Schema(
    {
      actorId: { type: Schema.Types.ObjectId, ref: "User" },
      actorEmail: { type: String, default: "" },
      action: { type: String, required: true, index: true },
      entity: { type: String, default: "" },
      entityId: { type: String, default: "" },
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility" },
      ip: { type: String, default: "" },
      meta: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

const viewerAnnotationSchema = new Schema(
  {
    studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
    seriesId: { type: Schema.Types.ObjectId, ref: "Series", required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
    format: { type: String, enum: ["application-json"], default: "application-json" },
    standard: { type: String, enum: ["application"], default: "application" },
    dicomSr: { type: Boolean, default: false },
    annotations: { type: [Schema.Types.Mixed], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
viewerAnnotationSchema.index({ studyId: 1, seriesId: 1 }, { unique: true });
const ViewerAnnotation = mongoose.model("ViewerAnnotation", viewerAnnotationSchema);

const ViewerPreference = mongoose.model(
  "ViewerPreference",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
      layout: { type: String, default: "1" },
      hiddenTools: { type: [String], default: [] },
      shortcuts: { type: Schema.Types.Mixed, default: {} },
      windowPresets: { type: [Schema.Types.Mixed], default: [] },
      volumePresets: { type: [Schema.Types.Mixed], default: [] },
      volume: { type: Schema.Types.Mixed, default: {} },
      panelLeft: { type: Number, default: 280 },
      panelRight: { type: Number, default: 300 },
    },
    { timestamps: true },
  ),
);

const medicalTermSchema = new Schema(
  {
    facilityId: { type: Schema.Types.ObjectId, ref: "Facility", default: null, index: true },
    term: { type: String, required: true, trim: true },
    spoken: { type: [String], default: [] },
    category: {
      type: String,
      enum: ["anatomy", "organ", "bone", "muscle", "vessel", "finding", "disease", "clinical", "imaging", "abbreviation", "phrase"],
      default: "clinical",
    },
    modalities: { type: [String], default: [] },
    bodyParts: { type: [String], default: [] },
    contexts: { type: [String], default: [] },
    abbreviation: { type: String, default: "" },
    source: { type: String, enum: ["custom", "radlex", "snomed", "icd10", "loinc"], default: "custom" },
    code: { type: String, default: "" },
    codeSystem: { type: String, default: "" },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
medicalTermSchema.index({ facilityId: 1, term: 1 });
const MedicalTerm = mongoose.model("MedicalTerm", medicalTermSchema);

const DictationTurn = mongoose.model(
  "DictationTurn",
  new Schema(
    {
      reportId: { type: Schema.Types.ObjectId, ref: "Report", required: true, index: true },
      studyId: { type: Schema.Types.ObjectId, ref: "Study" },
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
      authorId: { type: Schema.Types.ObjectId, ref: "User" },
      language: { type: String, default: "" },
      model: { type: String, default: "" },
      contextKey: { type: String, default: "" },
      originalText: { type: String, default: "" },
      text: { type: String, default: "" },
    },
    { timestamps: true },
  ),
);

const AiAnalysis = mongoose.model(
  "AiAnalysis",
  new Schema(
    {
      facilityId: { type: Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
      studyId: { type: Schema.Types.ObjectId, ref: "Study", required: true, index: true },
      seriesId: { type: Schema.Types.ObjectId, ref: "Series" },
      instanceId: { type: Schema.Types.ObjectId, ref: "Instance" },
      frame: { type: Number, default: 0 },
      rows: { type: Number, default: 0 },
      columns: { type: Number, default: 0 },
      provider: { type: String, default: "" },
      model: { type: String, default: "" },
      task: { type: String, default: "analyze-image" },
      status: {
        type: String,
        enum: ["completed", "review_recommended", "insufficient_quality", "unsupported", "failed"],
        default: "review_recommended",
      },
      findings: { type: [Schema.Types.Mixed], default: [] },
      limitations: { type: [String], default: [] },
      draft: { type: Schema.Types.Mixed, default: {} },
      acceptedSections: { type: [Schema.Types.Mixed], default: [] },
      imagesAnalyzed: { type: [Schema.Types.Mixed], default: [] },
      annotationsSupported: { type: Boolean, default: false },
      error: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
);

export {
  Organization,
  Facility,
  User,
  Patient,
  Study,
  Series,
  Instance,
  Report,
  ReportRevision,
  ReportArtifact,
  Template,
  Share,
  ReportShortcut,
  AuditLog,
  DicomNode,
  TransferJob,
  BackupJob,
  OrthancCursor,
  AiAnalysis,
  ViewerAnnotation,
  ViewerPreference,
  MedicalTerm,
  DictationTurn,
};
