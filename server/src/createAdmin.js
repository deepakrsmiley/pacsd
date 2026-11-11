import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { assertProductionConfig } from "./config.js";
import { connectDb } from "./db.js";
import { User } from "./models.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

export async function createFirstAdmin({ name, email, password }) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (cleanName.length < 2) throw new Error("Name is required");
  if (!cleanEmail.includes("@")) throw new Error("Email is required");
  if (!password || String(password).length < 10) throw new Error("Password must be at least 10 characters");
  if (await User.exists({ role: "system_admin" })) {
    throw new Error("A system administrator already exists");
  }
  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    passwordHash: await bcrypt.hash(String(password), 12),
    role: "system_admin",
    facilityIds: [],
  });
  return { id: String(user._id), email: user.email, role: user.role };
}

async function main() {
  assertProductionConfig();
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  await connectDb(process.env.MONGODB_URI);
  const admin = await createFirstAdmin({ name, email, password });
  console.log(`Created system administrator ${admin.email}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
