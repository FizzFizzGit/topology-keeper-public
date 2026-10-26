import esbuild from "esbuild";
import { sharedBuildOptions } from "./esbuild-options.mjs";

await esbuild.build({ ...sharedBuildOptions, minify: true });
