import React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, description, action, icon: Icon, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center", className)} data-testid="empty-state">
      {Icon ? <Icon className="h-10 w-10 text-muted-foreground" /> : null}
      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
