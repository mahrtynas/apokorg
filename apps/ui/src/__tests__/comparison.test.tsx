import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { API_URL } from '../api/client';
import { buildComparison, packPrice } from '../lib/comparison';
import { t } from '../strings';
import { renderApp, sekText } from '../test/render';
import { mockApi, server } from '../test/setup';

describe('comparison table', () => {
  it('highlights the cheapest offer per item and marks substitutes', async () => {
    mockApi();
    renderApp('compare');

    const header = await screen.findByRole('rowheader', { name: /alvedon 20 st/i });
    const row = header.closest('tr')!;
    const cheapest = row.querySelectorAll('[data-cheapest]');
    expect(cheapest).toHaveLength(1);
    expect(cheapest[0]).toHaveTextContent(sekText(38)); // DOZ has the 20-pack for 38 kr

    // The cheapest cell sits in the DOZ column.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const cells = [...row.querySelectorAll('td')];
    expect(headers[cells.indexOf(cheapest[0] as HTMLTableCellElement) + 1]).toContain('DOZ');

    // Apotea only has a different whey, shown as a substitute.
    const whey = screen.getByRole('rowheader', { name: /star nutrition whey/i }).closest('tr')!;
    expect(within(whey).getByText(t.match.substitute)).toBeInTheDocument();
  });

  it('shows a per-store error in the column header', async () => {
    mockApi({ failing: ['kronans'] });
    renderApp('compare');

    const kronans = await screen.findByRole('columnheader', { name: /Kronans Apotek/ });
    expect(within(kronans).getByText(t.status.error)).toBeInTheDocument();
  });

  it('refreshes prices with refresh: true, showing a spinner while it runs', async () => {
    mockApi();
    const bodies: { refresh?: boolean }[] = [];
    // Records each optimize body, slows refreshes down, then falls through to the mock API.
    server.use(
      http.post(`${API_URL}/api/baskets/:id/optimize`, async ({ request }) => {
        const body = (await request.clone().json()) as { refresh?: boolean };
        bodies.push(body);
        if (body.refresh) await delay(50);
      }),
    );
    const fetchedAt = new RegExp(`^${t.refresh.fetchedAt('')}`);
    const user = userEvent.setup();
    renderApp('compare');
    await screen.findByRole('rowheader', { name: /alvedon 20 st/i });
    expect(screen.getByText(fetchedAt)).toBeInTheDocument();
    expect(bodies.map((b) => b.refresh)).toEqual([false]);

    const button = screen.getByRole('button', { name: new RegExp(t.refresh.button) });
    await user.click(button);
    expect(await screen.findByText(t.refresh.running)).toBeInTheDocument();
    expect(button).toBeDisabled();

    await screen.findByText(fetchedAt);
    expect(button).toBeEnabled();
    expect(screen.queryByText(t.refresh.running)).not.toBeInTheDocument();
    // One refresh, and the refreshed result is shown without another plain request.
    expect(bodies.map((b) => b.refresh)).toEqual([false, true]);
    expect(screen.getByRole('rowheader', { name: /alvedon 20 st/i })).toBeInTheDocument();
  });
});

describe('buildComparison', () => {
  it('compares a single can scaled up to the chosen 24-pack', () => {
    const offer = (merchantId: 'meds' | 'gymgrossisten', price: number) => ({
      merchantId,
      merchantProductId: `${merchantId}-nocco`,
      title: 'NOCCO BCAA Arancia',
      price,
      inStock: true,
      url: `https://example.com/${merchantId}`,
      fetchedAt: '2026-10-22T00:00:00.000Z',
    });
    const item = {
      id: 'n1',
      query: 'nocco arancia',
      qty: 1,
      acceptSubstitutes: false,
      pinned: {},
    };
    const rows = buildComparison(
      [item],
      [
        {
          itemId: 'n1',
          matches: [
            { offer: offer('meds', 22), kind: 'exact', confidence: 1, reasons: [], packs: 24 },
            { offer: offer('gymgrossisten', 499), kind: 'exact', confidence: 1, reasons: [] },
          ],
        },
      ],
      ['meds', 'gymgrossisten'],
    );
    const [meds, gym] = rows[0]!.cells;
    expect(packPrice(meds!.match!)).toBe(528);
    expect(meds!.cheapest).toBe(false);
    expect(gym!.cheapest).toBe(true);
  });
});
