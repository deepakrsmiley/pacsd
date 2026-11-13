import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertProductionConfig } from "./config.js";
import { createApp } from "./createApp.js";
import { connectDb } from "./db.js";
import { startOrthancPoller } from "./orthancSync.js";
import { startTransferWatcher } from "./transferProgress.js";
import { seedIfEmpty } from "./seed.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

const port = Number(process.env.PORT || 4000);

try {
  assertProductionConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function resolveUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.ALLOW_MEMORY_DB !== "true") {
    console.error("MONGODB_URI is required. Set ALLOW_MEMORY_DB=true only for a local demonstration.");
    process.exit(1);
  }
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const memory = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  console.log("PACSD is using an in-memory database. Data disappears when the process stops.");
  return memory.getUri();
}

const uri = await resolveUri();
await connectDb(uri);
if (process.env.SEED_DEMO === "true") {
  const result = await seedIfEmpty();
  if (result.seeded) console.log("Seeded demonstration users. Password comes from DEMO_PASSWORD.");
}
const app = createApp();
app.listen(port, () => {
  console.log(`PACSD API listening on ${port}`);
  // When a dedicated Render worker runs the poller, set ORTHANC_POLLER=false on the web service.
  startTransferWatcher();
  if (process.env.ORTHANC_POLLER !== "false") startOrthancPoller();
});
