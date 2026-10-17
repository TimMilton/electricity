// Після `next build` копіює статичні файли в автономну збірку (.next/standalone),
// щоб `node .next/standalone/server.js` працював без додаткових кроків (у т. ч. в Docker).
import { cpSync, existsSync } from "node:fs";

if (existsSync(".next/standalone")) {
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
  console.log("standalone: скопійовано .next/static і public");
}
