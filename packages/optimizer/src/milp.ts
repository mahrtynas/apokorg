import highsLoader, { type Highs } from 'highs';

/** A small 0/1 integer program. Every variable is binary. */
export interface BinaryProgram {
  /** Objective coefficients by variable name (minimised). Variables must be declared here. */
  objective: Map<string, number>;
  constraints: Constraint[];
}

export interface Constraint {
  terms: [name: string, coef: number][];
  op: '<=' | '>=' | '=';
  rhs: number;
}

let highsPromise: Promise<Highs> | undefined;

/** Loads the HiGHS wasm runtime once per process. */
export function loadHighs(): Promise<Highs> {
  highsPromise ??= highsLoader();
  return highsPromise;
}

/** Formats a coefficient for the CPLEX LP format: fixed point, never exponent notation. */
function num(n: number): string {
  const s = Math.abs(n)
    .toFixed(6)
    .replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

function expr(terms: Iterable<[string, number]>): string {
  const parts: string[] = [];
  for (const [name, coef] of terms) {
    if (coef === 0) continue;
    parts.push(`${coef < 0 ? '-' : '+'} ${num(coef)} ${name}`);
  }
  return parts.length === 0 ? '0' : parts.join(' ');
}

/** Renders the program in CPLEX LP format, which HiGHS parses. */
export function toLpFormat(p: BinaryProgram): string {
  const lines: string[] = ['Minimize', ` obj: ${expr(p.objective)}`, 'Subject To'];
  p.constraints.forEach((c, i) => {
    // HiGHS needs at least one variable per row; constant rows are dropped by the caller.
    lines.push(` c${i}: ${expr(c.terms)} ${c.op} ${c.rhs < 0 ? '-' : ''}${num(c.rhs)}`);
  });
  lines.push('Binary');
  const names = [...p.objective.keys()];
  for (let i = 0; i < names.length; i += 10) lines.push(` ${names.slice(i, i + 10).join(' ')}`);
  lines.push('End');
  return lines.join('\n');
}

/**
 * Solves the program and returns the value (0 or 1) of every variable.
 * Throws if HiGHS does not prove optimality; callers build programs that are always
 * feasible (unsupplied items get a penalised slack variable).
 */
export async function solveBinaryProgram(p: BinaryProgram): Promise<Map<string, number>> {
  const highs = await loadHighs();
  const result = highs.solve(toLpFormat(p), {
    output_flag: false,
    log_to_console: false,
    mip_rel_gap: 0,
  });
  if (result.Status !== 'Optimal') {
    throw new Error(`optimizer: HiGHS returned status "${result.Status}"`);
  }
  const values = new Map<string, number>();
  for (const name of p.objective.keys()) {
    const col = result.Columns[name];
    const primal = col && 'Primal' in col ? col.Primal : 0;
    values.set(name, Math.round(primal));
  }
  return values;
}
