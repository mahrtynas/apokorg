/**
 * Sidecar entry point. Listens on 127.0.0.1 only and prints `READY <port>` on stdout once
 * listening; the desktop shell waits for that line.
 *
 *   --mock / APOKORG_MOCK=1   serve mock adapters
 *   APOKORG_PORT              port (default 4517)
 *   APOKORG_DATA_DIR          data directory (default %APPDATA%/apokorg)
 */
import { loadAdapters } from '@apokorg/registry';
import { buildApp } from './app';
import { defaultDataDir, openDataDb } from './db';
import { Repo } from './repo';

export const DEFAULT_PORT = 4517;

async function main(): Promise<void> {
  const mock = process.argv.includes('--mock') || process.env.APOKORG_MOCK === '1';
  const port = Number(process.env.APOKORG_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid APOKORG_PORT: ${process.env.APOKORG_PORT}`);
  }

  const db = openDataDb(defaultDataDir());
  new Repo(db).purgeExpired();
  const app = await buildApp({
    db,
    adapters: loadAdapters({ mock }),
    // Logs go to stderr so stdout carries only the READY line.
    logger: { level: process.env.APOKORG_LOG_LEVEL ?? 'info', stream: process.stderr },
  });

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: '127.0.0.1', port });
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`READY ${actualPort}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
