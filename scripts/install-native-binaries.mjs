// package-lock.json is generated on Windows and npm records only the Windows builds of
// rollup and esbuild. Linux build hosts (Render, Netlify, Docker) need their own builds.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

if (process.platform !== "linux") process.exit(0);

const require = createRequire(import.meta.url);
const arch = process.arch === "arm64" ? "arm64" : "x64";
const libc = process.report?.getReport?.().header?.glibcVersionRuntime ? "gnu" : "musl";
const rollup = require("rollup/package.json").version;
const esbuild = require("esbuild/package.json").version;
const packages = [
  `@rollup/rollup-linux-${arch}-${libc}@${rollup}`,
  `@esbuild/linux-${arch}@${esbuild}`,
];

console.log(`Installing Linux build binaries: ${packages.join(" ")}`);
execSync(`npm install --no-save --ignore-scripts --no-audit --no-fund ${packages.join(" ")}`, { stdio: "inherit" });
