import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestCodes } from "../../shared/dictation/coding.js";
import { parseDictation } from "../../shared/dictation/commands.js";
import { imagingContext } from "../../shared/dictation/context.js";
import { formatRadiologyReport, measurementsOf } from "../../shared/dictation/format.js";
import { scoreDictation } from "../../shared/dictation/metrics.js";
import { reviewTranscript } from "../../shared/dictation/review.js";
import { CURATED_TERMS } from "../../shared/dictation/terms.js";
import { encodeWav } from "../../shared/dictation/wav.js";
import { inspectAudio, resolveSpeechModel, transcribeAudio } from "../src/dictation/transcribe.js";

const CT_BRAIN = "CT brain plain. Mild generalized cerebral atrophy. No evidence of acute intracranial hemorrhage. Ventricular system is normal. No midline shift.";
const MRI_LUMBAR = "MRI lumbar spine. Disc bulge at L4-L5 measuring 4.5 mm. No cord compression.";
const MRI_BRAIN = "MRI brain with contrast. No acute infarction. The ventricles are normal. No midline shift.";
const CHEST = "Chest X-ray. The heart is enlarged. No pleural effusion. No pneumothorax. The costophrenic angles are clear.";
const ULTRASOUND = "Ultrasound abdomen. The liver is echogenic. No focal hepatic lesion. The gallbladder is normal.";

