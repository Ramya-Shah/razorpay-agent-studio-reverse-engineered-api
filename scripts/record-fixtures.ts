import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const contact = process.env.NPCI_CONTACT;
if (!contact) throw new Error("Set NPCI_CONTACT to an email NPCI can reach (sent in the User-Agent).");
const USER_AGENT = `npci-stats-wrapper/0.1 (contact: ${contact})`;

const BASE = "https://www.npci.org.in/api";
const SPACING_MS = 5000;

const targets: Record<string, string> = {
  "top50-remitter-2026-08": `${BASE}/ecosystem-statistics/get-statistics?product_name=UPI&tab_name=top50-member&type_name=remitter&year=2026&month=Aug&page_no=1&sort_by=asc&size=50&locale=en`,
  "top50-beneficiary-2026-08": `${BASE}/ecosystem-statistics/get-statistics?product_name=UPI&tab_name=top50-member&type_name=beneficiary&year=2026&month=Aug&page_no=1&sort_by=asc&size=50&locale=en`,
  "top50-remitter-2026-09-nodata": `${BASE}/ecosystem-statistics/get-statistics?product_name=UPI&tab_name=top50-member&type_name=remitter&year=2026&month=Sep&page_no=1&sort_by=asc&size=50&locale=en`,
  "uptime-2026-07": `${BASE}/product-statistic/tab/detail?product_name=upi&tab_name=upi-uptime&excel_type=uptime&month=July&year=2026&page_no=1&page_size=10&locale=en`,
  "uptime-2026-08-nodata": `${BASE}/product-statistic/tab/detail?product_name=upi&tab_name=upi-uptime&excel_type=uptime&month=August&year=2026&page_no=1&page_size=10&locale=en`,
};

const outDir = path.resolve("fixtures");
await mkdir(outDir, { recursive: true });

let first = true;
for (const [name, url] of Object.entries(targets)) {
  if (!first) await new Promise((r) => setTimeout(r, SPACING_MS));
  first = false;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  const text = await res.text();
  console.log(name, res.status, text.length, "bytes");
  if (res.status !== 200) throw new Error(`Unexpected HTTP ${res.status} for ${name}; stopping.`);
  await writeFile(path.join(outDir, `${name}.json`), text, "utf8");
}
