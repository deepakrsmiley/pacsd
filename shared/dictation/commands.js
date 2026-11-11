const SECTION_ALIASES = [
  ["clinical history", "clinical"],
  ["clinical indication", "clinical"],
  ["indication", "clinical"],
  ["clinical", "clinical"],
  ["technique", "technique"],
  ["comparison", "comparison"],
  ["findings", "findings"],
  ["impression", "impression"],
  ["recommendations", "recommendations"],
  ["recommendation", "recommendations"],
];

const SECTION_PATTERN = SECTION_ALIASES.map(([label]) => label).sort((a, b) => b.length - a.length).join("|");

const INLINE_COMMANDS = [
  ["delete last sentence", "deleteLastSentence"],
  ["stop dictation", "stop"],
  ["resume dictation", "resume"],
  ["new paragraph", "paragraph"],
  ["new line", "paragraph"],
  ["next section", "nextSection"],
];

function sectionKey(label) {
  const found = SECTION_ALIASES.find(([name]) => name === String(label || "").toLowerCase());
  return found ? found[1] : "";
}

function applyPunctuation(value) {
  let text = ` ${String(value || "").replace(/\s+/g, " ").trim()} `;
  const rules = [
    [/\s+full stop\b/gi, "."],
    [/\s+comma\b(?!\s+(?:shaped|like)\b)/gi, ","],
    [/\s+semicolon\b/gi, ";"],
    [/\s+question mark\b/gi, "?"],
    [/\s+exclamation mark\b/gi, "!"],
    [/\s+open quote\b/gi, "“"],
    [/\s+close quote\b/gi, "”"],
    [/\s+colon\b/gi, ":"],
  ];
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  return text.replace(/\s+([,.;:?!])/g, "$1").replace(/([.?!])(?=[A-Za-z])/g, "$1 ").replace(/\s+/g, " ").trim();
}

function pushText(events, value) {
  const text = applyPunctuation(value);
  if (text) events.push({ type: "text", value: text });
}

export function parseDictation(raw) {
  const originalText = String(raw || "").replace(/\s+/g, " ").trim();
  const events = [];
  if (!originalText) {
    return { originalText: "", text: "", events, commands: [] };
  }

  const alone = originalText.match(new RegExp(`^(?:go to\\s+)?(${SECTION_PATTERN})$`, "i"));
  if (alone) {
    const key = sectionKey(alone[1]);
    const event = { type: "command", command: "section", key };
    return { originalText, text: "", events: [event], commands: [event] };
  }
  if (/^undo$/i.test(originalText)) {
    const event = { type: "command", command: "undo" };
    return { originalText, text: "", events: [event], commands: [event] };
  }

  const pattern = new RegExp([
    "\\bdelete last sentence\\b",
    "\\bstop dictation\\b",
    "\\bresume dictation\\b",
    "\\bnew paragraph\\b",
    "\\bnew line\\b",
    "\\bnext section\\b",
    `\\bgo to\\s+(?:${SECTION_PATTERN})\\b`,
    `\\b(?:${SECTION_PATTERN})\\s*(?:colon|:)`,
  ].join("|"), "gi");

  let cursor = 0;
  for (const match of originalText.matchAll(pattern)) {
    pushText(events, originalText.slice(cursor, match.index));
    const spoken = match[0];
    const inline = INLINE_COMMANDS.find(([label]) => label === spoken.toLowerCase());
    if (inline) {
      events.push({ type: "command", command: inline[1] });
    } else {
      const label = spoken.replace(/^go to\s+/i, "").replace(/\s*(?:colon|:)\s*$/i, "");
      const key = sectionKey(label);
      if (key) events.push({ type: "command", command: "section", key });
    }
    cursor = match.index + spoken.length;
  }
  pushText(events, originalText.slice(cursor));

  const commands = events.filter((event) => event.type === "command");
  const text = events.filter((event) => event.type === "text").map((event) => event.value).join(" ").replace(/\s+/g, " ").trim();
  return { originalText, text, events, commands };
}

export function commandWords(events = []) {
  return events.filter((event) => event.type === "command").map((event) => event.command);
}
