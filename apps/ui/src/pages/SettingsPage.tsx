import { useState } from 'react';
import {
  DeliveryKind,
  Settings,
  ShippingPolicy,
  type api,
  type DeliveryOption,
  type MerchantId,
} from '@apokorg/core';
import { useMerchants, useSaveSettings, useSaveShipping, useSettings } from '../api/hooks';
import { Badge, Button, Card, ErrorBox, Spinner } from '../components/ui';
import { daysSince } from '../format';
import { t } from '../strings';

const STALE_DAYS = 90;
type MerchantRow = api.MerchantsResponse['merchants'][number];

export function SettingsPage() {
  const settings = useSettings();
  const merchants = useMerchants();
  if (settings.isPending || merchants.isPending) return <Spinner />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  if (merchants.error) return <ErrorBox error={merchants.error} />;
  return (
    <div className="flex flex-col gap-6">
      <SettingsForm initial={settings.data} merchants={merchants.data.merchants} />
      <Card>
        <h2 className="mb-3 text-base font-semibold">{t.settings.shippingHeading}</h2>
        <div className="flex flex-col gap-4">
          {merchants.data.merchants.map((m) => (
            <ShippingEditor key={m.id} merchant={m} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function toggle(list: MerchantId[], id: MerchantId, on: boolean): MerchantId[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

const inputCls = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm';

function SettingsForm({ initial, merchants }: { initial: Settings; merchants: MerchantRow[] }) {
  const save = useSaveSettings();
  const [form, setForm] = useState<Settings>(initial);
  const [newKey, setNewKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const set = (patch: Partial<Settings>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    const next: Settings = {
      ...form,
      probeEmail: form.probeEmail?.trim() || undefined,
      // The server returns the key masked; sending the masked value back keeps it.
      anthropicApiKey: removeKey ? '' : newKey.trim() || initial.anthropicApiKey,
    };
    const parsed = Settings.safeParse(next);
    setInvalid(!parsed.success);
    if (parsed.success) {
      save.mutate(parsed.data, {
        onSuccess: () => {
          setNewKey('');
          setRemoveKey(false);
        },
      });
    }
  };

  return (
    <Card>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1 className="text-lg font-semibold">{t.settings.heading}</h1>
        <div className="grid grid-cols-2 gap-6">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t.settings.stores}</legend>
            <div className="flex flex-col gap-1.5">
              {merchants.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-700"
                    checked={form.enabledMerchants.includes(m.id)}
                    onChange={(e) =>
                      set({
                        enabledMerchants: toggle(form.enabledMerchants, m.id, e.target.checked),
                      })
                    }
                  />
                  {m.name}
                  <span className="text-xs text-slate-500">{m.category}</span>
                  {!m.probeSupported && <Badge>{t.settings.probeUnsupported}</Badge>}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t.settings.memberships}</legend>
            <p className="mb-2 text-xs text-slate-500">{t.settings.membershipsHint}</p>
            <div className="flex flex-col gap-1.5">
              {merchants.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-700"
                    aria-label={`${t.settings.memberships}: ${m.name}`}
                    checked={form.memberOf.includes(m.id)}
                    onChange={(e) =>
                      set({ memberOf: toggle(form.memberOf, m.id, e.target.checked) })
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t.settings.postcode}</span>
            <input
              className={`${inputCls} w-32`}
              inputMode="numeric"
              pattern="\d{3}\s?\d{2}"
              value={form.postcode}
              onChange={(e) => set({ postcode: e.target.value })}
            />
            <span className="text-xs text-slate-500">{t.settings.postcodeHint}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t.settings.probeEmail}</span>
            <input
              type="email"
              className={inputCls}
              value={form.probeEmail ?? ''}
              placeholder="you+apokorg@gmail.com"
              onChange={(e) => set({ probeEmail: e.target.value })}
            />
            <span className="text-xs text-slate-500">{t.settings.probeEmailHint}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 accent-emerald-700"
              checked={form.probeEnabled}
              onChange={(e) => set({ probeEnabled: e.target.checked })}
            />
            {t.settings.probeEnabled}
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t.settings.apiKey}</span>
              <input
                type="password"
                autoComplete="off"
                className={inputCls}
                value={newKey}
                disabled={removeKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </label>
            <span className="text-xs text-slate-500">
              {initial.anthropicApiKey && !removeKey
                ? t.settings.apiKeySaved(initial.anthropicApiKey)
                : t.settings.apiKeyHint}
            </span>
            {initial.anthropicApiKey && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={removeKey}
                  onChange={(e) => setRemoveKey(e.target.checked)}
                />
                {t.settings.apiKeyRemove}
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t.common.saving : t.common.save}
          </Button>
          {save.isSuccess && <span className="text-sm text-emerald-700">{t.common.saved}</span>}
          {invalid && <span className="text-sm text-red-700">{t.settings.invalid}</span>}
        </div>
        {save.error && <ErrorBox error={save.error} />}
      </form>
    </Card>
  );
}

const optionalNumber = (v: string) => (v.trim() === '' ? undefined : Number(v));

function ShippingEditor({ merchant }: { merchant: MerchantRow }) {
  const save = useSaveShipping();
  const [policy, setPolicy] = useState<ShippingPolicy | undefined>(merchant.shipping);
  const [invalid, setInvalid] = useState(false);

  if (!policy) {
    return (
      <div className="text-sm">
        <span className="font-medium">{merchant.name}</span>{' '}
        <span className="text-slate-500">{t.settings.noShipping}</span>
      </div>
    );
  }

  const age = daysSince(policy.lastVerified);
  const setOption = (i: number, patch: Partial<DeliveryOption>) =>
    setPolicy({
      ...policy,
      options: policy.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    });

  const submit = () => {
    const parsed = ShippingPolicy.safeParse(policy);
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate({ merchantId: merchant.id, policy: parsed.data });
  };

  return (
    <section aria-label={merchant.name} className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">{merchant.name}</h3>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          {t.settings.lastVerified}
          <input
            type="date"
            className={`${inputCls} py-0.5`}
            value={policy.lastVerified}
            onChange={(e) => setPolicy({ ...policy, lastVerified: e.target.value })}
          />
        </label>
        {age > STALE_DAYS && (
          <span role="alert">
            <Badge tone="amber">⚠ {t.settings.staleWarning(age)}</Badge>
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="font-medium">{t.settings.optionName}</th>
            <th className="font-medium">{t.settings.optionKind}</th>
            <th className="font-medium">{t.settings.optionFee}</th>
            <th className="font-medium">{t.settings.optionFreeFrom}</th>
            <th className="font-medium">{t.settings.optionMinOrder}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {policy.options.map((o, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input
                  aria-label={`${merchant.name} ${t.settings.optionName} ${i + 1}`}
                  className={`${inputCls} w-full py-1`}
                  value={o.name}
                  onChange={(e) => setOption(i, { name: e.target.value })}
                />
              </td>
              <td className="py-1 pr-2">
                <select
                  aria-label={`${merchant.name} ${t.settings.optionKind} ${i + 1}`}
                  className={`${inputCls} bg-white py-1`}
                  value={o.kind}
                  onChange={(e) => setOption(i, { kind: e.target.value as DeliveryOption['kind'] })}
                >
                  {DeliveryKind.options.map((k) => (
                    <option key={k} value={k}>
                      {t.deliveryKind[k]}
                    </option>
                  ))}
                </select>
              </td>
              {(['fee', 'freeFrom', 'minOrder'] as const).map((field) => (
                <td key={field} className="py-1 pr-2">
                  <input
                    type="number"
                    min={0}
                    aria-label={`${merchant.name} ${field} ${i + 1}`}
                    className={`${inputCls} w-24 py-1`}
                    value={o[field] ?? ''}
                    onChange={(e) =>
                      setOption(i, {
                        [field]:
                          field === 'fee'
                            ? Number(e.target.value || 0)
                            : optionalNumber(e.target.value),
                      })
                    }
                  />
                </td>
              ))}
              <td className="py-1 text-right">
                <Button
                  variant="danger"
                  disabled={policy.options.length <= 1}
                  onClick={() =>
                    setPolicy({ ...policy, options: policy.options.filter((_, j) => j !== i) })
                  }
                >
                  {t.common.remove}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            setPolicy({
              ...policy,
              options: [
                ...policy.options,
                {
                  id: `option-${policy.options.length + 1}`,
                  name: '',
                  kind: 'pickup-point',
                  fee: 0,
                },
              ],
            })
          }
        >
          + {t.settings.addOption}
        </Button>
        <Button variant="primary" onClick={submit} disabled={save.isPending}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
        {save.isSuccess && <span className="text-sm text-emerald-700">{t.common.saved}</span>}
        {invalid && <span className="text-sm text-red-700">{t.settings.invalid}</span>}
        {save.error && <ErrorBox error={save.error} />}
      </div>
    </section>
  );
}
