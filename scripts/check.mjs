import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (manifest.version !== pkg.version || pkg.version !== lock.version || pkg.version !== lock.packages[""].version)
  throw new Error("manifest/package/lock versions must match");
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || manifest.id.includes("obsidian") || manifest.id.endsWith("plugin"))
  throw new Error("Invalid public plugin ID");
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error("versions.json must match manifest");
if (manifest.description.length > 250 || !manifest.description.endsWith(".")) throw new Error("Invalid plugin description");
for (const directory of ["src", "tests", "scripts"]) {
  for (const file of readdirSync(directory)) {
    if (/\.[cm]?js$/.test(file)) execFileSync(process.execPath, ["--check", `${directory}/${file}`], { stdio: "inherit" });
  }
}
for (const file of readdirSync(".")) {
  if (file.endsWith(".mjs")) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log("Syntax and release versions verified.");
