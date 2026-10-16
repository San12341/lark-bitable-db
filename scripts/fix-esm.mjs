/**
 * ESM 构建后处理：
 *  1. 为 dist/esm 中相对导入说明符补 .js 扩展名（Node ESM 要求显式扩展名，
 *     而 moduleResolution:node 下源码不能写 .js 后缀，故在产物侧统一补齐）；
 *  2. 写入 dist/esm/package.json {"type":"module"}，使 Node 将 .js 识别为 ESM。
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'esm');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** 把相对说明符解析为 Node ESM 可用的形式：文件补 .js，目录补 /index.js */
function resolveSpecifier(fromFile, spec) {
  if (/\.[cm]?js$/.test(spec)) return spec; // 已带扩展名
  const abs = join(dirname(fromFile), spec);
  if (existsSync(`${abs}.js`) && statSync(`${abs}.js`).isFile()) return `${spec}.js`;
  if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return `${spec}/index.js`;
  return spec; // 无法解析则保持原样（构建会暴露问题）
}

let patched = 0;
for (const file of walk(distDir)) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (m, pre, spec, post) => {
      const fixed = resolveSpecifier(file, spec);
      return fixed === spec ? m : `${pre}${fixed}${post}`;
    },
  );
  if (out !== src) {
    writeFileSync(file, out);
    patched += 1;
  }
}

writeFileSync(join(distDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log(`[fix-esm] patched ${patched} file(s); wrote dist/esm/package.json (type: module)`);
