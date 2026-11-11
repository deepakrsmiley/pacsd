import { generateJSON } from "@tiptap/core";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlToDoc(html, extensions) {
  const source = String(html || "").trim() || "<p></p>";
  try {
    const doc = generateJSON(source, extensions);
    if (doc?.type === "doc" && Array.isArray(doc.content) && doc.content.length > 0) return doc;
  } catch {
    // Some Word markup has no matching editor node. The plain text is kept below.
  }
  const text = source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("That file did not contain report text.");
  return {
    type: "doc",
    content: text.split(/(?<=\.)\s+/).slice(0, 80).map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

export async function documentFromFile(file, extensions) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return htmlToDoc(result.value, extensions);
  }
  if (name.endsWith(".html") || name.endsWith(".htm") || file.type === "text/html") {
    return htmlToDoc(await file.text(), extensions);
  }
  if (name.endsWith(".txt") || file.type.startsWith("text/plain")) {
    const text = await file.text();
    const html = text
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
      .join("");
    return htmlToDoc(html, extensions);
  }
  throw new Error("Import a Word document (.docx), a web page (.html), or a plain text file (.txt).");
}
