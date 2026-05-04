import React from "react";

export function HpaLogo({ className = "h-10 w-10", showText = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`${className} relative shrink-0`}>
        <div className="absolute inset-0 brand-gradient rounded-md" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display font-extrabold text-[hsl(var(--accent))] text-lg tracking-tight">HP</span>
        </div>
        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[hsl(var(--accent))] rounded-sm rotate-45" />
      </div>
      {showText && (
        <div className="leading-none">
          <div className="font-display font-bold text-base tracking-tight">Highland Prep</div>
          <div className="overline mt-1">Growth Assessments</div>
        </div>
      )}
    </div>
  );
}
