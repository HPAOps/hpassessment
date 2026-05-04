import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSettings, updateSettings as apiUpdateSettings } from "@/lib/api";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSettings()
      .then(s => { if (mounted) { setSettings(s || {}); setLoading(false); } })
      .catch(err => {
        console.warn("[settings] load failed; using defaults:", err?.message || err);
        if (mounted) { setSettings({}); setLoading(false); }
      });
    return () => { mounted = false; };
  }, []);

  const update = useCallback(async (patch, actor) => {
    try {
      const next = await apiUpdateSettings(patch, actor);
      setSettings(next || ((s) => ({ ...(s || {}), ...patch })));
      return next;
    } catch (err) {
      console.warn("[settings] update failed:", err?.message || err);
      // Optimistically merge so the UI still reflects the user's choice.
      setSettings(prev => ({ ...(prev || {}), ...patch }));
      return { ...(settings || {}), ...patch };
    }
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, loading, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be inside SettingsProvider");
  return ctx;
}
