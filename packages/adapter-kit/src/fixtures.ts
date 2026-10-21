/**
 * Fixtures let adapter tests run offline. Record once against the live site with
 * `RECORD_FIXTURES=1 pnpm test:live`, commit the files, and unit tests replay them.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function fixturePath(adapterDir: string, name: string): string {
  return join(adapterDir, 'fixtures', name);
}

export async function loadFixture(adapterDir: string, name: string): Promise<string> {
  return readFile(fixturePath(adapterDir, name), 'utf8');
}

export async function saveFixture(adapterDir: string, name: string, body: string): Promise<void> {
  const path = fixturePath(adapterDir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, 'utf8');
}

export const isRecording = () => process.env.RECORD_FIXTURES === '1';
