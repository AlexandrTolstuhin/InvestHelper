// Копируем index.html в 404.html, чтобы GitHub Pages отдавал SPA-шелл
// для любых путей внутри base path. Запускается после `vite build`.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const buildDir = 'build';
const src = join(buildDir, 'index.html');
const dst = join(buildDir, '404.html');

if (!existsSync(src)) {
	console.error(`[postbuild-spa] ${src} not found, skipping`);
	process.exit(0);
}

copyFileSync(src, dst);
console.log(`[postbuild-spa] copied ${src} -> ${dst}`);
