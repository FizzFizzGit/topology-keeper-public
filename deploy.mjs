import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Obsidian がプラグインとして読むファイルだけを、指定された Vault の配置先へコピーする。
// PLUGIN_DIR は env.bat で設定する。プラグイン本体の data.json は Vault 側のデータなのでコピーしない。
export function deployPluginFiles() {
  const pluginDir = process.env.PLUGIN_DIR;
  if (!pluginDir) {
    throw new Error("PLUGIN_DIR が未設定です。env.bat の設定を確認してください。");
  }

  mkdirSync(pluginDir, { recursive: true });
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const destinationManifest = path.join(pluginDir, "manifest.json");
  if (existsSync(destinationManifest)) {
    const installed = JSON.parse(readFileSync(destinationManifest, "utf8"));
    if (String(installed.id).toLowerCase() !== manifest.id.toLowerCase())
      throw new Error("配置先には別のプラグインがあります。PLUGIN_DIRを確認してください。");
    // 既存ローカル版のIDを維持して、設定と有効状態を引き継ぐ。公開用manifestは変更しない。
    manifest.id = installed.id;
  }
  for (const file of ["main.js", "styles.css"]) {
    copyFileSync(file, path.join(pluginDir, file));
  }
  writeFileSync(destinationManifest, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Plugin を配置しました: ${pluginDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    deployPluginFiles();
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  }
}
