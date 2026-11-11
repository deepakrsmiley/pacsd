function fileNameFrom(disposition, fallback) {
  const match = String(disposition || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export async function downloadFile(path, fallbackName) {
  const headers = {};
  const facilityId = sessionStorage.getItem("pacsd_facility");
  if (facilityId) headers["x-facility-id"] = facilityId;
  const response = await fetch(path, { credentials: "include", headers });
  if (!response.ok) {
    let message = "";
    try {
      message = (await response.json()).error;
    } catch {
      message = "";
    }
    throw new Error(message || "The file could not be created.");
  }
  const blob = await response.blob();
  const name = fileNameFrom(response.headers.get("content-disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}

export function downloadReport(reportId, kind) {
  return downloadFile(`/api/reports/${reportId}/${kind}?download=1`, `report.${kind}`);
}

export function formatBytes(size) {
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
