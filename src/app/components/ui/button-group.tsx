import React, { useState } from 'react';

/**
 * ButtonGroup — single-select "pill" control to replace short dropdowns.
 *
 * Works in two modes, mirroring the <Sel>/<select> patterns already used in
 * the forms:
 *   • Uncontrolled (FormData):  pass `name` + optional `defaultValue`. A hidden
 *     <input name=...> carries the selected value so native form submission
 *     (FormData) keeps working exactly like the old <select>.
 *   • Controlled:               pass `value` + `onChange`. State lives in the
 *     parent (e.g. PanelForm's `panelStatus`). A hidden input is still rendered
 *     when `name` is supplied so the value is also submitted via FormData.
 *
 * `options` is either a list of strings, or {value,label} pairs when the
 * display text differs from the submitted value (e.g. Verified 'Y' → 'Yes (Y)').
 */
export interface ButtonGroupOption {
  value: string;
  label: string;
}

export function ButtonGroup({
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  ariaLabel,
}: {
  name?: string;
  options: (string | ButtonGroupOption)[];
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  const norm: ButtonGroupOption[] = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  );

  // Controlled when `value` is supplied; otherwise track internally so the
  // pills highlight correctly while a hidden input feeds FormData.
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  const selected = controlled ? value : internal;

  const select = (v: string) => {
    if (disabled) return;
    if (!controlled) setInternal(v);
    onChange?.(v);
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel || name} className="flex flex-wrap gap-2">
      {name && (
        <input
          type="hidden"
          name={name}
          value={selected ?? ''}
          required={required}
        />
      )}
      {norm.map((o) => {
        const active = selected === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => select(o.value)}
            className={[
              'px-3 py-1.5 text-sm rounded-md border transition-colors select-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              active
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default ButtonGroup;
