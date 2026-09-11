const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
for (const file of fs.readdirSync('src').filter(x => /\.(cjs|mjs|js)$/.test(x))) execFileSync(process.execPath, ['--check', `src/${file}`], { stdio: 'inherit' });
const html = fs.readFileSync('src/index.html', 'utf8'), ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML element IDs');
const renderer = fs.readFileSync('src/renderer.mjs', 'utf8');
for (const match of renderer.matchAll(/\$\('#([\w-]+)'\)/g)) if (!ids.includes(match[1])) throw new Error(`Missing UI element: ${match[1]}`);
console.log('JavaScript syntax, unique element IDs, and renderer element references passed.');
