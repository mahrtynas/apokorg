import type { Basket } from '@apokorg/core';
import { useOptimize, useRefreshOptimize } from '../api/hooks';
import { RefreshPrices } from '../components/RefreshPrices';
import {
  Badge,
  Card,
  ErrorBox,
  Notice,
  Spinner,
  StatusBadge,
  useMerchantName,
} from '../components/ui';
import { formatSek, formatUnitPrice } from '../format';
import { buildComparison, packPrice } from '../lib/comparison';
import { t } from '../strings';

/** Same request as the Split page's unprobed split with default options, so they share it. */
const REQUEST = { probe: false };

export function ComparisonPage({ basket, loading }: { basket?: Basket; loading: boolean }) {
  const hasItems = !!basket && basket.items.length > 0;
  const opt = useOptimize(basket?.id, REQUEST, hasItems);
  const refresh = useRefreshOptimize(basket?.id, REQUEST);
  const merchantName = useMerchantName();

  if (loading) return <Spinner />;
  if (!basket) return <Notice>{t.common.noBasket}</Notice>;
  if (!hasItems) return <Notice>{t.common.emptyBasket}</Notice>;
  if (opt.isPending) return <Spinner />;
  if (opt.error) return <ErrorBox error={opt.error} />;

  const statuses = opt.data.merchants;
  const rows = buildComparison(
    basket.items,
    opt.data.candidates,
    statuses.map((s) => s.merchantId),
  );

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t.compare.heading}</h1>
          <p className="text-xs text-slate-500">{t.compare.legend}</p>
        </div>
        <RefreshPrices refresh={refresh} data={opt.data} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th
                scope="col"
                className="sticky left-0 bg-white py-2 pr-3 font-medium text-slate-500"
              >
                {t.compare.item}
              </th>
              {statuses.map((s) => (
                <th key={s.merchantId} scope="col" className="min-w-32 px-2 py-2 font-semibold">
                  <div className="flex flex-col items-start gap-1">
                    <span>{merchantName(s.merchantId)}</span>
                    <StatusBadge status={s} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.item.id} className="border-b border-slate-100 last:border-0">
                <th scope="row" className="sticky left-0 bg-white py-2 pr-3 text-left font-medium">
                  {row.item.query}
                  {row.item.qty > 1 && (
                    <span className="ml-1 text-xs font-normal text-slate-500">×{row.item.qty}</span>
                  )}
                </th>
                {row.cells.map((cell) => {
                  const m = cell.match;
                  if (!m) {
                    return (
                      <td key={cell.merchantId} className="px-2 py-2 text-slate-300">
                        {t.compare.noOffer}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={cell.merchantId}
                      data-cheapest={cell.cheapest || undefined}
                      title={m.offer.title}
                      className={`px-2 py-2 align-top ${
                        cell.cheapest ? 'bg-emerald-50 ring-1 ring-emerald-300 ring-inset' : ''
                      } ${m.offer.inStock ? '' : 'text-slate-400'}`}
                    >
                      <div className={`font-medium ${m.offer.inStock ? '' : 'line-through'}`}>
                        {formatSek(packPrice(m))}
                      </div>
                      {m.packs && (
                        <div className="text-xs text-slate-500" title={t.packs.hint(m.packs)}>
                          {t.packs.times(m.packs, formatSek(m.offer.price))}
                        </div>
                      )}
                      {m.offer.unitPrice && (
                        <div className="text-xs text-slate-500">
                          {formatUnitPrice(m.offer.unitPrice)}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {cell.cheapest && <Badge tone="green">{t.match.cheapest}</Badge>}
                        {m.kind === 'substitute' && (
                          <Badge tone="amber">{t.match.substitute}</Badge>
                        )}
                        {!m.offer.inStock && <Badge>{t.match.outOfStock}</Badge>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
