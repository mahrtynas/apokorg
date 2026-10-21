import { useState } from 'react';
import type { BasketItem } from '@apokorg/core';
import { t } from '../strings';
import { Badge, Button, Card } from './ui';

/** Number field that lets you clear it while typing and only saves whole numbers ≥ 1. */
function QtyInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (qty: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>();
  return (
    <input
      type="number"
      min={1}
      step={1}
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const qty = Number(e.target.value);
        if (Number.isInteger(qty) && qty >= 1 && qty !== value) onCommit(qty);
      }}
      onBlur={() => setDraft(undefined)}
      className="w-16 rounded-md border border-slate-300 px-2 py-1"
    />
  );
}

export function ItemsTable({
  items,
  onChange,
  onChangeMatch,
}: {
  items: BasketItem[];
  onChange: (items: BasketItem[]) => void;
  onChangeMatch: (itemId: string) => void;
}) {
  const update = (id: string, patch: Partial<BasketItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">{t.items.heading}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t.common.emptyBasket}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
              <th className="py-2 font-medium">{t.items.query}</th>
              <th className="w-24 py-2 font-medium">{t.items.qty}</th>
              <th className="w-32 py-2 font-medium">{t.items.substitutes}</th>
              <th className="w-56 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const pinnedCount = Object.keys(item.pinned).length;
              return (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">
                    <div className="flex items-center gap-3">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded object-contain"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">{item.title ?? item.query}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {pinnedCount > 0 ? (
                            <Badge tone="green">{t.items.pinned(pinnedCount)}</Badge>
                          ) : (
                            <Badge>{t.items.autoMatched}</Badge>
                          )}
                          {item.title && (
                            <span className="text-xs text-slate-500">“{item.query}”</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2">
                    <QtyInput
                      label={t.items.qtyLabel(item.query)}
                      value={item.qty}
                      onCommit={(qty) => update(item.id, { qty })}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t.items.substitutesLabel(item.query)}
                      checked={item.acceptSubstitutes}
                      onChange={(e) => update(item.id, { acceptSubstitutes: e.target.checked })}
                      className="h-4 w-4 accent-emerald-700"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => onChangeMatch(item.id)}>
                      {t.items.changeMatch}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t.items.removeLabel(item.query)}
                      onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                    >
                      {t.common.remove}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
