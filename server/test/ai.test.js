import { afterEach, describe, expect, it } from "vitest";
import { acceptedAnnotations, imageToScreen } from "../../client/src/imageGeometry.js";
import { modalitySupport, providerCapabilities } from "../src/ai/capabilities.js";
import { completeChat } from "../src/ai/provider.js";
import { normalizeAnalysis, normalizeDraft, plainText } from "../src/ai/response.js";

const saved = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  delete process.env.AI_TIMEOUT_MS;
});

describe("AI capabilities and response handling", () => {
  it("does not claim medical, annotation, or series support", () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const missing = providerCapabilities();
    expect(missing.configured).toBe(false);
    expect(missing.medicalDevice).toBe(false);
    expect(missing.tasks.annotations).toBe(false);
    expect(missing.tasks.analyzeSeries).toBe(false);
    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "general-vision";
    const ready = providerCapabilities();
    expect(ready.configured).toBe(true);
    expect(ready.tasks.analyzeImage).toBe(true);
    expect(ready.tasks.annotations).toBe(false);
    expect(ready.tasks.dicomNative).toBe(false);
    expect(modalitySupport("CT").supported).toBe(true);
    expect(modalitySupport("OT").supported).toBe(false);
  });

  it("strips markup and discards coordinates from a general model", () => {
    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    const normalized = normalizeAnalysis({
      status: "completed",
      findings: [{
        title: "<script>alert(1)</script>Density",
        description: "A dense area is visible.",
        box: { x: 1, y: 1, width: 8, height: 8 },
        confidence: 0.99,
      }],
    }, { frame: 2, instanceId: "image-1" });
    expect(normalized.status).toBe("review_recommended");
    expect(normalized.findings[0].title).not.toContain("<");
    expect(normalized.findings[0].box).toBeNull();
    expect(normalized.findings[0].confidence).toBeUndefined();
    expect(normalized.annotationsSupported).toBe(false);
    expect(plainText("<b>Keep</b>")).toBe("Keep");
    const nested = normalizeDraft({ draft: { impression: "Review the selected image.", findings: ["A dense area is visible."] } });
    expect(nested.impression).toContain("Review");
    expect(nested.findings).toContain("dense");
  });

  it("keeps only boxes inside the image when annotations are actually supported", () => {
    const findings = [
      { title: "Inside", decision: "pending", box: { x: 2, y: 3, width: 4, height: 5, frame: 1, instanceId: "a" } },
      { title: "Outside", decision: "pending", box: { x: 60, y: 1, width: 10, height: 10 } },
      { title: "Rejected", decision: "rejected", box: { x: 1, y: 1, width: 2, height: 2 } },
    ];
    expect(acceptedAnnotations(findings, { columns: 64, rows: 64, annotationsSupported: false })).toEqual([]);
    const boxes = acceptedAnnotations(findings, { columns: 64, rows: 64, annotationsSupported: true });
    expect(boxes).toHaveLength(1);
    expect(boxes[0].instanceId).toBe("a");
    expect(boxes[0].frame).toBe(1);
  });

  it("moves a box corner with zoom without changing its image coordinates", () => {
    const source = { width: 100, height: 100 };
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false };
    const [x, y] = imageToScreen({ x: 50, y: 50 }, source, view, 200, 200);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(100);
    const zoomed = imageToScreen({ x: 0, y: 0 }, source, view, 200, 200);
    const fitted = imageToScreen({ x: 0, y: 0 }, source, { ...view, zoom: 1 }, 200, 200);
    expect(zoomed[0]).toBeLessThan(fitted[0]);
  });

  it("reports a timeout and an invalid model response", async () => {
    process.env.AI_BASE_URL = "https://ai.test/chat";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_TIMEOUT_MS = "1000";
    await expect(completeChat({
      messages: [],
      env: process.env,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    })).rejects.toMatchObject({ status: 504 });

    await expect(completeChat({
      messages: [],
      env: process.env,
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }),
    })).rejects.toThrow(/JSON/);
  });
});
