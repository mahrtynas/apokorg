import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { api, Basket } from '@apokorg/core';
import { useDeleteBasket, useSaveBasket } from '../api/hooks';
import { formatDate } from '../format';
import { newId } from '../lib/id';
import { t } from '../strings';
import { Button, Card } from './ui';

export function SavedBaskets({
  query,
  currentId,
  onSelect,
}: {
  query: UseQueryResult<api.BasketsResponse>;
  currentId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const save = useSaveBasket();
  const remove = useDeleteBasket();
  const [renaming, setRenaming] = useState<string | undefined>();
  const baskets = query.data?.baskets ?? [];

  const create = () => {
    const id = newId();
    save.mutate({ id, name: t.baskets.defaultName, items: [] }, { onSuccess: () => onSelect(id) });
  };

  const del = (b: Basket) => {
    if (!window.confirm(t.baskets.confirmDelete(b.name))) return;
    remove.mutate(b.id, {
      onSuccess: () => {
        if (b.id === currentId) onSelect(baskets.find((x) => x.id !== b.id)?.id);
      },
    });
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t.baskets.heading}</h2>
        <Button variant="ghost" onClick={create} disabled={save.isPending}>
          + {t.baskets.newBasket}
        </Button>
      </div>
      {query.isSuccess && baskets.length === 0 && (
        <p className="text-sm text-slate-500">{t.baskets.none}</p>
      )}
      <ul className="flex flex-col gap-1">
        {baskets.map((b) => (
          <li key={b.id}>
            {renaming === b.id ? (
              <RenameForm
                basket={b}
                onDone={(name) => {
                  setRenaming(undefined);
                  if (name && name !== b.name) save.mutate({ ...b, name });
                }}
              />
            ) : (
              <div
                className={`group flex items-center gap-1 rounded-md ${
                  b.id === currentId ? 'bg-emerald-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  aria-current={b.id === currentId ? 'true' : undefined}
                  onClick={() => onSelect(b.id)}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left"
                >
                  <div
                    className={`truncate text-sm ${b.id === currentId ? 'font-semibold text-emerald-900' : ''}`}
                  >
                    {b.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t.baskets.itemCount(b.items.length)} · {formatDate(b.updatedAt)}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  className="px-1.5! text-xs"
                  aria-label={`${t.common.rename} ${b.name}`}
                  onClick={() => setRenaming(b.id)}
                >
                  ✎
                </Button>
                <Button
                  variant="danger"
                  className="px-1.5! text-xs"
                  aria-label={`${t.common.delete} ${b.name}`}
                  onClick={() => del(b)}
                >
                  ✕
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RenameForm({ basket, onDone }: { basket: Basket; onDone: (name?: string) => void }) {
  const [name, setName] = useState(basket.name);
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(name.trim());
      }}
    >
      <input
        autoFocus
        aria-label={t.baskets.nameLabel}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <Button type="submit" variant="primary" className="px-2!">
        {t.common.save}
      </Button>
    </form>
  );
}
