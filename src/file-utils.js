const path = require("path");
const { CONFIG } = require("./plugin-settings");

// Vaultファイルの基本的な分類。Obsidian APIには依存せず、TFile相当の値とパスを受け取る。
// 戻り値は判定結果のみで、Vaultや設定は変更しない。
const inFolder = (file, folder) => file.path.startsWith(`${folder}/`);

const isImage = (filePath) =>
  CONFIG.imageExtensions.has(path.extname(filePath).slice(1).toLowerCase());
// getFoldersで現在の設定を読む。別Vaultやテストの設定が互いに干渉しない。
function createFilePredicates(getFolders) {
  const isManagedPath = filePath => Object.values(getFolders()).some(folder => filePath.startsWith(folder + '/'));
  const isManaged = file => isManagedPath(file.path);
  const isMainNote = file => !!file && file.extension === 'md' && !isManaged(file);
  return { isManagedPath, isManaged, isMainNote };
}

module.exports = { inFolder, isImage, createFilePredicates };
