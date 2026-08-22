// Verifies the server-rendered /budgets (and /dashboard label) via authenticated
// HTTP — constructs the @supabase/ssr session cookie, no browser needed.
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = new URL(SUPA).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const APP = "http://localhost:3000";
const { owner } = JSON.parse(readFileSync(process.env.TEMP + "/kubera-budgetui.json", "utf8"));

// 1. sign in → full session
const session = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: owner.email, password: owner.password }),
})).json();

// 2. build cookie value: base64- + base64url(JSON(session)), chunk if large
const encoded = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
const CHUNK = 3180;
let cookiePairs;
if (encoded.length <= CHUNK) {
  cookiePairs = [`${cookieName}=${encoded}`];
} else {
  cookiePairs = [];
  for (let i = 0, idx = 0; i < encoded.length; i += CHUNK, idx++) {
    cookiePairs.push(`${cookieName}.${idx}=${encoded.slice(i, i + CHUNK)}`);
  }
}
const cookieHeader = cookiePairs.join("; ");
console.log(`session bytes: ${encoded.length}, chunks: ${cookiePairs.length}`);

async function getPage(path) {
  const res = await fetch(`${APP}${path}`, { headers: { Cookie: cookieHeader }, redirect: "manual" });
  let body = "";
  if (res.status === 200) body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${m}`); };

const b = await getPage("/budgets");
if (b.status !== 200) { console.error(`/budgets not authenticated: ${b.status} -> ${b.location}`); process.exit(2); }
const bt = strip(b.body);

console.log("\n[budgets page]");
ok(/Groceries/.test(bt) && /Household/.test(bt) && /Dining/.test(bt), "all three budget categories listed");
// Groceries: $60 of $100 (under), Dining: $45 of $50 (near), Household: $100 of $80 (over $20)
ok(/\$60\.00 of \$100\.00/.test(bt), "Groceries $60.00 of $100.00 (spent matches ledger split child)");
ok(/\$45\.00 of \$50\.00/.test(bt), "Dining $45.00 of $50.00");
ok(/\$100\.00 of \$80\.00/.test(bt), "Household $100.00 of $80.00");
ok(/On track/.test(bt), "under-budget state 'On track' present");
ok(/Near limit/.test(bt), "near-limit state present (Dining ~90%)");
ok(/Over budget/.test(bt), "over-budget state present (Household)");
ok(/\$20\.00 over/.test(bt), "Household shows '$20.00 over'");
ok(/40\.00 left/.test(bt), "Groceries shows '$40.00 left'");
// total row: budgeted 230, spent 205
ok(/\$205\.00/.test(bt) && /\$230\.00/.test(bt), "total row: $205.00 spent of $230.00");

// period label — capture from budgets page
const periodMatch = bt.match(/Monthly · ([A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2})/);
console.log("  period label on budgets:", periodMatch?.[1]);

console.log("\n[dashboard label matches]");
const d = await getPage("/dashboard");
const dt = strip(d.body);
const dashMonth = dt.match(/This month ([A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2})/);
console.log("  dashboard 'This month' label:", dashMonth?.[1]);
ok(periodMatch && dashMonth && periodMatch[1] === dashMonth[1], `budgets period label matches dashboard fiscal month (${periodMatch?.[1]} == ${dashMonth?.[1]})`);
ok(!!periodMatch?.[1]?.includes("15"), `fiscal boundary visible (starts on the 15th): ${periodMatch?.[1]}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
