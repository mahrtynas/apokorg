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
  it('adds an item and pins the confirmed match', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('basket');
    await waitForBasket();

    await user.type(screen.getByRole('searchbox', { name: t.search.queryLabel }), 'whey{Enter}');

    // Two whey products fit equally well, so the server asks for confirmation.
    expect(await screen.findByText(t.search.needsConfirmation)).toBeInTheDocument();
    const gym = screen.getByRole('radio', {
      name: 'Gymgrossisten: Star Nutrition Whey-80 1 kg Chocolate',
    });
    expect(gym).not.toBeChecked();
    await user.click(gym);
    expect(gym).toBeChecked();

    await user.click(screen.getByRole('button', { name: t.search.confirmAndAdd }));

    const row = (await screen.findByRole('cell', { name: /^whey/ })).closest('tr')!;
    expect(within(row).getByText(t.items.pinned(2))).toBeInTheDocument();
    await waitFor(() => {
      const added = state.baskets.get(SEED_BASKET_ID)!.items.at(-1)!;
      expect(added.query).toBe('whey');
      expect(added.acceptSubstitutes).toBe(false);
      expect(added.pinned).toEqual({
        apotea: 'apotea-p08',
        gymgrossisten: 'gymgrossisten-p07',
      });
    });
  });

  it('adds a clear match without pinning, and edits quantity and substitutes', async () => {
    const state = mockApi();
    const user = userEvent.setup();
    renderApp('basket');
    await waitForBasket();

    await user.type(screen.getByRole('searchbox', { name: t.search.queryLabel }), 'nocco bcaa');
    await user.click(screen.getByRole('button', { name: t.search.submit }));
    await user.click(await screen.findByRole('button', { name: t.search.add }));
    expect(screen.queryByText(t.search.needsConfirmation)).not.toBeInTheDocument();

    const qty = await screen.findByRole('spinbutton', { name: t.items.qtyLabel('nocco bcaa') });
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('switch', { name: t.items.substitutesLabel('nocco bcaa') }));

    await waitFor(() => {
      const item = state.baskets.get(SEED_BASKET_ID)!.items.find((i) => i.query === 'nocco bcaa');
      expect(item).toMatchObject({ qty: 3, acceptSubstitutes: true, pinned: {} });
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
