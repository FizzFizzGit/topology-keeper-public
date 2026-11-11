import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease } from './build-release.mjs';

// 公開リポジトリ内で検証し、配布用3ファイルだけを作る。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const args of [["scripts/check.mjs"], ["--test", "tests/*.test.js"]])
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.chdir(root);
const output = await buildRelease();
console.log("Release files: " + output);
