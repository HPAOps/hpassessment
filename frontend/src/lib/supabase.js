import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

// Demo mode is active when env vars aren't configured.
// In demo mode the app uses an in-memory store (see demoData.js + api.js).
export const isDemoMode = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export const supabase = isDemoMode
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

export const SUPABASE_INFO = {
  url: SUPABASE_URL,
  hasKey: Boolean(SUPABASE_ANON_KEY),
  demoMode: isDemoMode,
};
