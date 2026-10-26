import esbuild from "esbuild";
import { sharedBuildOptions } from "./esbuild-options.mjs";
import { deployPluginFiles } from "./deploy.mjs";
const deploy = process.argv.includes("--deploy");

async function run() {
  const context = await esbuild.context({
    ...sharedBuildOptions,
    sourcemap: "inline",
    plugins: [
      {
        name: "deploy-on-end",
        setup(build) {
          // ビルドが完了したときのイベント
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              console.log("ビルドが完了しました。");
              if (deploy) {
                try { deployPluginFiles(); }
                catch (error) { console.error(`[ERROR] 配置に失敗しました: ${error.message}`); }
              }
            } else {
              console.log("ビルドエラーが発生しました。");
            }
          });
        },
      },
    ],
  });

  // ファイルの監視（watch）を開始
  await context.watch();
  console.log(deploy ? "保存時にビルドして配置します。終了はCtrl+C。" : "保存時にビルドします。終了はCtrl+C。");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
