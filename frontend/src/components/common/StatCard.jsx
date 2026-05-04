import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, sub, icon: Icon, accent = false, testId }) {
  return (
    <Card data-testid={testId} className={cn(
      "border-border transition-all hover:-translate-y-0.5 hover:shadow-md",
      accent && "border-[hsl(var(--accent))]/40"
    )}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="overline">{label}</div>
          {Icon ? <Icon className={cn("h-4 w-4", accent ? "text-[hsl(var(--accent))]" : "text-muted-foreground")} /> : null}
        </div>
        <div className="mt-3 font-display text-3xl font-bold tracking-tight">{value}</div>
        {sub ? <div className="mt-1 text-sm text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
