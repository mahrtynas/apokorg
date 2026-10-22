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
