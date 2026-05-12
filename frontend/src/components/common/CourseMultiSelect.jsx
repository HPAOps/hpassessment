import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Multi-select course picker that deduplicates by title+code so Infinite
 * Campus's per-year course duplicates collapse to one selectable item.
 * Selecting a label links the parent record to ALL course IDs sharing
 * that label.
 *
 * Props:
 *   courses    {id, title, code, ...}[]
 *   value      string[]  (currently selected course IDs)
 *   onChange   (ids: string[]) => void
 *   testid     prefix for data-testid attributes (default: "course-multiselect")
 */
export function CourseMultiSelect({ courses, value, onChange, testid = "course-multiselect" }) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const m = new Map();
    for (const c of courses) {
      const key = `${(c.title || "").trim()}|${(c.code || "").trim()}`;
      if (!m.has(key)) m.set(key, { key, title: c.title, code: c.code, ids: [] });
      m.get(key).ids.push(c.id);
    }
    return [...m.values()].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [courses]);

  const valueSet = useMemo(() => new Set(value), [value]);

  const isGroupSelected = (g) => g.ids.every(id => valueSet.has(id));
  const isGroupPartial  = (g) => g.ids.some(id => valueSet.has(id)) && !isGroupSelected(g);

  function toggleGroup(g) {
    if (isGroupSelected(g)) {
      onChange(value.filter(id => !g.ids.includes(id)));
    } else {
      const next = new Set(value);
      g.ids.forEach(id => next.add(id));
      onChange([...next]);
    }
  }

  function removeGroup(g) {
    onChange(value.filter(id => !g.ids.includes(id)));
  }

  const selectedGroups = groups.filter(isGroupSelected);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            data-testid={`${testid}-trigger`}
          >
            <span className="text-sm">
              {selectedGroups.length === 0
                ? <span className="text-muted-foreground">Choose one or more courses</span>
                : `${selectedGroups.length} course${selectedGroups.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          /* When this popover lives inside a Radix Dialog, the Dialog's focus
             trap and overlay can swallow `wheel` events before they reach the
             scrollable CommandList. Re-emit the wheel here so the inner list
             scrolls reliably. */
          onWheel={(e) => e.stopPropagation()}
        >
          <Command>
            <CommandInput placeholder="Search courses…" />
            <CommandList onWheel={(e) => e.stopPropagation()}>
              <CommandEmpty>No courses found.</CommandEmpty>
              <CommandGroup>
                {groups.map(g => {
                  const selected = isGroupSelected(g);
                  const partial = isGroupPartial(g);
                  return (
                    <CommandItem
                      key={g.key}
                      onSelect={() => toggleGroup(g)}
                      className="cursor-pointer"
                      data-testid={`${testid}-option-${g.code || g.title}`}
                    >
                      <div className={cn(
                        "mr-2 h-4 w-4 rounded border flex items-center justify-center",
                        selected ? "bg-primary border-primary text-primary-foreground"
                                 : partial ? "bg-primary/40 border-primary"
                                           : "border-input"
                      )}>
                        {selected && <Check className="h-3 w-3" />}
                      </div>
                      <span className="flex-1">{g.title}</span>
                      {g.code && <span className="text-xs text-muted-foreground ml-2">{g.code}</span>}
                      {g.ids.length > 1 && (
                        <span className="text-xs text-muted-foreground ml-2">({g.ids.length}×)</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedGroups.map(g => (
            <Badge key={g.key} variant="secondary" className="gap-1 pl-2 pr-1">
              {g.title}
              <button
                type="button"
                onClick={() => removeGroup(g)}
                className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${g.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
