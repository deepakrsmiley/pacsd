export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function interpretResponse(status, text, statusText = "") {
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  const ok = status >= 200 && status < 300;
  return {
    data,
    redirect: status === 401 ? "/login" : "",
    error: ok ? "" : (data?.error || statusText || "Request failed"),
  };
}

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const facilityId = sessionStorage.getItem("pacsd_facility");
  const requestHeaders = { ...headers };
  if (facilityId) requestHeaders["x-facility-id"] = facilityId;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: requestHeaders,
    body: payload,
  });
  const text = await response.text();
  const result = interpretResponse(response.status, text, response.statusText);
  if (result.redirect && window.location.pathname !== result.redirect) window.location.assign(result.redirect);
  if (!response.ok) throw new ApiError(result.error, response.status, result.data);
  return result.data;
}
