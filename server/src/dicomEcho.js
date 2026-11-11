import net from "node:net";
import { orthancFetch } from "./orthancClient.js";

export function probeDicomPort(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ...result, durationMs: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({
      reachable: true,
      echo: false,
      error: "The port accepted a TCP connection. PACSD did not complete a DICOM C-ECHO. Set ORTHANC_URL so the archive can send the association.",
    }));
    socket.once("timeout", () => finish({ reachable: false, echo: false, error: "Connection timed out" }));
    socket.once("error", (error) => finish({
      reachable: false,
      echo: false,
      error: error.code === "ECONNREFUSED"
        ? "Connection refused"
        : error.code === "ENOTFOUND"
          ? "Host not found"
          : error.code === "EACCES"
            ? "Connection not permitted"
            : error.message,
    }));
  });
}

export async function echoThroughOrthanc(node) {
  const name = `pacsd-${node._id}`;
  try {
    await orthancFetch(`/modalities/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ AET: node.aeTitle, Host: node.host, Port: node.port }),
    });
  } catch (error) {
    return { reachable: false, echo: false, durationMs: 0, error: error.message };
  }
  const started = Date.now();
  try {
    await orthancFetch(`/modalities/${encodeURIComponent(name)}/echo`, { method: "POST" });
    return { reachable: true, echo: true, durationMs: Date.now() - started, error: "" };
  } catch (error) {
    return { reachable: true, echo: false, durationMs: Date.now() - started, error: error.message };
  }
}
