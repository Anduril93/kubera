// plaid — bank linking + sync for signed-in household members.
//
// POST { action, ... } with the user's JWT:
//   link_token   { itemId? }                       → { linkToken }   (itemId = reconnect/update mode)
//   exchange     { publicToken, institutionId?, institutionName? } → { itemId, sync }
//   sync         { itemId? }                       → { results }     (all of the household's items by default)
//   unlink       { itemId }                        → { ok: true }
//   institutions { query }                         → { institutions }
//   sandbox_link {}                                → { itemId, sync } (Sandbox only: links a fake bank, no UI)
//   sandbox_add  { itemId, transactions[] }        → { ok: true }    (Sandbox only: creates test transactions)
//
// The access token is created, stored (Vault) and used entirely server-side.
import { createClient } from "npm:@supabase/supabase-js@^2.108.2";
import { adminClient, PLAID_ENV, plaid, PlaidError, syncItem, WEBHOOK_URL } from "../_shared/plaid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const fail = (error: string, status = 400) => json({ error }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: auth } = await userClient.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Not signed in.", 401);

  const { data: membership } = await userClient
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const householdId: string | undefined = membership?.household_id;
  if (!householdId) return fail("Not signed in.", 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request.");
  }

  const admin = adminClient();

  /** Item ids belonging to the caller's household (optionally just one). */
  async function householdItems(only?: string): Promise<string[]> {
    let q = admin.from("plaid_items").select("id").eq("household_id", householdId);
    if (only) q = q.eq("id", only);
    const { data } = await q;
    return (data ?? []).map((r: { id: string }) => r.id);
  }

  async function linkItem(publicToken: string, institutionId?: string, institutionName?: string) {
    const exchange = await plaid("/item/public_token/exchange", { public_token: publicToken });
    const accessToken: string = exchange.access_token;
    const plaidItemId: string = exchange.item_id;

    const { data: tokenRef, error: vaultError } = await admin.rpc("plaid_store_access_token", {
      p_item_id: plaidItemId,
      p_token: accessToken,
    });
    if (vaultError) throw new Error(`[plaid] vault store failed: ${vaultError.message}`);

    const accounts = await plaid("/accounts/get", { access_token: accessToken });
    const instId = institutionId ?? accounts.item?.institution_id ?? null;
    let instName = institutionName ?? null;
    if (!instName && instId) {
      try {
        const inst = await plaid("/institutions/get_by_id", { institution_id: instId, country_codes: ["US"] });
        instName = inst.institution?.name ?? null;
      } catch { /* name is cosmetic */ }
    }

    const { data: itemId, error } = await admin.rpc("plaid_register_item", {
      p_household_id: householdId,
      p_user_id: user!.id,
      p_item_id: plaidItemId,
      p_token_ref: tokenRef,
      p_institution_id: instId,
      p_institution_name: instName,
      p_accounts: accounts.accounts,
    });
    if (error) throw new Error(`[plaid] register failed: ${error.message}`);

    // Historical transactions may not be ready yet; the webhook finishes the job.
    let sync = null;
    try {
      sync = await syncItem(admin, itemId);
    } catch (err) {
      console.error("[plaid] initial sync deferred", err);
    }
    return { itemId, sync };
  }

  try {
    switch (body.action) {
      case "link_token": {
        const base = {
          client_name: "Kubera",
          user: { client_user_id: user.id },
          country_codes: ["US"],
          language: "en",
          webhook: WEBHOOK_URL,
        };
        if (body.itemId) {
          const [itemId] = await householdItems(body.itemId);
          if (!itemId) return fail("That bank connection isn't available.", 404);
          const { data: token } = await admin.rpc("plaid_get_access_token", { p_item: itemId });
          const res = await plaid("/link/token/create", { ...base, access_token: token });
          return json({ linkToken: res.link_token });
        }
        const res = await plaid("/link/token/create", {
          ...base,
          products: ["transactions"],
          transactions: { days_requested: 90 },
        });
        return json({ linkToken: res.link_token });
      }

      case "exchange": {
        if (typeof body.publicToken !== "string") return fail("Missing public token.");
        return json(await linkItem(body.publicToken, body.institutionId, body.institutionName));
      }

      case "sync": {
        const items = await householdItems(body.itemId);
        const results = [];
        for (const itemId of items) {
          try {
            results.push({ itemId, ...(await syncItem(admin, itemId)) });
          } catch (err) {
            console.error("[plaid] sync failed", itemId, err);
            results.push({ itemId, status: "error" });
          }
        }
        return json({ results });
      }

      case "unlink": {
        const [itemId] = await householdItems(body.itemId);
        if (!itemId) return fail("That bank connection isn't available.", 404);
        const { data: token } = await admin.rpc("plaid_get_access_token", { p_item: itemId });
        if (token) {
          try {
            await plaid("/item/remove", { access_token: token });
          } catch (err) {
            console.error("[plaid] item/remove failed (continuing)", err);
          }
        }
        const { data: ref } = await admin.rpc("plaid_unlink_item", { p_item: itemId });
        if (ref) await admin.rpc("plaid_delete_access_token", { p_ref: ref });
        return json({ ok: true });
      }

      case "institutions": {
        const res = await plaid("/institutions/search", {
          query: String(body.query ?? "").slice(0, 100),
          products: ["transactions"],
          country_codes: ["US"],
          options: { include_optional_metadata: false },
        });
        // deno-lint-ignore no-explicit-any
        const institutions = res.institutions.map((i: any) => ({
          id: i.institution_id,
          name: i.name,
          oauth: i.oauth,
          products: i.products,
        }));
        return json({ institutions });
      }

      case "sandbox_link": {
        if (PLAID_ENV !== "sandbox") return fail("Sandbox only.", 403);
        const created = await plaid("/sandbox/public_token/create", {
          institution_id: "ins_109508",
          initial_products: ["transactions"],
          options: {
            webhook: WEBHOOK_URL,
            override_username: "user_transactions_dynamic",
            override_password: "pass_good",
          },
        });
        return json(await linkItem(created.public_token, "ins_109508"));
      }

      case "sandbox_add": {
        if (PLAID_ENV !== "sandbox") return fail("Sandbox only.", 403);
        const [itemId] = await householdItems(body.itemId);
        if (!itemId) return fail("That bank connection isn't available.", 404);
        const { data: token } = await admin.rpc("plaid_get_access_token", { p_item: itemId });
        await plaid("/sandbox/transactions/create", { access_token: token, transactions: body.transactions ?? [] });
        await plaid("/sandbox/item/fire_webhook", { access_token: token, webhook_code: "SYNC_UPDATES_AVAILABLE" });
        return json({ ok: true });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (err) {
    if (err instanceof PlaidError) {
      console.error(`[plaid] ${body.action} failed: ${err.code} ${err.message}`);
      return json({ error: "The bank connection service returned an error.", code: err.code }, 502);
    }
    console.error(`[plaid] ${body.action} failed`, err);
    return fail("Something went wrong with the bank connection.", 500);
  }
});
