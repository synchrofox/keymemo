import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
};

const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end();
        return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
    }

    try {
        const content = await readFile(filePath);
        response.writeHead(200, {
            'Cache-Control': 'no-cache',
            'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
        });
        response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
        response.writeHead(404).end();
    }
});

const port = Number(process.env.PORT) || 4173;
server.listen(port, '127.0.0.1', () => {
    console.log(`KeyMemo dev server: http://127.0.0.1:${port}`);
});