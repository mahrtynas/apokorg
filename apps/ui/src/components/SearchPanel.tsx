import { useEffect, useMemo, useState } from 'react';
import type { api, BasketItem, MatchResult, MerchantId } from '@apokorg/core';
import { useLocate, useProductSearch } from '../api/hooks';
import { formatSek, formatUnitPrice } from '../format';
import { packPrice } from '../lib/comparison';
import { newId } from '../lib/id';
import { t } from '../strings';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  KindBadge,
  Spinner,
  StatusBadge,
  useMerchantName,
} from './ui';

type Pinned = BasketItem['pinned'];
type Chosen = Pick<api.ProductCandidate, 'title' | 'ean' | 'imageUrl' | 'size' | 'packCount'>;

interface Group {
  status: api.MerchantSearchStatus;
  matches: MatchResult[];
}

/** Groups search results by store, in the order the server reported the stores. */
export function groupByMerchant(res: api.SearchResponse): Group[] {
  const groups = new Map<MerchantId, Group>();
  for (const status of res.merchants) groups.set(status.merchantId, { status, matches: [] });
  for (const m of res.results) {
    const id = m.offer.merchantId;
    if (!groups.has(id)) {
      groups.set(id, { status: { merchantId: id, status: 'ok', tookMs: 0 }, matches: [] });
    }
    groups.get(id)!.matches.push(m);
  }
  return [...groups.values()];
}

function Thumb({ src, alt, size = 'h-16 w-16' }: { src?: string; alt: string; size?: string }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className={`${size} shrink-0 rounded object-contain`} />
  ) : (
    <div className={`${size} shrink-0 rounded bg-slate-100`} aria-hidden />
  );
}

/**
 * Adding an item takes two steps: search and pick a product, independent of store; then the
 * server looks for that product at every store and the user confirms the match per store.
 * Changing an existing item's match starts at step two.
 */
