import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { api, MatchKind, MerchantId } from '@apokorg/core';
import { useMerchants } from '../api/hooks';
import { t } from '../strings';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-700/50',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'text-red-700 hover:bg-red-50 disabled:text-red-300',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue';

const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
};

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function KindBadge({ kind }: { kind: MatchKind }) {
  const tone: Tone = kind === 'exact' ? 'green' : kind === 'equivalent' ? 'blue' : 'amber';
  return <Badge tone={tone}>{t.match[kind]}</Badge>;
}

export function StatusBadge({ status }: { status: api.MerchantSearchStatus }) {
  if (status.status === 'ok') return null;
  return (
    <span title={status.message}>
      <Badge tone={status.status === 'unavailable' ? 'slate' : 'red'}>
        {t.status[status.status]}
      </Badge>
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-700"
      />
      {label ?? t.common.loading}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {t.common.error(msg)}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

/** Display name per merchant id, falling back to the id while merchants load. */
export function useMerchantName(): (id: MerchantId) => string {
  const { data } = useMerchants();
  return (id) => data?.merchants.find((m) => m.id === id)?.name ?? id;
}
