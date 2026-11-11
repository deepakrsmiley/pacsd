import { z } from "zod";
import { AiAnalysis, Instance, Report, Series, Study } from "../models.js";
import { canAccessFacility } from "../permissions.js";
import { modalitySupport, providerCapabilities } from "./capabilities.js";
import { loadAnalysisImage } from "./images.js";
import { analysisMessages, completeChat, draftMessages } from "./provider.js";
import { draftFromFindings, mergeDraft, normalizeAnalysis, normalizeDraft, plainText } from "./response.js";

const recent = new Map();

const WRITING_RULES = [
  "You assist a qualified radiologist who is editing a radiology report. You are not a medical device and you do not make diagnoses.",
  "Use only the text supplied. Never add findings, measurements, laterality, history, comparisons, or normal statements that are not in the input.",
  "Preserve every measurement, number, unit, side (left/right), negation, and uncertainty word exactly.",
  "Your output is a suggestion that the radiologist will review. Return a JSON object only.",
].join(" ");

const WRITING_TASKS = {
  grammar: {
    needs: ["text"],
    missing: "Select the text to correct first.",
    instruction: "Correct grammar, spelling, and punctuation only. Keep the wording otherwise unchanged. Return {\"text\": corrected text}.",
  },
  rewrite: {
    needs: ["text"],
    missing: "Select the text to rewrite first.",
    instruction: "Rewrite the text for clarity and concision in a standard radiology reporting style without changing its meaning. Return {\"text\": rewritten text}.",
  },
  professional: {
    needs: ["text"],
    missing: "Select the text to reword first.",
    instruction: "Suggest professional radiology wording for the text, using standard terminology where the meaning is unambiguous. Return {\"text\": suggested wording}.",
  },
  summarize: {
    needs: ["findings"],
    missing: "The FINDINGS section is empty.",
    instruction: "Summarize the findings as short bullet lines, one finding per line, most significant first. Return {\"text\": lines separated by newlines}.",
  },
  impression: {
    needs: ["findings"],
    optional: ["clinical"],
    missing: "Type and review the FINDINGS section before drafting an impression.",
    instruction: "Draft an impression from the radiologist-reviewed findings. Use a numbered list, most significant first. Use hedged language when the findings are non-specific. Do not state a definitive diagnosis that the findings do not support. Return {\"text\": impression}.",
  },
  recommendations: {
    needs: ["findings"],
    optional: ["impression", "clinical"],
    missing: "Type the FINDINGS section before asking for recommendations.",
    instruction: "Suggest follow-up recommendations only where the stated findings justify them. If none are justified, say that no specific follow-up is suggested from the stated findings. Return {\"text\": recommendations}.",
  },
  consistency: {
    needs: ["findings", "impression"],
    missing: "Both FINDINGS and IMPRESSION need text before they can be compared.",
    instruction: "Compare the findings with the impression. Report impression statements not supported by the findings, significant findings missing from the impression, and mismatched laterality, measurements, or negations. Return {\"issues\": [{\"severity\": \"high\"|\"medium\"|\"low\", \"description\": string, \"findingsExcerpt\": string, \"impressionExcerpt\": string}], \"summary\": string}. Return an empty issues array when they agree.",
  },
};

function allowRequest(userId) {
  const now = Date.now();
  const stamps = (recent.get(userId) || []).filter((stamp) => now - stamp < 10 * 60 * 1000);
  if (stamps.length >= 8) return false;
  stamps.push(now);
  recent.set(userId, stamps);
  return true;
}

export function resetAiRateLimit() {
  recent.clear();
}