export function SearchPanel({
  editing,
  onAdd,
  onRepin,
  onCancelEdit,
}: {
  editing?: BasketItem;
  onAdd: (item: BasketItem) => void;
  onRepin: (itemId: string, pinned: Pinned) => void;
  onCancelEdit: () => void;
}) {
  const products = useProductSearch();
  const locate = useLocate();
  const merchantName = useMerchantName();
  const [query, setQuery] = useState(editing?.query ?? '');
  const [acceptSubstitutes, setAcceptSubstitutes] = useState(editing?.acceptSubstitutes ?? false);
  const [chosen, setChosen] = useState<Chosen | undefined>();
  const [picked, setPicked] = useState<Pinned>({});

  const runSearch = (q: string) => {
    if (!q.trim()) return;
    setChosen(undefined);
    locate.reset();
    products.mutate({ query: q.trim() });
  };

  const choose = (q: string, product: Chosen) => {
    setChosen(product);
    setPicked({});
    locate.mutate({
      query: q,
      product: {
        title: product.title,
        ean: product.ean,
        size: product.size,
        packCount: product.packCount,
      },
      acceptSubstitutes,
    });
  };

  // When changing an existing item's match, go straight to locating it.
  useEffect(() => {
    if (editing) {
      choose(editing.query, {
        title: editing.title ?? editing.query,
        ean: editing.ean,
        imageUrl: editing.imageUrl,
        size: editing.size,
        packCount: editing.packCount,
      });
    }
    // Once per item being edited (the panel is keyed by it).
  }, [editing?.id]);

  const located = locate.data;
  const groups = useMemo(() => (located ? groupByMerchant(located) : []), [located]);

  /** The selected merchantProductId per store: user's pick, else existing pin, else best. */
  const selection = useMemo(() => {
    const sel: Pinned = {};
    for (const g of groups) {
      const id = g.status.merchantId;
      const ids = g.matches.map((m) => m.offer.merchantProductId);
      const choice = [picked[id], editing?.pinned[id], ids[0]].find((x) => x && ids.includes(x));
      if (choice) sel[id] = choice;
    }
    return sel;
  }, [groups, picked, editing]);

  const hasMatches = groups.some((g) => g.matches.length > 0);

  const reset = () => {
    products.reset();
    locate.reset();
    setChosen(undefined);
    setQuery('');
    setAcceptSubstitutes(false);
  };

  const submit = () => {
    if (!located || !chosen) return;
    if (editing) {
      onRepin(editing.id, selection);
      return;
    }
    // The user confirmed every store's match, so pin them all.
    onAdd({
      id: newId(),
      query: located.query,
      qty: 1,
      acceptSubstitutes,
      pinned: selection,
      title: chosen.title,
      ean: chosen.ean,
      imageUrl: chosen.imageUrl,
      size: chosen.size,
      packCount: chosen.packCount,
    });
    reset();
  };

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">
        {editing ? t.search.changeHeading(editing.title ?? editing.query) : t.search.heading}
      </h2>

      {!editing && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.search.queryLabel}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search.queryPlaceholder}
              className="rounded-md border border-slate-300 px-3 py-1.5"
            />
          </label>
          <label
            className="flex items-center gap-2 py-1.5 text-sm"
            title={t.search.acceptSubstitutesHint}
          >
            <input
              type="checkbox"
              role="switch"
              checked={acceptSubstitutes}
              onChange={(e) => setAcceptSubstitutes(e.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            {t.search.acceptSubstitutes}
          </label>
          <Button type="submit" variant="primary" disabled={!query.trim() || products.isPending}>
            {t.search.submit}
          </Button>
        </form>
      )}

      {products.isPending && (
        <div className="mt-4">
          <Spinner label={t.search.searching} />
        </div>
      )}
      {(products.error ?? locate.error) && (
        <div className="mt-4">
          <ErrorBox error={products.error ?? locate.error} />
        </div>
      )}

      {/* Step 1: pick a product, independent of store. */}
      {products.data && !chosen && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {t.search.pickProduct}
            {products.data.merchants
              .filter((s) => s.status !== 'ok')
              .map((s) => (
                <span key={s.merchantId} className="flex items-center gap-1">
                  {merchantName(s.merchantId)} <StatusBadge status={s} />
                </span>
              ))}
          </div>
          {products.data.products.length === 0 && (
            <p className="text-sm text-slate-500">{t.search.noResults}</p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {products.data.products.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-label={p.title}
                onClick={() => choose(products.data!.query, p)}
                className="flex gap-3 rounded-md border border-slate-200 p-3 text-left hover:border-emerald-600 hover:bg-emerald-50"
              >
                <Thumb src={p.imageUrl} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium" title={p.title}>
                    {p.title}
                  </span>
                  <span className="mt-1 block text-sm text-slate-800">
                    {t.search.priceRange(formatSek(p.minPrice), formatSek(p.maxPrice))}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge>{t.search.storeCount(p.merchantIds.length)}</Badge>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: the chosen product at every store; confirm per store. */}
      {chosen && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
            <Thumb src={chosen.imageUrl} alt="" size="h-12 w-12" />
            <div className="min-w-0 flex-1 text-sm font-medium">{chosen.title}</div>
            {editing ? (
              <Button variant="ghost" onClick={onCancelEdit}>
                {t.common.cancel}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setChosen(undefined);
                  locate.reset();
                }}
              >
                {t.search.back}
              </Button>
            )}
          </div>

          {locate.isPending && <Spinner label={t.search.locating} />}

          {located && (
            <>
              <p className="text-sm text-slate-600">{t.search.confirmStores}</p>
              {!hasMatches && <p className="text-sm text-slate-500">{t.search.noResults}</p>}
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {groups.map((g) => (
                  // min-w-0: a fieldset's default min-width is its content, which would push long
                  // titles past the grid column.
                  <fieldset
                    key={g.status.merchantId}
                    className="min-w-0 rounded-md border border-slate-200 p-3"
                  >
                    <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                      {merchantName(g.status.merchantId)}
                      <StatusBadge status={g.status} />
                    </legend>
                    {g.matches.length === 0 ? (
                      <p className="text-xs text-slate-500">{t.search.storeHasNoResults}</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {g.matches.map((m) => {
                          const id = g.status.merchantId;
                          const productId = m.offer.merchantProductId;
                          return (
                            <label
                              key={productId}
                              className={`flex cursor-pointer gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50 ${
                                m.offer.inStock ? '' : 'text-slate-400'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`pick-${id}`}
                                aria-label={`${merchantName(id)}: ${m.offer.title}`}
                                checked={selection[id] === productId}
                                onChange={() => setPicked((p) => ({ ...p, [id]: productId }))}
                                className="mt-1 accent-emerald-700"
                              />
                              <Thumb src={m.offer.imageUrl} alt="" size="h-10 w-10" />
                              <span className="min-w-0 flex-1">
                                {/* Two lines: the words that tell variants apart are often at the end. */}
                                <span className="line-clamp-2 break-words" title={m.offer.title}>
                                  {m.offer.title}
                                </span>
                                <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                  <span className="font-medium text-slate-800">
                                    {formatSek(packPrice(m))}
                                  </span>
                                  {m.packs && (
                                    <span title={t.packs.hint(m.packs)}>
                                      {t.packs.times(m.packs, formatSek(m.offer.price))}
                                    </span>
                                  )}
                                  {formatUnitPrice(m.offer.unitPrice)}
                                  <KindBadge kind={m.kind} />
                                  {!m.offer.inStock && <Badge>{t.match.outOfStock}</Badge>}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>
                ))}
              </div>
              {hasMatches && (
                <div>
                  <Button variant="primary" onClick={submit}>
                    {editing ? t.search.confirm : t.search.confirmAndAdd}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
