import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SEED_BASKET_ID } from '../mocks/data';
import { t } from '../strings';
import { renderApp } from '../test/render';
import { mockApi } from '../test/setup';

async function waitForBasket() {
  await screen.findByRole('cell', { name: /^alvedon 20 st/i });
}

describe('basket builder', () => {
  it('picks a product, finds it at every store and pins the confirmed matches', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('basket');
    await waitForBasket();

    await user.type(screen.getByRole('searchbox', { name: t.search.queryLabel }), 'whey{Enter}');

    // Step 1: distinct products, independent of store.
    expect(await screen.findByText(t.search.pickProduct)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Star Nutrition Whey-80 1 kg Chocolate' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Body Science Whey 100% 1 kg Chocolate' }));

    // Step 2: the chosen product at each store that has it, preselected.
    expect(await screen.findByText(t.search.confirmStores)).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Gymgrossisten: Body Science Whey 100% 1 kg Chocolate' }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: t.search.confirmAndAdd }));

    const row = (await screen.findByRole('cell', { name: /^Body Science Whey/ })).closest('tr')!;
    expect(within(row).getByText(t.items.pinned(2))).toBeInTheDocument();
    await waitFor(() => {
      const added = state.baskets.get(SEED_BASKET_ID)!.items.at(-1)!;
      expect(added).toMatchObject({
        query: 'whey',
        title: 'Body Science Whey 100% 1 kg Chocolate',
        acceptSubstitutes: false,
        pinned: { apotea: 'apotea-p08', gymgrossisten: 'gymgrossisten-p08' },
      });
      expect(added.ean).toMatch(/^\d{13}$/);
    });
    // Both confirmed stores are recorded as accepted matches.
    expect(state.history.map((h) => h.merchantProductId).sort()).toEqual([
      'apotea-p08',
      'gymgrossisten-p08',
    ]);
  });

  it('goes back from step 2, and edits quantity and substitutes', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('basket');
    await waitForBasket();

    await user.type(screen.getByRole('searchbox', { name: t.search.queryLabel }), 'nocco bcaa');
    await user.click(screen.getByRole('button', { name: t.search.submit }));
    const card = await screen.findByRole('button', { name: 'Nocco BCAA Caribbean 330 ml' });
    await user.click(card);
    await user.click(await screen.findByRole('button', { name: t.search.back }));
    await user.click(await screen.findByRole('button', { name: 'Nocco BCAA Caribbean 330 ml' }));
    await user.click(await screen.findByRole('button', { name: t.search.confirmAndAdd }));

    const qty = await screen.findByRole('spinbutton', { name: t.items.qtyLabel('nocco bcaa') });
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('switch', { name: t.items.substitutesLabel('nocco bcaa') }));

    await waitFor(() => {
      const item = state.baskets.get(SEED_BASKET_ID)!.items.find((i) => i.query === 'nocco bcaa');
      expect(item).toMatchObject({
        qty: 3,
        acceptSubstitutes: true,
        pinned: { apotea: 'apotea-p09', gymgrossisten: 'gymgrossisten-p09' },
      });
    });

    await user.click(screen.getByRole('button', { name: t.items.removeLabel('nocco bcaa') }));
    await waitFor(() =>
      expect(state.baskets.get(SEED_BASKET_ID)!.items.some((i) => i.query === 'nocco bcaa')).toBe(
        false,
      ),
    );
  });

  it('renames a saved basket', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('basket');
    await waitForBasket();

    await user.click(screen.getByRole('button', { name: `${t.common.rename} Monthly restock` }));
    const input = screen.getByRole('textbox', { name: t.baskets.nameLabel });
    await user.clear(input);
    await user.type(input, 'Pharmacy run{Enter}');

    await waitFor(() => expect(state.baskets.get(SEED_BASKET_ID)!.name).toBe('Pharmacy run'));
  });
});
