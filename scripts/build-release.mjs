import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { sharedBuildOptions } from './esbuild-options.mjs';

// 配布時だけ、配布先の三ファイルを直接生成する。ローカルの中間JSは作らない。
export async function buildRelease() {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid release version');
  const output = path.resolve('dist', manifest.version);
  await esbuild.build({ ...sharedBuildOptions, outfile: path.join(output, 'main.js'), minify: true });
  mkdirSync(output, { recursive: true });
  copyFileSync('manifest.json', path.join(output, 'manifest.json'));
  copyFileSync('src/styles.css', path.join(output, 'styles.css'));
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log('Release files: ' + await buildRelease());
