import React from "react";

// The HPA Educational Services shield is the official brand mark.
// Served from /public so it can be cached by the service worker and
// also used as the PWA install icon.
const LOGO_SRC = "/hpa-logo.png";

export function HpaLogo({ className = "h-10 w-10", showText = false }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src={LOGO_SRC}
        alt="HPA Educational Services"
        className={`${className} shrink-0 object-contain select-none`}
        draggable={false}
      />
      {showText && (
        <div className="leading-none">
          <div className="font-display font-bold text-base tracking-tight">Highland Prep</div>
          <div className="overline mt-1">Growth Assessments</div>
        </div>
      )}
    </div>
  );
}
