// 全部を1枚の HTML にまとめる（配布用・オフライン用）。
// ES モジュールの依存を辿って連結し、名前空間 import は束ねたオブジェクトに置き換える。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const THREE_SHIM = resolve(root, 'src/three.js');
const THREE_SRC = resolve(root, 'vendor/three.module.min.js');

const modules = new Map();   // abs -> { src, exports:Set, namespaces:Set }
const order = [];

const isThree = abs => abs === THREE_SHIM || abs.startsWith(resolve(root, 'vendor'));

function exportedNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      out.add((t.split(/\s+as\s+/)[1] || t).trim());
    }
  }
  return out;
}

function collect(abs) {
  if (modules.has(abs) || isThree(abs)) return;
  const src = readFileSync(abs, 'utf8');
  const mod = { src, exports: exportedNames(src), namespaces: new Set() };
  modules.set(abs, mod);

  for (const m of src.matchAll(/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s*['"](\.[^'"]+)['"]/gm)) {
    const dep = resolve(dirname(abs), m[2]);
    if (!isThree(dep)) { collect(dep); modules.get(dep).namespaces.add(m[1]); }
  }
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]/gm)) {
    collect(resolve(dirname(abs), m[1]));
  }
  order.push(abs);
}

/** import / export 文をはずして素の本体にする（すべて同じスコープに置く前提） */
function strip(src) {
  return src
    .replace(/^\s*import\s+\*\s+as\s+[\w$]+\s+from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+[^;]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^(\s*)export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\s)/gm, '$1')
    .replace(/^\s*export\s+\*\s+from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*(?:from\s*['"][^'"]+['"])?;?\s*$/gm, '');
}

collect(resolve(root, 'src/main.js'));

// three 本体：末尾の export 文を THREE 名前空間に変換
const three = readFileSync(THREE_SRC, 'utf8');
let converted = 0;
const threeBody = three.replace(/export\s*\{([^}]*)\}\s*;?/g, (_, names) => {
  converted++;
  const list = names.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, exported] = s.split(/\s+as\s+/).map(t => t.trim());
    return `  ${exported || local}: ${local},`;
  }).join('\n');
  return `return {\n${list}\n};`;
});
if (converted !== 1) throw new Error(`three の export 文が ${converted} 個見つかりました（1つのはず）`);
// three の圧縮済み識別子がゲーム側とぶつからないよう、閉じたスコープに入れる
const threeWrapped = `const THREE = (() => {\n${threeBody}\n})();`;

const parts = order.map(abs => {
  const mod = modules.get(abs);
  let out = `\n/* ==== ${relative(root, abs)} ==== */\n` + strip(mod.src);
  for (const ns of mod.namespaces) {
    out += `\nconst ${ns} = { ${[...mod.exports].join(', ')} };\n`;
  }
  return out;
});

const html = readFileSync(resolve(root, 'index.html'), 'utf8').replace(
  '<script type="module" src="./src/main.js"></script>',
  `<script type="module">\n${threeWrapped}\n${parts.join('\n')}\n</script>`
);

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB',
  '/ modules:', order.map(a => relative(root, a)).join(' '));
