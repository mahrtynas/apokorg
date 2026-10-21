import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '../strings';
import { renderApp, sekText } from '../test/render';
import { mockApi } from '../test/setup';

describe('recommended split', () => {
  it('grand total equals the store subtotals plus shipping', async () => {
    mockApi();
    renderApp('split');

    const stores = await screen.findAllByTestId('store-split');
    expect(stores.length).toBeGreaterThan(1);
    const sum = stores.reduce(
      (acc, el) => acc + Number(el.dataset.subtotal) + Number(el.dataset.shipping),
      0,
    );
    const grand = screen.getByTestId('grand-total');
    expect(Number(grand.dataset.value)).toBeCloseTo(sum, 2);
    expect(grand).toHaveTextContent(sekText(sum));

    // Lyko: 159 + 2 × 45 = 249 kr, 100 kr short of free shipping from 349 kr.
    const lyko = await screen.findByRole('article', { name: 'Lyko' });
    expect(within(lyko).getByText(t.split.toFreeShipping(sekText(100)))).toBeInTheDocument();
  });

  it('limits the number of stores', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('split');
    await screen.findAllByTestId('store-split');

    await user.selectOptions(screen.getByRole('combobox', { name: t.split.maxStores }), '1');
    await screen.findByText(t.split.stores(1), { exact: false });
    expect(screen.getAllByTestId('store-split')).toHaveLength(1);
  });

  it('verifies shipping at checkout with a spinner and badges', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('split');
    await screen.findAllByTestId('store-split');
    expect(screen.queryByText(t.split.verifiedBadge, { exact: false })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: new RegExp(t.split.verify) }));
    expect(await screen.findByText(t.split.verifying)).toBeInTheDocument();

    const doz = await screen.findByRole('article', { name: 'DOZ Apotek' });
    expect(
      await within(doz).findByText(t.split.verifiedBadge, { exact: false }),
    ).toBeInTheDocument();
    // Lyko has no checkout probe, so it stays unverified.
    const lyko = screen.getByRole('article', { name: 'Lyko' });
    expect(within(lyko).queryByText(t.split.verifiedBadge, { exact: false })).toBeNull();
  });
});
