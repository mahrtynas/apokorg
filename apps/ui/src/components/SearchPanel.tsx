import { useEffect, useMemo, useState } from 'react';
import type { api, BasketItem, MatchResult, MerchantId } from '@apokorg/core';
import { useSearch } from '../api/hooks';
import { formatSek, formatUnitPrice } from '../format';
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
  const search = useSearch();
  const merchantName = useMerchantName();
  const [query, setQuery] = useState(editing?.query ?? '');
  const [acceptSubstitutes, setAcceptSubstitutes] = useState(editing?.acceptSubstitutes ?? false);
  const [picked, setPicked] = useState<Pinned>({});
  const [changed, setChanged] = useState<Set<MerchantId>>(new Set());

  const run = (q: string) => {
    if (!q.trim()) return;
    setPicked({});
    setChanged(new Set());
    search.mutate({ query: q.trim(), acceptSubstitutes });
  };

  // When changing an existing item's match, search for it straight away.
  useEffect(() => {
    if (editing) run(editing.query);
    // Once per item being edited (the panel is keyed by it).
  }, [editing?.id]);

  const res = search.data;
  const groups = useMemo(() => (res ? groupByMerchant(res) : []), [res]);

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

  const hasResults = groups.some((g) => g.matches.length > 0);

  const submit = () => {
    if (!res) return;
    if (editing) {
      onRepin(editing.id, selection);
      return;
    }
    // Pin what the user confirmed: everything when asked to confirm, else the stores they changed.
    const pinned: Pinned = {};
    for (const [id, productId] of Object.entries(selection) as [MerchantId, string][]) {
      if (res.needsConfirmation || changed.has(id)) pinned[id] = productId;
    }
    onAdd({ id: newId(), query: res.query, qty: 1, acceptSubstitutes, pinned });
    search.reset();
    setQuery('');
    setAcceptSubstitutes(false);
  };

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">
        {editing ? t.search.changeHeading(editing.query) : t.search.heading}
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
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
        {!editing && (
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
        )}
        <Button type="submit" variant="primary" disabled={!query.trim() || search.isPending}>
          {t.search.submit}
        </Button>
        {editing && (
          <Button variant="ghost" onClick={onCancelEdit}>
            {t.common.cancel}
          </Button>
        )}
      </form>

      {search.isPending && (
        <div className="mt-4">
          <Spinner label={t.search.searching} />
        </div>
      )}
      {search.error && (
        <div className="mt-4">
          <ErrorBox error={search.error} />
        </div>
      )}

      {res && (
        <div className="mt-4 flex flex-col gap-3">
          {res.needsConfirmation && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {t.search.needsConfirmation}
            </div>
          )}
          {!hasResults && <p className="text-sm text-slate-500">{t.search.noResults}</p>}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {groups.map((g) => (
              <fieldset
                key={g.status.merchantId}
                className="rounded-md border border-slate-200 p-3"
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
                            onChange={() => {
                              setPicked((p) => ({ ...p, [id]: productId }));
                              setChanged((c) => new Set(c).add(id));
                            }}
                            className="mt-1 accent-emerald-700"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate" title={m.offer.title}>
                              {m.offer.title}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <span className="font-medium text-slate-800">
                                {formatSek(m.offer.price)}
                              </span>
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
          {hasResults && (
            <div>
              <Button variant="primary" onClick={submit}>
                {editing
                  ? t.search.confirm
                  : res.needsConfirmation
                    ? t.search.confirmAndAdd
                    : t.search.add}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
