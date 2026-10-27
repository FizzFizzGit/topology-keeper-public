import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 公開リポジトリ内で検証し、配布用3ファイルだけを作る。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const args of [["scripts/check.mjs"], ["--test", "tests/*.test.js"], ["build-once.mjs"]])
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const output = path.join(root, "dist", manifest.version);
mkdirSync(output, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"])
  copyFileSync(path.join(root, name), path.join(output, name));
console.log("Release files: " + output);
