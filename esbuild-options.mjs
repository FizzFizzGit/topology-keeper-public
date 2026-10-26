// build.bat と dev.bat が共用する、ビルドの基本設定。
export const sharedBuildOptions = {
  entryPoints: ["src/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  external: ["obsidian", "electron", "@electron/remote"],
  charset: "utf8",
  outfile: "main.js",
};
