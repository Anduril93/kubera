// Verifies migration 0007: recurring rules CRUD + RLS, idempotent posting via
// create_transaction (balance stays consistent), month-end advancement, and
// overdue/upcoming queries. Authenticated REST — no service client for app checks.
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${m}`); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function createUser(tag) {
  const email = `rec.${tag}.${Date.now()}@example.com`, password = `Rec-${Date.now()}-${Math.floor(Math.random() * 1e6)}!aA1`;
  const r = await fetch(`${URL}/auth/v1/admin/users`, { method: "POST", headers: ADMIN, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: tag } }) });
  return { id: (await r.json()).id, email, password };
}
const del = (id) => fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: ADMIN });
async function signIn(u) { return (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) })).json()).access_token; }
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
async function jget(p, t) { return (await fetch(`${URL}${p}`, { headers: H(t) })).json(); }
async function jrpc(fn, t, b) { const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H(t), body: JSON.stringify(b) }); const x = await r.text(); return { status: r.status, json: x ? JSON.parse(x) : null }; }
async function post(p, t, b) { const r = await fetch(`${URL}${p}`, { method: "POST", headers: { ...H(t), Prefer: "return=representation" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }
const stored = async (acc, t) => (await jget(`/rest/v1/accounts?id=eq.${acc}&select=current_balance_cents`, t))[0]?.current_balance_cents;

const made = [];
try {
  const A = await createUser("a"), C = await createUser("c");
  made.push(A.id, C.id);
  const tokA = await signIn(A), tokC = await signIn(C);
  const hhA = (await jrpc("create_household_with_owner", tokA, { p_name: "A", p_invite_code: `A${Date.now()}` })).json;
  const hhC = (await jrpc("create_household_with_owner", tokC, { p_name: "C", p_invite_code: `C${Date.now()}` })).json;
  const hhAId = (Array.isArray(hhA) ? hhA[0] : hhA).id, hhCId = (Array.isArray(hhC) ? hhC[0] : hhC).id;
  const mkAcc = async (t, hh, name) => (await post("/rest/v1/accounts", t, { household_id: hh, name, type: "checking", current_balance_cents: 0, currency: "USD" })).json[0].id;
  const checking = await mkAcc(tokA, hhAId, "Checking");
  const savings = await mkAcc(tokA, hhAId, "Savings");
  const groceries = (await jget(`/rest/v1/categories?household_id=is.null&name=eq.Groceries&select=id`, tokA))[0].id;

  const today = new Date();
  const mkRule = (t, hh, acc, extra) => post("/rest/v1/recurring_rules", t, { household_id: hh, account_id: acc, name: "Rule", amount_cents: 5000, type: "expense", frequency: "monthly", next_due_date: ymd(today), ...extra });

  console.log("[1] month-end advancement (advance_recurring_date)");
  const adv = async (d, f) => (await jrpc("advance_recurring_date", tokA, { p_date: d, p_freq: f })).json;
  ok(await adv("2024-01-31", "monthly") === "2024-02-29", "Jan 31 +1mo → Feb 29 (leap)");
  ok(await adv("2025-01-31", "monthly") === "2025-02-28", "Jan 31 +1mo → Feb 28 (non-leap)");
  ok(await adv("2025-01-31", "quarterly") === "2025-04-30", "Jan 31 +1q → Apr 30");
  ok(await adv("2024-02-29", "yearly") === "2025-02-28", "Feb 29 +1yr → Feb 28");
  ok(await adv("2025-01-15", "biweekly") === "2025-01-29", "Jan 15 +2wk → Jan 29");
  ok(await adv("2025-01-15", "weekly") === "2025-01-22", "Jan 15 +1wk → Jan 22");

  console.log("\n[2] posting: transaction via RPC, balance = recompute, advance");
  const r1 = (await mkRule(tokA, hhAId, checking, { category_id: groceries, name: "Netflix", amount_cents: 5000 })).json[0];
  const p1 = await jrpc("post_recurring_rule", tokA, { p_id: r1.id });
  ok(p1.json != null, `post returned a transaction id (${p1.json})`);
  const txns = await jget(`/rest/v1/transactions?account_id=eq.${checking}&split_parent_id=is.null&select=amount_cents,type,date,merchant,category_id`, tokA);
  ok(txns.length === 1 && txns[0].amount_cents === 5000 && txns[0].type === "expense" && txns[0].date === ymd(today) && txns[0].merchant === "Netflix", "one transaction created (dated today, $50 expense, merchant=name)");
  ok(txns[0].category_id === groceries, "transaction carries the rule's category");
  const bal1 = await stored(checking, tokA);
  const rc1 = (await jrpc("recompute_account_balance", tokA, { p_account_id: checking })).json;
  ok(bal1 === -5000 && bal1 === rc1, `balance -50.00 and equals recompute (${bal1} == ${rc1})`);
  const r1after = (await jget(`/rest/v1/recurring_rules?id=eq.${r1.id}&select=next_due_date`, tokA))[0].next_due_date;
  const expectedNext = await adv(ymd(today), "monthly");
  ok(r1after === expectedNext, `next_due_date advanced by one month (${r1after})`);

  console.log("\n[3] idempotency: posting the same instance again does nothing");
  const p2 = await jrpc("post_recurring_rule", tokA, { p_id: r1.id });
  ok(p2.json == null, "second post returns null (not due)");
  const txns2 = await jget(`/rest/v1/transactions?account_id=eq.${checking}&split_parent_id=is.null&select=id`, tokA);
  ok(txns2.length === 1, "still exactly one transaction (no double-post)");
  const bal2 = await stored(checking, tokA);
  ok(bal2 === -5000, `balance unchanged after repeat post (${bal2})`);
  const r1after2 = (await jget(`/rest/v1/recurring_rules?id=eq.${r1.id}&select=next_due_date`, tokA))[0].next_due_date;
  ok(r1after2 === expectedNext, "next_due_date advanced only once");

  console.log("\n[4] month-end advancement through posting");
  const r2 = (await mkRule(tokA, hhAId, savings, { next_due_date: "2024-01-31", amount_cents: 1000, name: "Rent" })).json[0];
  await jrpc("post_recurring_rule", tokA, { p_id: r2.id });
  const r2after = (await jget(`/rest/v1/recurring_rules?id=eq.${r2.id}&select=next_due_date`, tokA))[0].next_due_date;
  ok(r2after === "2024-02-29", `posting Jan 31 rule advanced to a valid Feb 29 (${r2after})`);

  console.log("\n[5] overdue / upcoming queries");
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const in5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
  const in60 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60);
  const rOverdue = (await mkRule(tokA, hhAId, checking, { next_due_date: ymd(y), name: "Overdue" })).json[0];
  const rSoon = (await mkRule(tokA, hhAId, checking, { next_due_date: ymd(in5), name: "Soon" })).json[0];
  const rFar = (await mkRule(tokA, hhAId, checking, { next_due_date: ymd(in60), name: "Far" })).json[0];
  const overdue = await jget(`/rest/v1/recurring_rules?household_id=eq.${hhAId}&next_due_date=lt.${ymd(today)}&select=id,name`, tokA);
  ok(overdue.some((r) => r.id === rOverdue.id) && !overdue.some((r) => r.id === rSoon.id || r.id === rFar.id), "overdue query returns only past-due rules");
  const until = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
  const upcoming = await jget(`/rest/v1/recurring_rules?household_id=eq.${hhAId}&next_due_date=gte.${ymd(today)}&next_due_date=lte.${until}&select=id,name`, tokA);
  ok(upcoming.some((r) => r.id === rSoon.id) && !upcoming.some((r) => r.id === rOverdue.id || r.id === rFar.id), "upcoming (14d) query returns only rules due within the window");

  console.log("\n[6] CRUD + RLS");
  const upd = await fetch(`${URL}/rest/v1/recurring_rules?id=eq.${rFar.id}`, { method: "PATCH", headers: { ...H(tokA), Prefer: "return=representation" }, body: JSON.stringify({ amount_cents: 9900 }) });
  ok((await upd.json())[0]?.amount_cents === 9900, "update rule amount");
  const delR = await fetch(`${URL}/rest/v1/recurring_rules?id=eq.${rFar.id}`, { method: "DELETE", headers: { ...H(tokA), Prefer: "return=representation" } });
  ok((await delR.json()).length === 1, "delete rule");
  const cReads = await jget(`/rest/v1/recurring_rules?select=id`, tokC);
  ok(cReads.length === 0, "C cannot read A's recurring rules");
  const cInsert = await post("/rest/v1/recurring_rules", tokC, { household_id: hhAId, account_id: checking, name: "X", amount_cents: 1, type: "expense", frequency: "monthly", next_due_date: ymd(today) });
  ok(cInsert.status >= 400, `C cannot insert into A's household (status ${cInsert.status})`);
  const cPost = await jrpc("post_recurring_rule", tokC, { p_id: rOverdue.id });
  ok(cPost.status >= 400, `C cannot post A's rule (status ${cPost.status})`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message, e.stack); fail++;
} finally {
  console.log("\nCleanup...");
  for (const id of made) { await fetch(`${URL}/rest/v1/transactions?created_by=eq.${id}`, { method: "DELETE", headers: ADMIN }); await del(id); }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