const saved = {
  SPEECH_BASE_URL: process.env.SPEECH_BASE_URL,
  SPEECH_API_KEY: process.env.SPEECH_API_KEY,
  SPEECH_MODEL: process.env.SPEECH_MODEL,
  SPEECH_SEND_PROMPT: process.env.SPEECH_SEND_PROMPT,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

function wavFile() {
  const bytes = Buffer.from(encodeWav(Float32Array.from([0.2, -0.2, 0.1, -0.1]), 16000));
  return { buffer: bytes, size: bytes.length, mimetype: "audio/wav", originalname: "dictation.wav" };
}

describe("imaging context", () => {
  it("selects terminology context from the study", () => {
    expect(imagingContext({ modality: "CT", description: "CT Brain" }).key).toBe("ct-brain");
    expect(imagingContext({ modality: "MR", description: "MRI Lumbar Spine" }).key).toBe("mri-lumbar");
    expect(imagingContext({ modality: "MR", description: "MRI Brain" }).key).toBe("mri-brain");
    expect(imagingContext({ modality: "DX", description: "Chest X-ray" }).key).toBe("chest-xray");
    expect(imagingContext({ modality: "US", description: "Ultrasound Abdomen" }).key).toBe("us-abdomen");
    expect(imagingContext({ modality: "MG", description: "Mammogram" }).key).toBe("mammography");
  });
});

describe("radiology formatting", () => {
  it("structures CT brain dictation without adding an impression or a new negative", () => {
    const formatted = formatRadiologyReport(CT_BRAIN, { description: "CT Brain" });
    expect(formatted.technique).toBe("Non-contrast CT examination of the brain.");
    expect(formatted.findings).toContain("Mild generalized cerebral atrophy.");
    expect(formatted.findings).toContain("No evidence of acute intracranial hemorrhage.");
    expect(formatted.findings).toContain("No midline shift.");
    expect(formatted.findings).not.toMatch(/no acute intracranial abnormality/i);
    expect(formatted.impression).toBe("");
    expect(formatted.impressionDictated).toBe(false);
    expect(formatted.invented).toBe(false);
  });

  it("keeps lumbar measurements and does not invent cord findings", () => {
    const formatted = formatRadiologyReport(MRI_LUMBAR);
    expect(formatted.technique).toBe("MRI examination of the lumbar spine.");
    expect(formatted.findings).toContain("4.5 mm");
    expect(formatted.findings).toContain("No cord compression.");
    expect(measurementsOf(formatted.findings)).toEqual(["4.5 mm"]);
  });

  it("formats MRI brain, chest radiograph, and ultrasound technique only from spoken words", () => {
    expect(formatRadiologyReport(MRI_BRAIN).technique).toBe("Contrast-enhanced MRI examination of the brain.");
    expect(formatRadiologyReport(CHEST).technique).toBe("Chest radiograph.");
    expect(formatRadiologyReport(CHEST).findings).toContain("No pleural effusion.");
    expect(formatRadiologyReport(ULTRASOUND).technique).toBe("Ultrasound examination of the abdomen.");
    expect(formatRadiologyReport(ULTRASOUND).findings).toContain("No focal hepatic lesion.");
  });

  it("removes voice commands from the report text", () => {
    const parsed = parseDictation("Mild atrophy. New paragraph. No hemorrhage. Findings colon ventricles are normal. Delete last sentence. Stop dictation.");
    expect(parsed.text.toLowerCase()).not.toContain("new paragraph");
    expect(parsed.text.toLowerCase()).not.toContain("delete last sentence");
    expect(parsed.text.toLowerCase()).not.toContain("stop dictation");
    expect(parsed.commands.map((item) => item.command)).toEqual(["paragraph", "section", "deleteLastSentence", "stop"]);
    const formatted = formatRadiologyReport("Mild atrophy. Impression colon no midline shift.");
    expect(formatted.findings).toContain("Mild atrophy.");
    expect(formatted.impression).toBe("No midline shift.");
    expect(formatted.impressionDictated).toBe(true);
  });

  it("preserves right, left, negations, and units", () => {
    const text = "There is a right pleural effusion. The left costophrenic angle is clear. A 4.5 mm nodule is present. There is no left effusion.";
    const formatted = formatRadiologyReport(text);
    expect(formatted.findings).toContain("right pleural effusion");
    expect(formatted.findings).toContain("left costophrenic angle");
    expect(formatted.findings).toContain("4.5 mm");
    expect(formatted.findings).not.toContain("4.5 cm");
  });
});

describe("medical review", () => {
  it("does not replace effusion, hypodense, or lesion-free", () => {
    const effusion = reviewTranscript("There is a pleural effusion.", CURATED_TERMS);
    expect(effusion.text).toBe("There is a pleural effusion.");
    expect(effusion.replaced).toBe(false);
    expect(effusion.verify.some((item) => item.term.toLowerCase() === "effusion" && item.alternatives.includes("infusion"))).toBe(true);

    const density = reviewTranscript("A hypodense area is seen in the right basal ganglia.", CURATED_TERMS);
    expect(density.text).toContain("hypodense");
    expect(density.text).not.toContain("hyperdense");
    expect(density.preserved.laterality).toEqual(["right"]);

    const clear = reviewTranscript("The liver is lesion-free.", CURATED_TERMS);
    expect(clear.text).toContain("lesion-free");
    expect(clear.verify.some((item) => item.term.toLowerCase() === "lesion-free")).toBe(true);
  });

  it("suggests an Indian English spelling without applying it", () => {
    const review = reviewTranscript("Mild generalised cerebral atrophy.", CURATED_TERMS);
    expect(review.text).toContain("generalised");
    expect(review.suggestions.some((item) => item.to.toLowerCase() === "generalized")).toBe(true);
  });

  it("suggests an abbreviation expansion and does not insert it", () => {
    const review = reviewTranscript("The CP angle is clear.", CURATED_TERMS);
    expect(review.text).toBe("The CP angle is clear.");
    expect(review.suggestions.some((item) => item.to === "Costophrenic angle")).toBe(true);
  });
});

describe("coding suggestions", () => {
  it("suggests a code only for an explicit, non-negated impression", () => {
    const context = imagingContext({ modality: "DX", description: "Chest X-ray" });
    const negated = suggestCodes({ impression: "No pleural effusion. No pneumothorax.", context });
    expect(negated.suggestions).toEqual([]);
    expect(negated.automaticAssignment).toBe(false);
    const approved = suggestCodes({ impression: "Cardiomegaly. No pleural effusion.", context });
    expect(approved.suggestions.map((item) => item.code)).toEqual(["I51.7"]);
    expect(approved.requiresApproval).toBe(true);
  });

  it("does not assign a lumbar disc code unless the region is explicit", () => {
    const vague = suggestCodes({ impression: "Disc bulge.", context: imagingContext({ modality: "MR", description: "MRI Spine" }) });
    expect(vague.suggestions).toEqual([]);
    const lumbar = suggestCodes({ impression: "Disc protrusion.", context: imagingContext({ modality: "MR", description: "MRI Lumbar Spine" }) });
    expect(lumbar.suggestions.map((item) => item.code)).toEqual(["M51.26"]);
    expect(lumbar.suggestions[0].caveat).toMatch(/lumbar/i);
  });
});

describe("dictation quality metrics", () => {
  it("scores medical terms, negation, laterality, and measurements separately from word error rate", () => {
    const reference = "Mild generalized cerebral atrophy. No evidence of right pleural effusion. Nodule measures 4.5 mm.";
    const close = "Mild generalised cerebral atrophy. No evidence of right pleural effusion. Nodule measures 4.5 mm.";
    const closeScore = scoreDictation(reference, close, CURATED_TERMS);
    expect(closeScore.wordErrorRate.wer).toBeGreaterThan(0);
    expect(closeScore.medicalTermAccuracy.missed).not.toContain("Cerebral atrophy");
    expect(closeScore.negationAccuracy.accuracy).toBe(1);
    expect(closeScore.lateralityAccuracy.accuracy).toBe(1);
    expect(closeScore.measurementAccuracy.accuracy).toBe(1);

    const unsafe = "Mild generalized cerebral atrophy. Evidence of left pleural effusion. Nodule measures 4.5 cm.";
    const unsafeScore = scoreDictation(reference, unsafe, CURATED_TERMS);
    expect(unsafeScore.negationAccuracy.accuracy).toBeLessThan(1);
    expect(unsafeScore.lateralityAccuracy.accuracy).toBe(0);
    expect(unsafeScore.measurementAccuracy.accuracy).toBe(0);
  });
});

describe("transcription service", () => {
  it("rejects a file that is not audio", () => {
    const text = Buffer.from("this is not audio content");
    expect(inspectAudio({ buffer: text, size: text.length, mimetype: "text/plain" })).toMatch(/audio/i);
    expect(inspectAudio(wavFile())).toBe("");
  });

  it("sends gpt-4o-mini-transcribe with a medical prompt and does not echo the transcript into the error", async () => {
    process.env.SPEECH_BASE_URL = "https://api.openai.com/v1/audio/transcriptions";
    process.env.SPEECH_API_KEY = "server-key";
    delete process.env.SPEECH_MODEL;
    expect(resolveSpeechModel()).toBe("gpt-4o-mini-transcribe");
    const fetchMock = vi.fn(async (_url, options) => {
      expect(options.headers.authorization).toBe("Bearer server-key");
      expect(options.body.get("model")).toBe("gpt-4o-mini-transcribe");
      expect(options.body.get("language")).toBe("en");
      expect(options.body.get("prompt")).toMatch(/CT brain/i);
      expect(options.body.get("prompt")).toMatch(/ventricles/i);
      return new Response(JSON.stringify({ text: CT_BRAIN }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const text = await transcribeAudio({
      bytes: wavFile().buffer,
      filename: "dictation.wav",
      mime: "audio/wav",
      language: "en-IN",
      prompt: "CT brain. Indian English radiology dictation. Ventricles, midline shift",
    });
    expect(text).toBe(CT_BRAIN);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stays unavailable until the server endpoint is configured", async () => {
    delete process.env.SPEECH_BASE_URL;
    await expect(transcribeAudio({ bytes: wavFile().buffer, filename: "a.wav", mime: "audio/wav", language: "en" })).rejects.toMatchObject({ status: 503 });
  });
});
