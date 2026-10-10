// Application boundary checks. This does not substitute for compiler/runtime checks.
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative, extname } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');
const metadata = JSON.parse(await read('package.json'));
const pins = JSON.parse(await read('dependency-pins.json'));
const problems = [];
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
async function files(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'testFixtures') continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
const forbidden = new Set(['engine', 'terrain', 'renderer', 'hud', 'sky', 'weather', 'images', 'panorama', 'windowing', 'perf', 'lights']);
for (const entry of await readdir(resolve(root, 'src'), { withFileTypes: true })) {
  if (entry.isDirectory() && forbidden.has(entry.name)) problems.push(`Extracted implementation directory returned: src/${entry.name}`);
}
const exportsByPackage = new Map(pins.packages.map(pin => [pin.name ?? pin.package, pin.publicExports ?? pin.exports]));
const declared = { ...metadata.dependencies, ...metadata.devDependencies };
const sourceFiles = [...await files(resolve(root, 'src')), ...await files(resolve(root, 'vite'))];
let imports = 0;
for (const path of sourceFiles) {
  if (/\.test\.tsx?$/.test(path) || !['.ts', '.tsx', '.css'].includes(extname(path))) continue;
  const text = await readFile(path, 'utf8');
  const specifiers = [];
  if (extname(path) === '.css') {
    specifiers.push(...Array.from(text.matchAll(/@import\s+(["'])([^"']+)\1/g), match => match[2]));
  } else {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const collect = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specifiers.push(node.arguments[0].text);
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL' && node.arguments?.length === 2 && ts.isStringLiteral(node.arguments[0]) && node.arguments[1].getText(source) === 'import.meta.url') {
        const value = node.arguments[0].text;
        if (value.startsWith('.') && value !== '.' && value !== '..' && !value.endsWith('/')) specifiers.push(value);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  for (const specifier of new Set(specifiers)) {
    imports++;
    if (specifier.startsWith('node:')) continue;
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(path), specifier);
      if (!target.startsWith(`${root}/`)) problems.push(`Relative import escapes app: ${relative(root, path)} -> ${specifier}`);
      const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.d.ts`, `${target}.css`, `${target}.json`, resolve(target, 'index.ts'), resolve(target, 'index.tsx')];
      if (!(await Promise.all(candidates.map(exists))).some(Boolean)) problems.push(`Missing source input: ${relative(root, path)} -> ${specifier}`);
      continue;
    }
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (name.startsWith('@0sfs/') || name.startsWith('@umn-vr/') || name === '0sfs') problems.push(`Foreign application dependency: ${specifier}`);
    if (name !== metadata.name && !declared[name]) problems.push(`Undeclared package: ${relative(root, path)} -> ${specifier}`);
    if (name.startsWith('@foss-earth/')) {
      const key = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
      let exports = exportsByPackage.get(name);
      // Pending owners must be installed and checked too; no sibling escape.
      if (!exports) {
        try {
          const entry = fileURLToPath(import.meta.resolve(name));
          let directory = dirname(entry);
          while (directory !== dirname(directory)) {
            const manifest = resolve(directory, 'package.json');
            if (await exists(manifest)) {
              const owner = JSON.parse(await readFile(manifest, 'utf8'));
              if (owner.name === name) { exports = owner.exports; break; }
            }
            directory = dirname(directory);
          }
        } catch { /* Report missing reviewed package below. */ }
      }
      if (!exports || !Object.hasOwn(exports, key)) problems.push(`Missing public owner export: ${specifier}`);
    }
  }
}
for (const [name, target] of Object.entries(metadata.exports)) {
  if (typeof target !== 'string' || !await exists(resolve(root, target))) problems.push(`Missing app export: ${name}`);
}
const required = ['CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'LICENSE', 'SECURITY.md'];
const readme = await read('README.md');
for (const path of required) {
  if (!await exists(resolve(root, path)) || !readme.includes(`](${path})`)) problems.push(`Missing community file or README link: ${path}`);
}
const rule = 'You cannot have AI as a co-author, or your contributions will be rejected.';
const contributing = await read('CONTRIBUTING.md');
if (!contributing.includes(`## Commit attribution\n\n${rule}`)) problems.push('Current contribution rule must be in the later Commit attribution section.');
if (!((await read('AGENTS.md')).includes(rule))) problems.push('Agent policy is missing the current contribution rule.');
if (readme.includes(rule)) problems.push('Contribution rule belongs in CONTRIBUTING, not README.');
const attribution = JSON.parse(await read('.attribution.json'));
const release = JSON.parse(await read('.attribution-release.json'));
const caller = await read('.github/workflows/attribution-check.yml');
if (attribution.revision !== release.revision || attribution.policySha256 !== release.policySha256 || !caller.includes(`@${release.revision}`)) problems.push('Common policy/config/caller pins disagree.');
if (/paths(?:-ignore)?:/.test(caller)) problems.push('Metadata caller must include docs-only changes.');
if (problems.length) throw new Error(problems.join('\n'));
process.stdout.write(`${JSON.stringify({ owner: 'foss-earth/app', boundaryFiles: sourceFiles.length, imports, metadataIncluded: true, commonRevision: release.revision, status: 'source boundaries passed; runtime and admission require separate evidence' }, null, 2)}\n`);
