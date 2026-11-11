import { api as dicomweb } from "dicomweb-client";

export function createDicomWeb() {
  return new dicomweb.DICOMwebClient({
    url: `${window.location.origin}/api/dicomweb`,
    requestHooks: [(request) => {
      request.withCredentials = true;
      return request;
    }],
  });
}

export async function confirmSeries(studyUid) {
  const client = createDicomWeb();
  const series = await client.searchForSeries({ studyInstanceUID: studyUid });
  return Array.isArray(series) ? series : [];
}
