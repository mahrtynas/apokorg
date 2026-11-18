import type { Assignment, MerchantId } from '@apokorg/core';
import { useFillCart, useMerchants } from '../api/hooks';
import { t } from '../strings';
import { Button, Spinner } from './ui';

/**
 * Puts one store's share of the split in that store's cart, in a browser window the server
 * opens, and leaves it on the checkout. Shown only for stores with a cart script.
 */
export function FillCartButton({
  merchantId,
  lines,
}: {
  merchantId: MerchantId;
  lines: Assignment[];
}) {
  const merchants = useMerchants();
  const fill = useFillCart();
  const supported = merchants.data?.merchants.find((m) => m.id === merchantId)?.cartFillSupported;
  if (!supported || lines.length === 0) return null;

  const result = fill.data;
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-sm">
      <div>
        <Button
          variant="primary"
          title={t.fillCart.hint}
          disabled={fill.isPending}
          onClick={() =>
            fill.mutate({
              merchantId,
              items: lines.map((a) => ({
                url: a.offer.url,
                merchantProductId: a.offer.merchantProductId,
                qty: a.qty,
              })),
            })
          }
        >
          {t.fillCart.button}
        </Button>
      </div>
      {fill.isPending && <Spinner label={t.fillCart.filling} />}
      {fill.error && (
        <p role="alert" className="text-red-800">
          {t.fillCart.failed(fill.error instanceof Error ? fill.error.message : String(fill.error))}
        </p>
      )}
      {result?.status === 'ok' && (
        <p role="status" className="text-emerald-800">
          {t.fillCart.done} {result.skipped.length > 0 && t.fillCart.skipped(result.skipped.length)}
        </p>
      )}
      {result?.status === 'unsupported' && (
        <p className="text-slate-600">{t.fillCart.unsupported}</p>
      )}
      {result?.status === 'failed' && (
        <p role="alert" className="text-red-800">
          {t.fillCart.failed(result.message ?? 'unknown error')}
        </p>
      )}
    </div>
  );
}
