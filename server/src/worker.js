import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertProductionConfig } from "./config.js";
import { connectDb } from "./db.js";
import { startOrthancPoller } from "./orthancSync.js";
import { startTransferWatcher } from "./transferProgress.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

try {
  assertProductionConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required for the Orthanc worker.");
  process.exit(1);
}

if (!process.env.ORTHANC_URL) {
  console.error("ORTHANC_URL is required for the Orthanc worker.");
  process.exit(1);
}

await connectDb(process.env.MONGODB_URI);
console.log("PACSD Orthanc worker connected. Starting Changes poller.");
startTransferWatcher();
startOrthancPoller();

process.on("SIGTERM", () => {
  console.log("Orthanc worker stopping");
  process.exit(0);
});
