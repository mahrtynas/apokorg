import type { api } from '@apokorg/core';
import type { useRefreshOptimize } from '../api/hooks';
import { formatDateTime } from '../format';
import { t } from '../strings';
import { Button, ErrorBox, Spinner } from './ui';

/** The oldest `fetchedAt` among the offers behind an optimize result, if any. */
export function oldestFetchedAt(
  candidates: api.OptimizeResponse['candidates'],
): string | undefined {
  let oldest: string | undefined;
  for (const c of candidates) {
    for (const m of c.matches) {
      if (!oldest || Date.parse(m.offer.fetchedAt) < Date.parse(oldest)) oldest = m.offer.fetchedAt;
    }
  }
  return oldest;
}

/**
 * "Refresh prices": re-runs optimize with every store searched again, with a spinner while it
 * runs and the age of the oldest price shown.
 */
export function RefreshPrices({
  refresh,
  data,
  onRefresh,
}: {
  refresh: ReturnType<typeof useRefreshOptimize>;
  data?: api.OptimizeResponse;
  onRefresh?: () => void;
}) {
  const fetchedAt = data && oldestFetchedAt(data.candidates);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {refresh.isPending ? (
          <Spinner label={t.refresh.running} />
        ) : (
          fetchedAt && (
            <span className="text-xs text-slate-500" title={t.refresh.fetchedAtHint}>
              {t.refresh.fetchedAt(formatDateTime(fetchedAt))}
            </span>
          )
        )}
        <Button
          variant="secondary"
          title={t.refresh.hint}
          disabled={refresh.isPending}
          onClick={() => {
            onRefresh?.();
            refresh.mutate();
          }}
        >
          ↻ {t.refresh.button}
        </Button>
      </div>
      {refresh.error && <ErrorBox error={refresh.error} />}
    </div>
  );
}
