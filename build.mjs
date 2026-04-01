import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = path.join(root, "dist");
const key = process.env.TMDB_API_KEY || "";

if (!key.trim()) {
  console.warn(
    "TMDB_API_KEY is empty — set it in Netlify (Site settings → Environment variables) so film search works."
  );
}

fs.mkdirSync(dist, { recursive: true });

for (const f of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
}

let app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const injected = app.replace(
  /const TMDB_KEY = "";/,
  `const TMDB_KEY = ${JSON.stringify(key)};`
);
if (injected === app) {
  throw new Error('app.js must contain exactly: const TMDB_KEY = "";');
}
fs.writeFileSync(path.join(dist, "app.js"), injected);
console.log("Built to dist/");
