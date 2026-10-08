import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const files = [
    ['index.html', 'index.html'],
    ['css/styles.css', 'css/styles.css'],
    ['node_modules/marked/lib/marked.umd.js', 'vendor/marked.umd.js'],
    ['node_modules/dompurify/dist/purify.min.js', 'vendor/purify.min.js'],
    ['node_modules/prismjs/prism.js', 'vendor/prism.min.js'],
    ['node_modules/prismjs/themes/prism-tomorrow.min.css', 'vendor/prism-tomorrow.min.css'],
    ['node_modules/prismjs/components/prism-javascript.min.js', 'vendor/prism-components/prism-javascript.min.js'],
    ['node_modules/prismjs/components/prism-bash.min.js', 'vendor/prism-components/prism-bash.min.js'],
    ['node_modules/prismjs/components/prism-python.min.js', 'vendor/prism-components/prism-python.min.js'],
    ['node_modules/prismjs/components/prism-css.min.js', 'vendor/prism-components/prism-css.min.js'],
    ['node_modules/prismjs/components/prism-json.min.js', 'vendor/prism-components/prism-json.min.js'],
    ['node_modules/prismjs/components/prism-typescript.min.js', 'vendor/prism-components/prism-typescript.min.js'],
    ['node_modules/prismjs/components/prism-yaml.min.js', 'vendor/prism-components/prism-yaml.min.js']
];

for (const [source, target] of files) {
    const targetPath = resolve(dist, target);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(resolve(root, source), targetPath);
}

await mkdir(resolve(dist, 'js'), { recursive: true });
await build({
    entryPoints: [resolve(root, 'js/app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: resolve(dist, 'js/app.js')
});