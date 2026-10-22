import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '../strings';
import { renderApp } from '../test/render';
import { mockApi } from '../test/setup';

describe('settings', () => {
  it('saves stores, postcode and API key, and keeps the key masked', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('settings');

    await user.click(await screen.findByRole('checkbox', { name: /^Lyko/ }));
    const postcode = screen.getByRole('textbox', { name: new RegExp(`^${t.settings.postcode}`) });
    await user.clear(postcode);
    await user.type(postcode, '41101');
    await user.type(screen.getByLabelText(t.settings.apiKey), 'sk-ant-secret-1234');
    // The first Save belongs to the main settings form; the rest to shipping rules.
    await user.click(screen.getAllByRole('button', { name: t.common.save })[0]!);

    await waitFor(() => expect(state.settings.postcode).toBe('41101'));
    expect(state.settings.enabledMerchants).not.toContain('lyko');
    expect(state.settings.anthropicApiKey).toBe('sk-ant-secret-1234');
    expect(await screen.findByText(t.settings.apiKeySaved('****1234'))).toBeInTheDocument();
    expect(screen.queryByDisplayValue('sk-ant-secret-1234')).not.toBeInTheDocument();
  });

  it('warns about stale shipping rules', async () => {
    mockApi();
    renderApp('settings');
    // The mock Apoteket rule was last verified 2026-03-01.
    const apoteket = await screen.findByRole('region', { name: 'Apoteket' });
    const stale = new Date('2026-03-01').getTime() < Date.now() - 90 * 86_400_000;
    expect(within(apoteket).queryAllByRole('alert')).toHaveLength(stale ? 1 : 0);
    const apotea = screen.getByRole('region', { name: 'Apotea' });
    expect(within(apotea).getByDisplayValue('2026-09-30')).toBeInTheDocument();
  });
});

describe('product catalogs', () => {
  it('shows catalog status and refreshes on request', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('settings');

    const heading = await screen.findByRole('heading', { name: t.settings.catalogsHeading });
    const card = heading.closest('div')!.parentElement!;
    expect(within(card).getAllByText(t.settings.catalogNever)).toHaveLength(3);

    await user.click(within(card).getByRole('button', { name: t.settings.refreshCatalogs }));
    await waitFor(() => expect(state.catalogs.get('apotea')?.refreshedAt).toBeDefined());
    // Polling picks up the finished refresh.
    await waitFor(
      () => expect(within(card).queryAllByText(t.settings.catalogNever)).toHaveLength(0),
      { timeout: 5000 },
    );
    expect(within(card).getByText(/1[\s ]?600 products/)).toBeInTheDocument();
  });
});

describe('accepted matches', () => {
  it('lists the match history, newest first', async () => {
    const state = mockApi();
    state.history = [
      {
        query: 'cerave spf50',
        merchantId: 'apotea',
        merchantProductId: 'apotea-p05',
        title: 'CeraVe Facial Moisturising Lotion SPF50 52 ml',
        acceptedAt: '2026-10-22T12:00:00.000Z',
      },
      {
        query: 'alvedon 20 st',
        merchantId: 'doz',
        merchantProductId: 'doz-p01',
        acceptedAt: '2026-10-21T12:00:00.000Z',
      },
    ];
    renderApp('settings');

    const heading = await screen.findByRole('heading', { name: t.settings.historyHeading });
    const card = heading.parentElement!;
    expect(await within(card).findByText(t.settings.historyCount(2))).toBeInTheDocument();
    const rows = within(card).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('CeraVe Facial Moisturising Lotion SPF50 52 ml');
    // Without a snapshot the store's product id is shown.
    expect(rows[1]).toHaveTextContent('doz-p01');
  });
});
