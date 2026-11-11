import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertProductionConfig } from "../src/config.js";
import { createFirstAdmin } from "../src/createAdmin.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { User } from "../src/models.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let memory;

beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await connectDb(memory.getUri());
});

afterAll(async () => {
  await disconnectDb();
  if (memory) await memory.stop();
});

describe("docker production", () => {
  it("requires a public URL, defaults cookies to secure, and builds a non-root image", () => {
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
    })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
      PUBLIC_BASE_URL: "http://localhost:8080",
    })).toThrow(/localhost/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
      PUBLIC_BASE_URL: "http://127.0.0.1:8080",
    })).toThrow(/localhost/);

    const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("AS build");
    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");

    const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
    expect(compose).toContain("COOKIE_SECURE: ${COOKIE_SECURE:-true}");
    expect(compose).not.toContain("COOKIE_SECURE:-false");
    expect(compose).not.toContain("pacsd-local-change-me");
    expect(compose).toContain("${ORTHANC_PASSWORD}");
    expect(compose).toContain('profiles: ["mongo"]');
    expect(compose).toContain("image: mongo:7");
  });
});

describe("production startup", () => {
  it("refuses demo seeding and a weak session secret, and the image context excludes local secrets", () => {
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SEED_DEMO: "true",
      SESSION_SECRET: "a".repeat(40),
    })).toThrow(/SEED_DEMO/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "too-short",
    })).toThrow(/SESSION_SECRET/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: `${"a".repeat(32)}replace-this`,
    })).toThrow(/replace-this/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
      PUBLIC_BASE_URL: "https://pacs.example.test",
    })).not.toThrow();
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
      PUBLIC_BASE_URL: "https://pacs.example.test",
      ORTHANC_URL: "http://orthanc:8042",
    })).toThrow(/ORTHANC_USERNAME/);
    expect(() => assertProductionConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "a".repeat(32),
      PUBLIC_BASE_URL: "https://pacs.example.test",
      ORTHANC_URL: "http://orthanc:8042",
      ORTHANC_USERNAME: "pacsd_backend",
      ORTHANC_PASSWORD: "archive-secret",
    })).not.toThrow();
    expect(() => assertProductionConfig({
      NODE_ENV: "test",
      SEED_DEMO: "true",
      SESSION_SECRET: "short",
    })).not.toThrow();

    const ignored = fs.readFileSync(path.join(root, ".dockerignore"), "utf8").split(/\r?\n/);
    for (const entry of [".env", "node_modules", "server/data", "server/pacsd-backups", "dist"]) {
      expect(ignored).toContain(entry);
    }
  });

  it("creates the first administrator once", async () => {
    const created = await createFirstAdmin({
      name: "First Administrator",
      email: "first.admin@galactic.test",
      password: "Long-Admin-Password",
    });
    expect(created.role).toBe("system_admin");
    expect(await User.countDocuments({ role: "system_admin" })).toBe(1);
    await expect(createFirstAdmin({
      name: "Second Administrator",
      email: "second.admin@galactic.test",
      password: "Another-Long-Password",
    })).rejects.toThrow(/already exists/);
    expect(await User.countDocuments({ email: "second.admin@galactic.test" })).toBe(0);
  });
});
