import { useState, useMemo, type ReactNode } from 'react';
import { TableHead } from './ui/table';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from './ui/utils';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string | null;
  dir: SortDir;
}

/**
 * useSort — generic client-side sorting hook for tables.
 *
 * accessors: map a sort key to a value-extractor for a row. If a key is not
 * present in accessors, the raw row[key] is used.
 *
 * Sorting is type-aware: numbers sort numerically, valid dates sort
 * chronologically, everything else sorts as case-insensitive strings.
 * Null / undefined / empty values always sort to the bottom.
 */
export function useSort<T>(
  rows: T[],
  accessors?: Record<string, (row: T) => unknown>,
  initial?: SortState,
) {
  const [sort, setSort] = useState<SortState>(initial ?? { key: null, dir: 'asc' });

  const toggleSort = (key: string) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const key = sort.key;
    const getVal = accessors?.[key] ?? ((row: T) => (row as any)?.[key]);
    const factor = sort.dir === 'asc' ? 1 : -1;

    const isEmpty = (v: unknown) =>
      v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

    const norm = (v: unknown): { kind: 'num' | 'date' | 'str'; val: number | string } => {
      if (typeof v === 'number') return { kind: 'num', val: v };
      const s = String(v).trim();
      // numeric (incl. things like "1.2", "187")
      if (s !== '' && !isNaN(Number(s))) return { kind: 'num', val: Number(s) };
      // date (MM/DD/YYYY or ISO)
      const t = Date.parse(s);
      if (!isNaN(t) && /[-/]/.test(s)) return { kind: 'date', val: t };
      return { kind: 'str', val: s.toLowerCase() };
    };

    return [...rows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      const ae = isEmpty(av);
      const be = isEmpty(bv);
      if (ae && be) return 0;
      if (ae) return 1;   // empties always last
      if (be) return -1;

      const na = norm(av);
      const nb = norm(bv);
      // If both same numeric/date kind, compare numerically
      if ((na.kind === 'num' || na.kind === 'date') && na.kind === nb.kind) {
        return ((na.val as number) - (nb.val as number)) * factor;
      }
      // fallback string compare
      return String(na.val).localeCompare(String(nb.val)) * factor;
    });
  }, [rows, sort, accessors]);

  return { sorted, sort, toggleSort };
}

/**
 * SortableHead — a clickable <TableHead> that shows sort direction.
 * Drop-in replacement for <TableHead> where sorting is desired.
 */
export function SortableHead({
  sortKey,
  sort,
  onSort,
  children,
  className,
}: {
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={cn('p-0', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'flex w-full items-center gap-1 px-2 py-2 text-left font-medium select-none',
          'hover:text-blue-600 transition-colors',
          active ? 'text-blue-600' : 'text-foreground',
        )}
        aria-label={`Sort by ${typeof children === 'string' ? children : sortKey}`}
      >
        <span>{children}</span>
        {active
          ? (sort.dir === 'asc'
              ? <ArrowUp className="w-3.5 h-3.5 shrink-0" />
              : <ArrowDown className="w-3.5 h-3.5 shrink-0" />)
          : <ArrowUpDown className="w-3.5 h-3.5 shrink-0 opacity-40" />}
      </button>
    </TableHead>
  );
}
