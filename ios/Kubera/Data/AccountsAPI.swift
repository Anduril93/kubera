import Foundation
import Supabase

enum AccountsAPI {
    private static let columns = """
        id, household_id, name, type, institution, current_balance_cents, currency, is_manual, is_archived, \
        plaid_item_id, mask, available_balance_cents, bank_balance_at
        """

    /// Non-archived accounts, by name.
    static func list() async throws -> [Account] {
        try await DB.client.from("accounts")
            .select(columns)
            .eq("is_archived", value: false)
            .order("name", ascending: true)
            .execute().value
    }

    static func get(_ id: UUID) async throws -> Account? {
        let rows: [Account] = try await DB.client.from("accounts")
            .select(columns)
            .eq("id", value: id)
            .limit(1)
            .execute().value
        return rows.first
    }

    struct Fields {
        var name: String
        var type: AccountType
        var institution: String?
        var currency: String
    }

    /// Manual account with a starting balance (stored directly on the account,
    /// not as a ledger entry — same as the web app).
    static func create(householdId: UUID, _ fields: Fields, startingBalanceCents: Int) async throws {
        try await DB.client.from("accounts").insert([
            "household_id": .of(householdId),
            "name": .of(fields.name),
            "type": .of(fields.type),
            "institution": .of(fields.institution),
            "currency": .of(fields.currency),
            "current_balance_cents": .of(startingBalanceCents),
            "is_manual": .of(true),
        ]).execute()
    }

    /// `balanceCents` replaces the stored balance when given.
    static func update(_ id: UUID, _ fields: Fields, balanceCents: Int?) async throws {
        var patch: Row = [
            "name": .of(fields.name),
            "type": .of(fields.type),
            "institution": .of(fields.institution),
            "currency": .of(fields.currency),
        ]
        if let balanceCents { patch["current_balance_cents"] = .of(balanceCents) } // never sent for linked accounts
        let rows: [IdRow] = try await DB.client.from("accounts")
            .update(patch).eq("id", value: id).select("id").execute().value
        if rows.isEmpty { throw DisplayableError("Account not found.") }
    }

    static func archive(_ id: UUID) async throws {
        let rows: [IdRow] = try await DB.client.from("accounts")
            .update(["is_archived": .of(true)]).eq("id", value: id).select("id").execute().value
        if rows.isEmpty { throw DisplayableError("Account not found.") }
    }
}

enum CategoriesAPI {
    /// System defaults + the household's own, non-archived; income → expense →
    /// transfer (enum order), then by name.
    static func list() async throws -> [Category] {
        try await DB.client.from("categories")
            .select("id, name, kind, icon, color, household_id")
            .eq("is_archived", value: false)
            .order("kind", ascending: true)
            .order("name", ascending: true)
            .execute().value
    }
}
