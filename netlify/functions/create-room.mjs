import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";

const JOIN = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function genCode(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += JOIN[randomInt(JOIN.length)];
  return s;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  const supabase = createClient(url, key);
  let joinCode = genCode(6);
  for (let i = 0; i < 25; i++) {
    const { data } = await supabase.from("rooms").select("id").eq("join_code", joinCode).maybeSingle();
    if (!data) break;
    joinCode = genCode(6);
  }

  const host_secret = randomUUID();
  const row = {
    join_code: joinCode,
    host_secret,
    room_name: String(body.room_name || "").slice(0, 200),
    event_dt: body.event_dt || null,
    yt_url: String(body.yt_url || "").slice(0, 500),
    submissions_open_at: body.submissions_open_at,
    submissions_close_at: body.submissions_close_at,
  };

  if (!row.submissions_open_at || !row.submissions_close_at) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "need submissions_open_at and submissions_close_at" }) };
  }

  const { data, error } = await supabase.from("rooms").insert(row).select("id, join_code, host_secret").single();

  if (error) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
};
