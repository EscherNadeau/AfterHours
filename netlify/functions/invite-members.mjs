import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_INVITES = 40;

function parseEmails(raw) {
  if (Array.isArray(raw)) {
    return raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function isAllowedRedirect(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid json" }) };
  }

  if (body.pin !== process.env.CLUB_HOST_PIN) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server misconfigured" }) };
  }

  const emails = [...new Set(parseEmails(body.emails))];
  if (!emails.length) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "no valid email addresses" }) };
  }
  if (emails.length > MAX_INVITES) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: `too many addresses (max ${MAX_INVITES} per request)` }),
    };
  }

  const redirectTo = String(body.redirect_to || "").trim();
  if (!redirectTo || !isAllowedRedirect(redirectTo)) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({
        error: "redirect_to must be https URL (or http://localhost for dev)",
      }),
    };
  }

  const joinCode = body.join_code ? String(body.join_code).trim().toUpperCase().slice(0, 12) : "";
  const roomName = body.room_name ? String(body.room_name).trim().slice(0, 200) : "";

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = [];
  for (const email of emails) {
    const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        app: "after_hours",
        ...(joinCode ? { join_code: joinCode } : {}),
        ...(roomName ? { room_name: roomName } : {}),
      },
    });
    if (error) {
      results.push({ email, ok: false, error: error.message });
    } else {
      results.push({ email, ok: true });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify({
      invited: ok,
      failed,
      results,
    }),
  };
};
