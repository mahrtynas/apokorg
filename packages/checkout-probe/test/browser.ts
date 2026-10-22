import { chromium } from 'playwright-core';
import type { BrowserLaunch } from '../src/run';

let detected: Promise<BrowserLaunch> | undefined;

/**
 * The browser the tests run: installed Edge when present (local Windows), else installed
 * Chrome, else Playwright's bundled Chromium (`npx playwright install chromium`).
 */
export function testBrowser(): Promise<BrowserLaunch> {
  detected ??= (async () => {
    const candidates: BrowserLaunch[] = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
    const failures: string[] = [];
    for (const launch of candidates) {
      try {
        const browser = await chromium.launch({ ...launch, headless: true, timeout: 30_000 });
        await browser.close();
        return launch;
      } catch (err) {
        failures.push(
          `${launch.channel ?? 'bundled chromium'}: ${(err as Error).message.split('\n')[0]}`,
        );
      }
    }
    throw new Error(
      `No browser for the probe tests. Install Edge or run "npx playwright install chromium".\n${failures.join('\n')}`,
    );
  })();
  return detected;
}
