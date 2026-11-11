import { imagingContext } from "./context.js";
import { parseDictation } from "./commands.js";
import { formatRadiologyReport } from "./format.js";
import { reviewTranscript } from "./review.js";
import { searchVocabulary } from "./vocabulary.js";
import { suggestCodes } from "./coding.js";

export function interpretDictation(raw, options = {}) {
  const context = imagingContext(options);
  const vocabulary = searchVocabulary("", {
    context: context.key,
    extraTerms: options.vocabulary || [],
    limit: options.limit || 80,
  });
  const parsed = parseDictation(raw);
  const formatted = formatRadiologyReport(raw, { description: options.description || "" });
  const review = reviewTranscript(parsed.text, vocabulary);
  const coding = suggestCodes({
    impression: formatted.impression,
    context,
    vocabulary: options.vocabulary || [],
  });
  return {
    originalText: parsed.originalText,
    text: parsed.text,
    events: parsed.events,
    commands: parsed.commands,
    context,
    formatted,
    review,
    coding,
  };
}

export function buildSpeechPrompt(options = {}) {
  const context = imagingContext(options);
  const terms = searchVocabulary("", {
    context: context.key,
    extraTerms: options.vocabulary || [],
    limit: 28,
  }).map((item) => item.term);
  return `${context.label}. Indian English radiology dictation. ${terms.join(", ")}`.slice(0, 700);
}
