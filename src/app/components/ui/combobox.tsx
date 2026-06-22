"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";

import { cn } from "./utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  value: string;
  onValueChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
}

// Searchable single-select. Composes Popover + cmdk Command. cmdk's built-in
// scoring filter is disabled (shouldFilter={false}); we filter the options
// array ourselves by case-insensitive substring so matching is deterministic.
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "— Select —",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  className,
  allowClear,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = options.find((o) => o.value === value);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;

  const handleSelect = (next: string) => {
    onValueChange(next);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange("");
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "border-input flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-input-background px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="line-clamp-1 text-left">
            {selected ? selected.label : placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {allowClear && selected && !disabled && (
              <XIcon
                className="size-4 opacity-50 hover:opacity-100"
                onClick={handleClear}
              />
            )}
            <ChevronDownIcon className="size-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => handleSelect(o.value)}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      o.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="line-clamp-1">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
