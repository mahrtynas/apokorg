import { render } from '@testing-library/react';
import { App, type Tab } from '../App';
import { formatSek } from '../format';
import { AppProviders, createQueryClient } from '../providers';

export function renderApp(initialTab: Tab = 'basket') {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } });
  return render(
    <AppProviders client={client}>
      <App initialTab={initialTab} />
    </AppProviders>,
  );
}

/** formatSek with non-breaking spaces as plain spaces, the way Testing Library normalizes text. */
export const sekText = (value: number) => formatSek(value).replace(/\s/g, ' ');
