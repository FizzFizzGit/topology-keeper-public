import { mkdirSync, copyFileSync, readFileSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// ローカルで検証・ビルドした3ファイルだけを配布フォルダへコピーする。配置・Git操作はしない。
execFileSync(process.execPath, ["scripts/check.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/*.test.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["build-once.mjs"], { stdio: "inherit" });
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const output = path.join("dist", manifest.id, manifest.version);
mkdirSync(output, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"])
  copyFileSync(file, path.join(output, file));
console.log(`Release files: ${path.resolve(output)}`);
const source = path.join("dist", "source", `${manifest.id}-${manifest.version}`);
mkdirSync(source, { recursive: true });
for (const directory of ["src", "tests", "scripts"]) cpSync(directory, path.join(source, directory), { recursive: true });
for (const file of ["README.md", "LICENSE", "RELEASE-CHECKLIST.md", "manifest.json", "versions.json", "package.json", "package-lock.json", ".gitignore", ".gitattributes", "styles.css", "main.js", "esbuild-options.mjs", "build-once.mjs", "build.mjs", "deploy.mjs", "env.bat", "build.bat", "dev.bat", "setup.bat"])
  copyFileSync(file, path.join(source, file));
console.log(`Source snapshot (no Git history or local settings): ${path.resolve(source)}`);