export function registerAi(app, { requireUser, requirePermission, wrap, audit, loadReadableStudy }) {
  app.get("/api/ai/capabilities", requireUser, requirePermission("ai.use"), wrap(async (_req, res) => {
    res.json({ capabilities: providerCapabilities() });
  }));

  app.get("/api/ai/analyses", requireUser, requirePermission("ai.use"), wrap(async (req, res) => {
    const studyId = String(req.query.studyId || "");
    if (!studyId) return res.json({ analyses: [] });
    const study = await loadReadableStudy(req, studyId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const analyses = await AiAnalysis.find({ studyId: study._id }).sort({ createdAt: -1 }).limit(20);
    res.json({ analyses });
  }));

  app.post("/api/ai/analyses", requireUser, requirePermission("ai.use"), wrap(async (req, res) => {
    if (!allowRequest(String(req.user._id))) return res.status(429).json({ error: "Too many AI requests. Wait a few minutes and try again." });
    const body = z.object({
      studyId: z.string().min(1),
      instanceId: z.string().min(1),
      frame: z.number().int().min(0).max(5000).optional(),
    }).parse(req.body);
    const study = await loadReadableStudy(req, body.studyId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const instance = await Instance.findById(body.instanceId);
    if (!instance || String(instance.studyId) !== String(study._id)) return res.status(404).json({ error: "Image not found" });
    const support = modalitySupport(study.modality);
    const frame = body.frame || 0;
    const base = {
      facilityId: study.facilityId,
      studyId: study._id,
      seriesId: instance.seriesId,
      instanceId: instance._id,
      frame,
      rows: instance.rows || 0,
      columns: instance.columns || 0,
      provider: providerCapabilities().provider,
      model: providerCapabilities().model,
      task: "analyze-image",
      annotationsSupported: false,
      imagesAnalyzed: [{ instanceId: String(instance._id), frame, preview: Boolean(instance.orthancId) }],
      createdBy: req.user._id,
    };
    if (!support.supported) {
      const analysis = await AiAnalysis.create({ ...base, status: "unsupported", error: support.reason, limitations: [support.reason] });
      await audit(req, "ai.analyze", "ai-analysis", analysis._id, study.facilityId, { status: "unsupported", instanceId: String(instance._id), frame });
      return res.status(201).json({ analysis });
    }
    if (!providerCapabilities().configured) {
      return res.status(503).json({ error: "AI is not configured. Set AI_BASE_URL and AI_API_KEY on the server." });
    }
    const image = await loadAnalysisImage(instance);
    if (!image.ok) {
      const analysis = await AiAnalysis.create({
        ...base,
        status: image.status === "failed" ? "failed" : "insufficient_quality",
        error: image.message,
        limitations: providerCapabilities().limitations,
      });
      await audit(req, "ai.analyze", "ai-analysis", analysis._id, study.facilityId, { status: analysis.status, instanceId: String(instance._id), frame });
      return res.status(201).json({ analysis });
    }
    const series = instance.seriesId ? await Series.findById(instance.seriesId).select("description modality") : null;
    const cancel = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) cancel.abort();
    });
    try {
      const payload = await completeChat({
        signal: cancel.signal,
        messages: analysisMessages({
          modality: study.modality,
          description: series?.description || study.description || "",
          rows: instance.rows || 0,
          columns: instance.columns || 0,
          frame,
          image: { base64: image.bytes.toString("base64"), mediaType: image.mediaType },
        }),
      });
      const normalized = normalizeAnalysis(payload, { frame, instanceId: String(instance._id) });
      const analysis = await AiAnalysis.create({ ...base, ...normalized, error: "" });
      await audit(req, "ai.analyze", "ai-analysis", analysis._id, study.facilityId, {
        status: analysis.status,
        instanceId: String(instance._id),
        frame,
        findingCount: analysis.findings.length,
      });
      res.status(201).json({ analysis });
    } catch (error) {
      const analysis = await AiAnalysis.create({
        ...base,
        status: "failed",
        error: plainText(error.message, 500),
        limitations: providerCapabilities().limitations,
      });
      await audit(req, "ai.analyze", "ai-analysis", analysis._id, study.facilityId, { status: "failed", instanceId: String(instance._id), frame });
      res.status(201).json({ analysis });
    }
  }));

  app.post("/api/ai/analyses/:id/findings/:index", requireUser, requirePermission("ai.use"), wrap(async (req, res) => {
    const analysis = await loadOwnedAnalysis(req, req.params.id);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    const index = Number(req.params.index);
    const finding = analysis.findings[index];
    if (!finding) return res.status(404).json({ error: "Finding not found" });
    const body = z.object({
      decision: z.enum(["pending", "accepted", "rejected"]).optional(),
      description: z.string().max(2000).optional(),
      hidden: z.boolean().optional(),
    }).parse(req.body);
    if (body.decision) finding.decision = body.decision;
    if (body.description !== undefined) finding.description = plainText(body.description, 2000);
    if (body.hidden !== undefined) finding.hidden = body.hidden;
    finding.reviewedBy = req.user._id;
    finding.reviewedAt = new Date();
    analysis.markModified("findings");
    await analysis.save();
    await audit(req, "ai.review", "ai-analysis", analysis._id, analysis.facilityId, { index, decision: finding.decision });
    res.json({ analysis });
  }));

  app.post("/api/ai/analyses/:id/draft", requireUser, requirePermission("ai.use"), wrap(async (req, res) => {
    const analysis = await loadOwnedAnalysis(req, req.params.id);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    if (!providerCapabilities().configured) return res.status(503).json({ error: "AI is not configured." });
    const study = await Study.findById(analysis.studyId).select("modality description");
    const body = z.object({ clinical: z.string().max(8000).optional() }).parse(req.body || {});
    const accepted = analysis.findings.filter((item) => item.decision !== "rejected").map((item) => ({
      title: item.title,
      location: item.location,
      description: item.description,
      evidence: item.evidence,
      followUp: item.followUp,
    }));
    const cancel = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) cancel.abort();
    });
    try {
      const payload = await completeChat({
        signal: cancel.signal,
        messages: draftMessages({
          modality: study?.modality || "",
          description: study?.description || "",
          clinical: plainText(body.clinical, 8000),
          findings: accepted,
        }),
      });
      analysis.draft = mergeDraft(normalizeDraft(payload), draftFromFindings(accepted, {
        modality: study?.modality || "",
        description: study?.description || "",
        clinical: plainText(body.clinical, 8000),
      }));
      analysis.task = "draft";
      analysis.markModified("draft");
      await analysis.save();
      await audit(req, "ai.draft", "ai-analysis", analysis._id, analysis.facilityId, { sections: Object.keys(analysis.draft) });
      res.json({ analysis });
    } catch (error) {
      res.status(error.status || 502).json({ error: plainText(error.message, 500) });
    }
  }));

  app.post("/api/reports/:id/ai", requireUser, requirePermission("report.write"), requirePermission("ai.use"), wrap(async (req, res) => {
    const body = z.object({
      task: z.enum(Object.keys(WRITING_TASKS)),
      text: z.string().max(20000).optional(),
      findings: z.string().max(20000).optional(),
      impression: z.string().max(8000).optional(),
      clinical: z.string().max(8000).optional(),
    }).parse(req.body);
    const report = await Report.findById(req.params.id);
    if (!report || !canAccessFacility(req.user, report.facilityId)) return res.status(404).json({ error: "Report not found" });
    if (!providerCapabilities().configured) return res.status(503).json({ error: "AI is not configured. Set AI_BASE_URL and AI_API_KEY on the server." });
    const task = WRITING_TASKS[body.task];
    const source = {
      text: plainText(body.text, 20000),
      findings: plainText(body.findings ?? report.findings, 20000),
      impression: plainText(body.impression ?? report.impression, 8000),
      clinical: plainText(body.clinical ?? report.clinical, 8000),
    };
    const missing = task.needs.filter((key) => !source[key]);
    if (missing.length) return res.status(400).json({ error: task.missing });
    if (!allowRequest(String(req.user._id))) return res.status(429).json({ error: "Too many AI requests. Wait a few minutes and try again." });
    const study = await Study.findById(report.studyId).select("modality description");
    const cancel = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) cancel.abort();
    });
    try {
      const payload = await completeChat({
        signal: cancel.signal,
        messages: [
          { role: "system", content: `${WRITING_RULES} ${task.instruction}` },
          {
            role: "user",
            content: JSON.stringify({
              modality: study?.modality || "",
              studyDescription: study?.description || "",
              ...Object.fromEntries(task.needs.concat(task.optional || []).map((key) => [key, source[key]])),
            }),
          },
        ],
      });
      const result = {
        task: body.task,
        text: plainText(payload?.text ?? payload?.result ?? "", 20000),
        issues: Array.isArray(payload?.issues) ? payload.issues.slice(0, 20).map((issue) => ({
          severity: ["high", "medium", "low"].includes(issue?.severity) ? issue.severity : "medium",
          description: plainText(issue?.description, 1000),
          findingsExcerpt: plainText(issue?.findingsExcerpt, 400),
          impressionExcerpt: plainText(issue?.impressionExcerpt, 400),
        })).filter((issue) => issue.description) : [],
        summary: plainText(payload?.summary, 2000),
        applied: false,
      };
      if (!result.text && !result.issues.length && !result.summary) return res.status(502).json({ error: "The AI provider returned an empty answer." });
      await audit(req, "report.ai", "report", report._id, report.facilityId, { task: body.task, model: providerCapabilities().model });
      res.json({ result });
    } catch (error) {
      res.status(error.status || 502).json({ error: plainText(error.message, 500) });
    }
  }));

  app.post("/api/ai/analyses/:id/sections", requireUser, requirePermission("report.write"), wrap(async (req, res) => {
    const analysis = await loadOwnedAnalysis(req, req.params.id);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    const body = z.object({
      sections: z.array(z.enum(["clinical", "technique", "comparison", "findings", "impression", "recommendations"])).min(1),
    }).parse(req.body);
    const at = new Date();
    analysis.acceptedSections = [
      ...(analysis.acceptedSections || []),
      ...body.sections.map((section) => ({ section, userId: req.user._id, at })),
    ];
    await analysis.save();
    await audit(req, "ai.accept", "ai-analysis", analysis._id, analysis.facilityId, { sections: body.sections });
    res.json({ analysis });
  }));
}

async function loadOwnedAnalysis(req, id) {
  const analysis = await AiAnalysis.findById(id);
  if (!analysis || !canAccessFacility(req.user, analysis.facilityId)) return null;
  return analysis;
}
