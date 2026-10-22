import { useState } from 'react';
import type { api, Basket, DeliveryPreference, MerchantTotal, SplitResult } from '@apokorg/core';
import type { z } from 'zod';
import { useOptimize, useSettings } from '../api/hooks';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  KindBadge,
  Notice,
  Spinner,
  useMerchantName,
} from '../components/ui';
import { formatSek } from '../format';
import { t } from '../strings';

const MAX_STORE_CHOICES = [1, 2, 3, 4];

/** What is still missing to reach free shipping with the chosen option, if anything. */
export function leftToFreeShipping(total: MerchantTotal): number | undefined {
  const { freeFrom } = total.delivery;
  if (freeFrom === undefined || total.shipping === 0 || total.subtotal >= freeFrom)
    return undefined;
  return Math.round((freeFrom - total.subtotal) * 100) / 100;
}

export function SplitPage({ basket, loading }: { basket?: Basket; loading: boolean }) {
  const settings = useSettings();
  const [maxMerchants, setMaxMerchants] = useState<number | undefined>();
  const [delivery, setDelivery] = useState<DeliveryPreference | undefined>();
  const [probeRequested, setProbeRequested] = useState(false);
  const hasItems = !!basket && basket.items.length > 0;

  const options: NonNullable<z.input<typeof api.OptimizeRequest>['options']> = {};
  if (maxMerchants !== undefined) options.maxMerchants = maxMerchants;
  if (delivery !== undefined) options.delivery = delivery;
  const base = Object.keys(options).length ? { options } : {};

  const plain = useOptimize(basket?.id, { ...base, probe: false }, hasItems);
  const probed = useOptimize(basket?.id, { ...base, probe: true }, hasItems && probeRequested);
  const opt = probeRequested && probed.data ? probed : plain;

  if (loading) return <Spinner />;
  if (!basket) return <Notice>{t.common.noBasket}</Notice>;
  if (!hasItems) return <Notice>{t.common.emptyBasket}</Notice>;

  const effectiveDelivery = delivery ?? settings.data?.delivery ?? 'cheapest';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <h1 className="mr-auto text-lg font-semibold">{t.split.heading}</h1>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.split.maxStores}</span>
            <select
              value={maxMerchants ?? ''}
              onChange={(e) => {
                setProbeRequested(false);
                setMaxMerchants(e.target.value ? Number(e.target.value) : undefined);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            >
              <option value="">{t.split.anyNumber}</option>
              {MAX_STORE_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.split.delivery}</span>
            <select
              value={effectiveDelivery}
              onChange={(e) => {
                setProbeRequested(false);
                setDelivery(e.target.value as DeliveryPreference);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            >
              <option value="cheapest">{t.split.deliveryCheapest}</option>
              <option value="home-only">{t.split.deliveryHomeOnly}</option>
              <option value="include-store-pickup">{t.split.deliveryIncludeStorePickup}</option>
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={() => (probeRequested ? void probed.refetch() : setProbeRequested(true))}
            disabled={probed.isFetching}
          >
            ✓ {t.split.verify}
          </Button>
        </div>
        {probed.isFetching && (
          <div className="mt-3">
            <Spinner label={t.split.verifying} />
          </div>
        )}
        {probed.error && (
          <div className="mt-3">
            <ErrorBox error={probed.error} />
          </div>
        )}
      </Card>

      {opt.isPending && <Spinner />}
      {opt.error && <ErrorBox error={opt.error} />}
      {opt.data && <SplitView basket={basket} split={opt.data.split} />}
    </div>
  );
}

export function SplitView({ basket, split }: { basket: Basket; split: SplitResult }) {
  const merchantName = useMerchantName();
  const itemName = (id: string) => basket.items.find((i) => i.id === id)?.query ?? id;

  return (
    <div className="grid grid-cols-[1fr_18rem] items-start gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {split.perMerchant.map((m) => {
          const lines = split.assignments.filter((a) => a.merchantId === m.merchantId);
          const left = leftToFreeShipping(m);
          return (
            <Card key={m.merchantId}>
              <article
                data-testid="store-split"
                data-subtotal={m.subtotal}
                data-shipping={m.shipping}
                aria-label={merchantName(m.merchantId)}
              >
                <header className="mb-2 flex items-center gap-2">
                  <h2 className="text-base font-semibold">{merchantName(m.merchantId)}</h2>
                  {m.probeVerified && <Badge tone="green">✓ {t.split.verifiedBadge}</Badge>}
                </header>
                <ul className="mb-3 divide-y divide-slate-100 text-sm">
                  {lines.map((a) => (
                    <li key={a.itemId} className="flex items-start gap-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{itemName(a.itemId)}</div>
                        <div className="truncate text-xs text-slate-500" title={a.offer.title}>
                          {a.offer.title}
                        </div>
                      </div>
                      {a.kind !== 'exact' && <KindBadge kind={a.kind} />}
                      <div className="text-right whitespace-nowrap">
                        <div>{formatSek(a.lineTotal)}</div>
                        {a.qty > 1 && (
                          <div className="text-xs text-slate-500">
                            {a.qty} × {formatSek(a.offer.price)}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-sm">
                  <dt className="text-slate-600">{t.split.subtotal}</dt>
                  <dd className="text-right">{formatSek(m.subtotal)}</dd>
                  <dt className="text-slate-600">
                    {t.split.shipping}{' '}
                    <span className="text-xs text-slate-500">
                      ({m.delivery.name}, {t.deliveryKind[m.delivery.kind].toLowerCase()})
                    </span>
                  </dt>
                  <dd className="text-right">
                    {m.shipping === 0 ? t.common.free : formatSek(m.shipping)}
                  </dd>
                  <dt className="font-semibold">{t.split.storeTotal}</dt>
                  <dd className="text-right font-semibold">{formatSek(m.subtotal + m.shipping)}</dd>
                </dl>
                {left !== undefined && (
                  <p className="mt-2 text-xs text-amber-800">
                    {t.split.toFreeShipping(formatSek(left))}
                  </p>
                )}
              </article>
            </Card>
          );
        })}
      </div>

      <Card className="sticky top-4">
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-slate-600">
              {t.split.grandTotal} · {t.split.stores(split.perMerchant.length)}
            </dt>
            <dd
              data-testid="grand-total"
              data-value={split.total}
              className="text-2xl font-semibold"
            >
              {formatSek(split.total)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">{t.split.bestSingle}</dt>
            <dd>
              {split.bestSingleMerchant ? (
                <>
                  {merchantName(split.bestSingleMerchant.merchantId)}:{' '}
                  <span className="font-medium">{formatSek(split.bestSingleMerchant.total)}</span>
                </>
              ) : (
                <span className="text-slate-500">{t.split.noSingle}</span>
              )}
            </dd>
          </div>
          {split.savingsVsBestSingle !== undefined && (
            <div>
              <dt className="text-slate-600">{t.split.savings}</dt>
              <dd
                className={`text-lg font-semibold ${split.savingsVsBestSingle > 0 ? 'text-emerald-700' : ''}`}
              >
                {formatSek(split.savingsVsBestSingle)}
              </dd>
            </div>
          )}
          {split.unavailableItemIds.length > 0 && (
            <div>
              <dt className="text-red-700">{t.split.unavailable}</dt>
              <dd>
                <ul className="list-inside list-disc">
                  {split.unavailableItemIds.map((id) => (
                    <li key={id}>{itemName(id)}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}
