import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = path.join(root, "dist");
const key = process.env.TMDB_API_KEY || "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnon = process.env.SUPABASE_ANON_KEY || "";

if (!key.trim()) {
  console.warn(
    "TMDB_API_KEY is empty — set it in Netlify (Site settings → Environment variables) so film search works."
  );
}
if (!supabaseUrl.trim() || !supabaseAnon.trim()) {
  console.warn(
    "SUPABASE_URL or SUPABASE_ANON_KEY is empty — set both in Netlify so sign-in and synced picks work."
  );
}

fs.mkdirSync(dist, { recursive: true });

for (const f of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
}

let app = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (app.charCodeAt(0) === 0xfeff) app = app.slice(1);

function inject(haystack, sentinel, value) {
  if (!haystack.includes(sentinel)) {
    throw new Error(`app.js must contain exactly: ${sentinel}`);
  }
  return haystack.replace(sentinel, value);
}

app = inject(app, 'const TMDB_KEY = "";', `const TMDB_KEY = ${JSON.stringify(key)};`);
app = inject(app, 'const SUPABASE_URL = "";', `const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`);
app = inject(
  app,
  'const SUPABASE_ANON_KEY = "";',
  `const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnon)};`
);
fs.writeFileSync(path.join(dist, "app.js"), app);
console.log("Built to dist/");
