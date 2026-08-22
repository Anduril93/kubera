// Verifies migration 0006: budgets CRUD + RLS, and category_period_spend's
// counting rule (split children not parent, expenses only, period boundaries).
// All via authenticated REST — no service client for the app-behavior checks.
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${m}`); };

// --- date helpers (mirror src/lib/fiscal.ts) ---
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
function fiscalRange(today, d) {
  let sy = today.getFullYear(), sm = today.getMonth();
  if (today.getDate() < d) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1; } }
  return { start: ymd(new Date(sy, sm, d)), end: ymd(new Date(sy, sm + 1, d)), startDate: new Date(sy, sm, d) };
}
function weekRange(today) {
  const off = (today.getDay() + 6) % 7;
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - off);
  return { start: ymd(mon), end: ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7)), monday: mon };
}

async function createUser(tag) {
  const email = `bud.${tag}.${Date.now()}@example.com`, password = `Bud-${Date.now()}-${Math.floor(Math.random() * 1e6)}!aA1`;
  const r = await fetch(`${URL}/auth/v1/admin/users`, { method: "POST", headers: ADMIN, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: tag } }) });
  return { id: (await r.json()).id, email, password };
}
const del = (id) => fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: ADMIN });
async function signIn(u) { return (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) })).json()).access_token; }
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
async function jget(p, t) { return (await fetch(`${URL}${p}`, { headers: H(t) })).json(); }
async function jrpc(fn, t, b) { const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H(t), body: JSON.stringify(b) }); const x = await r.text(); return { status: r.status, json: x ? JSON.parse(x) : null }; }
async function post(p, t, b) { const r = await fetch(`${URL}${p}`, { method: "POST", headers: { ...H(t), Prefer: "return=representation" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }

const made = [];
try {
  const A = await createUser("a"), C = await createUser("c");
  made.push(A.id, C.id);
  const tokA = await signIn(A), tokC = await signIn(C);
  // fiscal start day 15 for A
  await fetch(`${URL}/rest/v1/profiles?id=eq.${A.id}`, { method: "PATCH", headers: H(tokA), body: JSON.stringify({ fiscal_month_start_day: 15 }) });
  const hhA = (await jrpc("create_household_with_owner", tokA, { p_name: "A", p_invite_code: `A${Date.now()}` })).json;
  const hhC = (await jrpc("create_household_with_owner", tokC, { p_name: "C", p_invite_code: `C${Date.now()}` })).json;
  const hhAId = (Array.isArray(hhA) ? hhA[0] : hhA).id, hhCId = (Array.isArray(hhC) ? hhC[0] : hhC).id;
  const acc = (await post("/rest/v1/accounts", tokA, { household_id: hhAId, name: "Checking", type: "checking", current_balance_cents: 0, currency: "USD" })).json[0].id;

  const groceries = (await jget(`/rest/v1/categories?household_id=is.null&name=eq.Groceries&select=id`, tokA))[0].id;
  const dining = (await jget(`/rest/v1/categories?household_id=is.null&name=eq.${encodeURIComponent("Dining & Takeout")}&select=id`, tokA))[0].id;
  const household = (await post("/rest/v1/categories", tokA, { household_id: hhAId, name: "Household", kind: "expense", icon: "Home", color: "#22c55e" })).json[0].id;

  const today = new Date();
  const fr = fiscalRange(today, 15), wr = weekRange(today);
  const inMonth = ymd(today);
  const beforeMonth = ymd(new Date(fr.startDate.getFullYear(), fr.startDate.getMonth(), fr.startDate.getDate() - 1));
  const inWeek = ymd(today);
  const beforeWeek = ymd(new Date(wr.monday.getFullYear(), wr.monday.getMonth(), wr.monday.getDate() - 1));

  const ct = (b) => jrpc("create_transaction", tokA, b);
  // Split $100 expense (category Groceries) → $60 Groceries + $40 Household. Parent has Groceries
  // category on purpose: correct code must exclude the $100 parent and count the $60 child.
  const parent = (await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 10000, p_date: inMonth, p_category_id: groceries })).json;
  await jrpc("split_transaction", tokA, { p_parent_id: parent.id, p_children: [{ category_id: groceries, amount_cents: 6000 }, { category_id: household, amount_cents: 4000 }] });
  // Noise that must NOT count as Groceries spend:
  await ct({ p_account_id: acc, p_type: "income", p_amount_cents: 50000, p_date: inMonth, p_category_id: groceries });    // income
  await ct({ p_account_id: acc, p_type: "transfer", p_amount_cents: 20000, p_date: inMonth, p_category_id: groceries });  // transfer
  await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 2500, p_date: beforeMonth, p_category_id: groceries }); // out of fiscal month
  // Weekly Dining: $20 in-week (counts), $15 last week (excluded)
  await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 2000, p_date: inWeek, p_category_id: dining });
  await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 1500, p_date: beforeWeek, p_category_id: dining });

  console.log("[1] category_period_spend — split children, not the parent lump");
  const gSpend = (await jrpc("category_period_spend", tokA, { p_category_id: groceries, p_start: fr.start, p_end: fr.end })).json;
  ok(gSpend === 6000, `Groceries monthly spend = $60 (${gSpend}) — child counted, $100 parent excluded, income/transfer/out-of-range excluded`);
  const hSpend = (await jrpc("category_period_spend", tokA, { p_category_id: household, p_start: fr.start, p_end: fr.end })).json;
  ok(hSpend === 4000, `Household monthly spend = $40 (${hSpend})`);

  console.log("\n[2] fiscal month boundary respected (start day 15)");
  ok(fr.start.endsWith("-15"), `fiscal period starts on the 15th (${fr.start})`);
  // The out-of-range $25 is excluded above; confirm a naive calendar-month sum would differ:
  const calMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const gCal = (await jrpc("category_period_spend", tokA, { p_category_id: groceries, p_start: calMonthStart, p_end: fr.end })).json;
  ok(gCal !== gSpend || beforeMonth < calMonthStart, `fiscal range differs from calendar-month range when it should`);

  console.log("\n[3] weekly period (Mon–Sun)");
  const dSpend = (await jrpc("category_period_spend", tokA, { p_category_id: dining, p_start: wr.start, p_end: wr.end })).json;
  ok(dSpend === 2000, `Dining weekly spend = $20 (${dSpend}) — last week's $15 excluded`);

  console.log("\n[4] budgets CRUD + uniqueness");
  const gBudget = await post("/rest/v1/budgets", tokA, { household_id: hhAId, category_id: groceries, period: "monthly", amount_cents: 10000 });
  ok(gBudget.status < 300 && gBudget.json?.[0]?.id, `create budget (status ${gBudget.status})`);
  const bId = gBudget.json[0].id;
  const upd = await fetch(`${URL}/rest/v1/budgets?id=eq.${bId}`, { method: "PATCH", headers: { ...H(tokA), Prefer: "return=representation" }, body: JSON.stringify({ amount_cents: 12000 }) });
  ok((await upd.json())[0]?.amount_cents === 12000, "update budget amount");
  const dupe = await post("/rest/v1/budgets", tokA, { household_id: hhAId, category_id: groceries, period: "monthly", amount_cents: 5000 });
  ok(dupe.status === 409, `duplicate (same category+period) rejected (status ${dupe.status})`);
  const dueDiffPeriod = await post("/rest/v1/budgets", tokA, { household_id: hhAId, category_id: groceries, period: "weekly", amount_cents: 3000 });
  ok(dueDiffPeriod.status < 300, "same category, different period allowed");
  const delR = await fetch(`${URL}/rest/v1/budgets?id=eq.${bId}`, { method: "DELETE", headers: { ...H(tokA), Prefer: "return=representation" } });
  ok((await delR.json()).length === 1, "delete budget");

  console.log("\n[5] RLS: budgets are household-scoped");
  await post("/rest/v1/budgets", tokA, { household_id: hhAId, category_id: household, period: "monthly", amount_cents: 8000 });
  const cReads = await jget(`/rest/v1/budgets?select=id`, tokC);
  ok(Array.isArray(cReads) && cReads.length === 0, "C cannot read A's budgets");
  const cInsert = await post("/rest/v1/budgets", tokC, { household_id: hhAId, category_id: household, period: "monthly", amount_cents: 100 });
  ok(cInsert.status >= 400, `C cannot insert a budget into A's household (status ${cInsert.status})`);
  const aBudget = (await jget(`/rest/v1/budgets?household_id=eq.${hhAId}&select=id`, tokA))[0].id;
  const cDelete = await fetch(`${URL}/rest/v1/budgets?id=eq.${aBudget}`, { method: "DELETE", headers: { ...H(tokC), Prefer: "return=representation" } });
  ok((await cDelete.json()).length === 0, "C cannot delete A's budget");
} catch (e) {
  console.error("HARNESS ERROR:", e.message, e.stack); fail++;
} finally {
  console.log("\nCleanup...");
  // delete transactions first (created_by FK), then users
  for (const id of made) { await fetch(`${URL}/rest/v1/transactions?created_by=eq.${id}`, { method: "DELETE", headers: ADMIN }); await del(id); }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
