import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export interface FixtureServer {
  url: string;
  /** Every request that reached the server, as "METHOD /path?query". */
  requests: string[];
  close(): Promise<void>;
}

/** Serves fixtures/ on 127.0.0.1. Unknown POSTs answer 200 so a leak would show up in `requests`. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = normalize(join(FIXTURES, path));
    if (req.method === 'GET' && file.startsWith(FIXTURES)) {
      try {
        const body = await readFile(file);
        const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/plain';
        res.writeHead(200, { 'content-type': type }).end(body);
        return;
      } catch {
        // fall through
      }
    }
    res.writeHead(req.method === 'GET' ? 404 : 200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
