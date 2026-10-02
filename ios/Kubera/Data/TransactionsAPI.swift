import Foundation
import Supabase

struct LedgerFilters: Equatable, Sendable {
    var search = ""
    var accountId: UUID?
    var categoryId: UUID?
    var type: TransactionType?
    var from: CalendarDate?
    var to: CalendarDate?

    var isActive: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty
            || accountId != nil || categoryId != nil || type != nil || from != nil || to != nil
    }
}

struct LedgerItem: Identifiable, Hashable, Sendable {
    let transaction: LedgerTransaction
    let children: [LedgerTransaction]
    var id: UUID { transaction.id }
}

struct LedgerPage: Sendable {
    let items: [LedgerItem]
    let total: Int
}

/// All ledger writes go through RPCs (direct DML on transactions is revoked in
/// migration 0011) so account balances stay in step with the ledger.
enum TransactionsAPI {
    static let select = """
        id, account_id, category_id, type, amount_cents, currency, description, merchant, \
        date, notes, pending, receipt_url, split_parent_id, created_by, \
        category:categories(id, name, kind, color), \
        account:accounts(id, name, type), \
        creator:profiles!created_by(full_name, email)
        """

    static func ledger(householdId: UUID, filters: LedgerFilters, page: Int, pageSize: Int = 25) async throws -> LedgerPage {
        var query = DB.client.from("transactions")
            .select(select, count: .exact)
            .eq("household_id", value: householdId)
            .is("split_parent_id", value: nil)
        if let from = filters.from { query = query.gte("date", value: from.description) }
        if let to = filters.to { query = query.lte("date", value: to.description) }
        if let accountId = filters.accountId { query = query.eq("account_id", value: accountId) }
        if let categoryId = filters.categoryId { query = query.eq("category_id", value: categoryId) }
        if let type = filters.type { query = query.eq("type", value: type.rawValue) }
        // Same sanitizing as the web app: these characters would break the or() filter.
        let q = filters.search.replacingOccurrences(of: "[,()%*]", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { query = query.or("description.ilike.%\(q)%,merchant.ilike.%\(q)%") }

        let offset = (page - 1) * pageSize
        let response: PostgrestResponse<[LedgerTransaction]> = try await query
            .order("date", ascending: false)
            .order("created_at", ascending: false)
            .range(from: offset, to: offset + pageSize - 1)
            .execute()
        let parents = response.value

        var childrenByParent: [UUID: [LedgerTransaction]] = [:]
        if !parents.isEmpty {
            let children: [LedgerTransaction] = try await DB.client.from("transactions")
                .select(select)
                .in("split_parent_id", values: parents.map(\.id.lower))
                .order("created_at", ascending: true)
                .execute().value
            childrenByParent = Dictionary(grouping: children) { $0.splitParentId! }
        }
        return LedgerPage(
            items: parents.map { LedgerItem(transaction: $0, children: childrenByParent[$0.id] ?? []) },
            total: response.count ?? parents.count
        )
    }

    static func recent(accountId: UUID, limit: Int = 8) async throws -> [LedgerTransaction] {
        try await DB.client.from("transactions")
            .select(select)
            .eq("account_id", value: accountId)
            .is("split_parent_id", value: nil)
            .order("date", ascending: false)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
    }

    struct Fields {
        var accountId: UUID
        var type: TransactionType
        var amountCents: Int
        var date: CalendarDate
        var categoryId: UUID?
        var merchant: String?
        var description: String?
        var notes: String?
        var pending: Bool
    }

    static func create(_ f: Fields, receiptKey: String?) async throws {
        try await DB.client.rpc("create_transaction", params: [
            "p_account_id": .of(f.accountId),
            "p_type": .of(f.type),
            "p_amount_cents": .of(f.amountCents),
            "p_date": .of(f.date),
            "p_category_id": .of(f.categoryId),
            "p_merchant": .of(f.merchant),
            "p_description": .of(f.description),
            "p_notes": .of(f.notes),
            "p_pending": .of(f.pending),
            "p_source": .string(receiptKey == nil ? "manual" : "scanned"),
            "p_receipt_url": .of(receiptKey),
        ]).execute()
    }

    static func update(_ id: UUID, _ f: Fields) async throws {
        try await DB.client.rpc("update_transaction", params: [
            "p_id": .of(id),
            "p_account_id": .of(f.accountId),
            "p_type": .of(f.type),
            "p_amount_cents": .of(f.amountCents),
            "p_date": .of(f.date),
            "p_category_id": .of(f.categoryId),
            "p_merchant": .of(f.merchant),
            "p_description": .of(f.description),
            "p_notes": .of(f.notes),
            "p_pending": .of(f.pending),
        ]).execute()
    }

    static func delete(_ id: UUID) async throws {
        try await DB.client.rpc("delete_transaction", params: ["p_id": .of(id)]).execute()
    }

    struct SplitPart {
        var categoryId: UUID?
        var amountCents: Int
        var description: String?
    }

    static func split(_ parentId: UUID, parts: [SplitPart]) async throws {
        let children: [AnyJSON] = parts.map { part in
            .object([
                "category_id": .of(part.categoryId),
                "amount_cents": .of(part.amountCents),
                "description": .of(part.description),
            ])
        }
        try await DB.client.rpc("split_transaction", params: [
            "p_parent_id": .of(parentId),
            "p_children": .array(children),
        ]).execute()
    }
}
