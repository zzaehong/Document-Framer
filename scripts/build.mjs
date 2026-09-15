/**
 * TypeScript 진입점을 Obsidian이 읽는 main.js 하나로 묶는다.
 * obsidian 모듈은 앱이 제공하므로 번들에서 제외한다. --watch는 소스 변경 시 다시 빌드한다.
 */
import * as esbuild from 'esbuild';
const options = { entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info' };
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else await esbuild.build(options);
