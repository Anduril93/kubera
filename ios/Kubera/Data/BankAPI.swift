import Foundation
import Supabase

/// Bank linking + sync (the `plaid` Edge Function) and the review/reconcile
/// queries over bank-originated transactions (migration 0013).
enum BankAPI {
    struct SyncSummary: Decodable, Sendable {
        let added: Int?
        let matched: Int?
        let modified: Int?
        let status: String?
    }

    struct Institution: Decodable, Sendable, Identifiable {
        let id: String
        let name: String
        let oauth: Bool
        let products: [String]
    }

    // MARK: Edge Function

    private struct ErrorBody: Decodable { let error: String? }

    private static func call<T: Decodable>(_ body: [String: AnyJSON], as type: T.Type = T.self) async throws -> T {
        let data: Data
        do {
            data = try await Backend.client.functions.invoke("plaid", options: FunctionInvokeOptions(body: body)) { data, _ in data }
        } catch let FunctionsError.httpError(code, data) {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            logError("bank", "plaid \(body["action"]?.stringValue ?? "?") failed \(code): \(message ?? "")")
            throw DisplayableError(message ?? "The bank connection service isn't available right now.")
        }
        return try JSONDecoder().decode(type, from: data)
    }

    static func connections() async throws -> [BankConnection] {
        try await DB.client.from("plaid_items")
            .select("id, institution_name, status, error_code, last_synced_at")
            .order("created_at", ascending: true)
            .execute().value
    }

    /// A Link token for a new connection, or for reconnecting `itemId` (update mode).
    static func linkToken(reconnecting itemId: UUID? = nil) async throws -> String {
        struct R: Decodable { let linkToken: String }
        var body: [String: AnyJSON] = ["action": "link_token"]
        if let itemId { body["itemId"] = .of(itemId) }
        return try await call(body, as: R.self).linkToken
    }

    static func exchange(publicToken: String, institutionId: String?, institutionName: String?) async throws -> SyncSummary? {
        struct R: Decodable { let sync: SyncSummary? }
        return try await call([
            "action": "exchange",
            "publicToken": .string(publicToken),
            "institutionId": .of(institutionId),
            "institutionName": .of(institutionName),
        ], as: R.self).sync
    }

    /// Syncs every connection (or one). Returns how many new/matched transactions arrived.
    @discardableResult
    static func sync(_ itemId: UUID? = nil) async throws -> (new: Int, matched: Int) {
        struct R: Decodable { let results: [SyncSummary] }
        var body: [String: AnyJSON] = ["action": "sync"]
        if let itemId { body["itemId"] = .of(itemId) }
        let results = try await call(body, as: R.self).results
        return (results.reduce(0) { $0 + ($1.added ?? 0) }, results.reduce(0) { $0 + ($1.matched ?? 0) })
    }

    static func unlink(_ itemId: UUID) async throws {
        struct R: Decodable { let ok: Bool }
        _ = try await call(["action": "unlink", "itemId": .of(itemId)], as: R.self)
    }

    static func searchInstitutions(_ query: String) async throws -> [Institution] {
        struct R: Decodable { let institutions: [Institution] }
        return try await call(["action": "institutions", "query": .string(query)], as: R.self).institutions
    }

    #if DEBUG
    static func sandboxLink() async throws -> SyncSummary? {
        struct R: Decodable { let sync: SyncSummary? }
        return try await call(["action": "sandbox_link"], as: R.self).sync
    }

    /// Creates a Sandbox bank transaction (positive = money out) and fires the sync webhook.
    static func sandboxAdd(itemId: UUID, amount: Double, date: CalendarDate, description: String) async throws {
        struct R: Decodable { let ok: Bool }
        _ = try await call([
            "action": "sandbox_add",
            "itemId": .of(itemId),
            "transactions": .array([.object([
                "amount": .double(amount),
                "date_posted": .of(date),
                "date_transacted": .of(date),
                "description": .string(description),
            ])]),
        ], as: R.self)
    }
    #endif

    // MARK: Review / reconcile

    static func needsReview(householdId: UUID, accountId: UUID? = nil) async throws -> [LedgerTransaction] {
        var query = DB.client.from("transactions")
            .select(TransactionsAPI.select)
            .eq("household_id", value: householdId)
            .eq("review_state", value: "needs_review")
            .is("split_parent_id", value: nil)
        if let accountId { query = query.eq("account_id", value: accountId) }
        return try await query.order("date", ascending: false).execute().value
    }

    static func reviewCount(householdId: UUID) async throws -> Int {
        let response = try await DB.client.from("transactions")
            .select("id", head: true, count: .exact)
            .eq("household_id", value: householdId)
            .eq("review_state", value: "needs_review")
            .is("split_parent_id", value: nil)
            .execute()
        return response.count ?? 0
    }

    static func markReviewed(_ ids: [UUID]) async throws {
        try await DB.client.rpc("mark_transactions_reviewed", params: [
            "p_ids": .array(ids.map { .of($0) }),
        ]).execute()
    }

    static func setCategory(_ id: UUID, categoryId: UUID?) async throws {
        try await DB.client.rpc("set_transaction_category", params: [
            "p_id": .of(id), "p_category_id": .of(categoryId),
        ]).execute()
    }

    static func match(bank bankId: UUID, entry entryId: UUID) async throws {
        do {
            try await DB.client.rpc("match_bank_transaction", params: [
                "p_bank_id": .of(bankId), "p_entry_id": .of(entryId),
            ]).execute()
        } catch let error as PostgrestError {
            logError("bank", "match failed: \(error.message)")
            throw DisplayableError("Those two can't be matched — they must be on the same account.")
        }
    }

    static func unmatch(_ id: UUID) async throws {
        try await DB.client.rpc("unmatch_transaction", params: ["p_id": .of(id)]).execute()
    }

    /// Your own entries on linked accounts the bank still hasn't shown after 5 days.
    static func unseenEntries(accountId: UUID, today: CalendarDate = .today()) async throws -> [LedgerTransaction] {
        try await DB.client.from("transactions")
            .select(TransactionsAPI.select)
            .eq("account_id", value: accountId)
            .is("plaid_transaction_id", value: nil)
            .is("split_parent_id", value: nil)
            .in("source", values: ["manual", "scanned"])
            .gte("date", value: today.adding(days: -60).description)
            .lte("date", value: today.adding(days: -5).description)
            .order("date", ascending: false)
            .execute().value
    }

    /// Match candidates within ±10 days on the same account: for a bank
    /// transaction, your unmatched entries; for an entry, unmatched bank rows.
    /// Closest amount first, then closest date.
    static func candidates(for txn: LedgerTransaction) async throws -> [LedgerTransaction] {
        var query = DB.client.from("transactions")
            .select(TransactionsAPI.select)
            .eq("account_id", value: txn.accountId)
            .neq("id", value: txn.id)
            .is("split_parent_id", value: nil)
            .gte("date", value: txn.date.adding(days: -10).description)
            .lte("date", value: txn.date.adding(days: 10).description)
        if txn.source == .imported {
            query = query.is("plaid_transaction_id", value: nil).in("source", values: ["manual", "scanned"])
        } else {
            query = query.eq("source", value: "imported").is("match_state", value: nil)
        }
        let rows: [LedgerTransaction] = try await query.execute().value
        return rows.sorted {
            let a = (abs($0.amountCents - txn.amountCents), abs($0.date.days(to: txn.date)))
            let b = (abs($1.amountCents - txn.amountCents), abs($1.date.days(to: txn.date)))
            return a < b
        }
    }
}
