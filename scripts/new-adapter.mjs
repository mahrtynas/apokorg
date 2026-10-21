// Usage: pnpm new:adapter <id> "<Name>" <baseUrl> <pharmacy|beauty|sport> <api|search-page|catalog-index>
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [id, name, baseUrl, category, strategy] = process.argv.slice(2);
if (!id || !name || !baseUrl || !category || !strategy) {
  console.error(
    'Usage: pnpm new:adapter <id> "<Name>" <baseUrl> <pharmacy|beauty|sport> <api|search-page|catalog-index>',
  );
  process.exit(1);
}

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const template = join(root, 'packages/adapters/_template');
const target = join(root, 'packages/adapters', id);
const docTarget = join(root, 'docs/stores', `${id}.md`);

const merchantsTs = await readFile(join(root, 'packages/core/src/merchants.ts'), 'utf8');
if (!merchantsTs.includes(`'${id}'`)) {
  console.error(
    `'${id}' is not in MERCHANT_IDS (packages/core/src/merchants.ts). Adding a store is a contract change: open a separate PR for it first.`,
  );
  process.exit(1);
}

if (await exists(target)) {
  console.error(`${target} already exists`);
  process.exit(1);
}

const replace = (s) =>
  s
    .replaceAll('__ID__', id)
    .replaceAll('__NAME__', name)
    .replaceAll('__BASE_URL__', baseUrl.replace(/\/$/, ''))
    .replaceAll('__CATEGORY__', category)
    .replaceAll('__STRATEGY__', strategy);

await cp(template, target, { recursive: true, filter: (src) => !src.endsWith('store.md') });
await mkdir(join(target, 'fixtures'), { recursive: true });
await writeFile(join(target, 'fixtures', '.gitkeep'), '');
for (const file of await walk(target)) {
  await writeFile(file, replace(await readFile(file, 'utf8')));
}
if (!(await exists(docTarget))) {
  await writeFile(docTarget, replace(await readFile(join(template, 'store.md'), 'utf8')));
}
console.log(`Created packages/adapters/${id} and docs/stores/${id}.md. Run pnpm install.`);

async function exists(p) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
