// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'Function not configured (missing service role)' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }
  const userJwt = authHeader.slice(7);
  const supaUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: 'Bearer ' + userJwt } },
  });
  const { data: userInfo, error: whoErr } = await supaUser.auth.getUser(userJwt);
  if (whoErr || !userInfo?.user) return jsonResponse({ error: 'Invalid session' }, 401);
  const callerEmail = userInfo.user.email || '';

  const supaAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: callerProfile } = await supaAdmin
    .from('profiles').select('role').eq('id', userInfo.user.id).maybeSingle();
  const callerRole = callerProfile?.role || '';
  if (!['super_admin', 'district_admin'].includes(callerRole)) {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) === false) {
    return jsonResponse({ error: 'Valid email required' }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }

  const { data: wlRow } = await supaAdmin
    .from('staff_whitelist').select('email').eq('email', email).maybeSingle();
  if (!wlRow) {
    return jsonResponse({ error: 'Email is not on the staff access list. Add them first.' }, 400);
  }

  const { data: list, error: listErr } = await supaAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return jsonResponse({ error: 'Could not query users: ' + listErr.message }, 500);
  const existing = list?.users?.find((u) => (u.email || '').toLowerCase() === email);

  let userId, action;
  if (existing) {
    const { error: updErr } = await supaAdmin.auth.admin.updateUserById(existing.id, {
      password, email_confirm: true,
    });
    if (updErr) return jsonResponse({ error: 'Update failed: ' + updErr.message }, 500);
    userId = existing.id; action = 'updated';
  } else {
    const { data: created, error: createErr } = await supaAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) return jsonResponse({ error: 'Create failed: ' + createErr.message }, 500);
    userId = created.user.id; action = 'created';
  }

  try {
    await supaAdmin.from('audit_logs').insert({
      actor_email: callerEmail, action: 'auth.password.set', target: email,
      details: { result: action },
    });
  } catch (_e) {}

  return jsonResponse({ ok: true, user_id: userId, action });
});
