const path = require("path");
const { CONFIG, isManagedPath } = require("./plugin-settings");

// Vaultファイルの基本的な分類。Obsidian APIには依存せず、TFile相当の値とパスを受け取る。
// 戻り値は判定結果のみで、Vaultや設定は変更しない。
const inFolder = (file, folder) => file.path.startsWith(`${folder}/`);
const isManaged = (file) => isManagedPath(file.path);
const isImage = (filePath) =>
  CONFIG.imageExtensions.has(path.extname(filePath).slice(1).toLowerCase());
const isMainNote = (file) =>
  !!file && file.extension === "md" && !isManaged(file);

module.exports = { inFolder, isManaged, isImage, isMainNote };
