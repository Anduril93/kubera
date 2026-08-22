import { readFileSync, writeFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const FILE = process.env.TEMP + "/kubera-budgetui.json";
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

async function delByEmail(email) {
  const list = await fetch(`${URL}/auth/v1/admin/users?per_page=500`, { headers: ADMIN }).then(r => r.json());
  for (const u of list.users || []) if (u.email === email) { await fetch(`${URL}/rest/v1/transactions?created_by=eq.${u.id}`, { method: "DELETE", headers: ADMIN }); await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: ADMIN }); }
}
if (process.argv[2] === "delete") { await delByEmail("budui.owner@example.com"); console.log("deleted"); process.exit(0); }

await delByEmail("budui.owner@example.com");
const pw = `Bu-${Date.now()}!aA1`;
const owner = await (await fetch(`${URL}/auth/v1/admin/users`, { method: "POST", headers: ADMIN, body: JSON.stringify({ email: "budui.owner@example.com", password: pw, email_confirm: true, user_metadata: { full_name: "Budget Owner" } }) })).json();
const tok = (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: "budui.owner@example.com", password: pw }) })).json()).access_token;
await fetch(`${URL}/rest/v1/profiles?id=eq.${owner.id}`, { method: "PATCH", headers: H(tok), body: JSON.stringify({ fiscal_month_start_day: 15 }) });
const hh = await (await fetch(`${URL}/rest/v1/rpc/create_household_with_owner`, { method: "POST", headers: H(tok), body: JSON.stringify({ p_name: "Budget HH", p_invite_code: `BU${Date.now()}` }) })).json();
const hhId = (Array.isArray(hh) ? hh[0] : hh).id;
const acc = (await (await fetch(`${URL}/rest/v1/accounts`, { method: "POST", headers: { ...H(tok), Prefer: "return=representation" }, body: JSON.stringify({ household_id: hhId, name: "Checking", type: "checking", current_balance_cents: 0, currency: "USD" }) })).json())[0].id;

const cat = async (name) => (await (await fetch(`${URL}/rest/v1/categories?household_id=is.null&name=eq.${encodeURIComponent(name)}&select=id`, { headers: H(tok) })).json())[0].id;
const groceries = await cat("Groceries");
const dining = await cat("Dining & Takeout");
const household = (await (await fetch(`${URL}/rest/v1/categories`, { method: "POST", headers: { ...H(tok), Prefer: "return=representation" }, body: JSON.stringify({ household_id: hhId, name: "Household", kind: "expense", icon: "Home", color: "#22c55e" }) })).json())[0].id;

// budgets: Groceries $100 (under), Dining $50 (near), Household $80 (over)
const budget = (category_id, amount_cents) => fetch(`${URL}/rest/v1/budgets`, { method: "POST", headers: { ...H(tok), Prefer: "return=representation" }, body: JSON.stringify({ household_id: hhId, category_id, period: "monthly", amount_cents }) }).then(r => r.json());
await budget(groceries, 10000);
await budget(dining, 5000);
await budget(household, 8000);

const inMonth = ymd(new Date());
const rpc = (fn, b) => fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) }).then(async r => { const t = await r.text(); return t ? JSON.parse(t) : null; });
const ct = (b) => rpc("create_transaction", b);
// $100 split (parent Groceries) → $60 Groceries + $40 Household  → Groceries $60, Household $40
const parent = await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 10000, p_date: inMonth, p_category_id: groceries, p_merchant: "SuperStore" });
await rpc("split_transaction", { p_parent_id: parent.id, p_children: [{ category_id: groceries, amount_cents: 6000 }, { category_id: household, amount_cents: 4000 }] });
await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 6000, p_date: inMonth, p_category_id: household, p_merchant: "IKEA" }); // Household +$60 → $100 (over $80)
await ct({ p_account_id: acc, p_type: "expense", p_amount_cents: 4500, p_date: inMonth, p_category_id: dining, p_merchant: "Cafe" }); // Dining $45 (near $50)

writeFileSync(FILE, JSON.stringify({ owner: { id: owner.id, email: "budui.owner@example.com", password: pw }, hhId, acc }, null, 2));
console.log(JSON.stringify({ email: "budui.owner@example.com", password: pw }, null, 2));
