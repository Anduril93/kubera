import Foundation
import Supabase

/// Request bodies are `[String: AnyJSON]` rather than `Encodable` structs so a
/// cleared optional field is sent as an explicit `null` (an encoder would drop
/// the key, and an UPDATE would then keep the old value).
typealias Row = [String: AnyJSON]

extension AnyJSON {
    static func of(_ value: String?) -> AnyJSON { value.map(AnyJSON.string) ?? .null }
    static func of(_ value: Int?) -> AnyJSON { value.map(AnyJSON.integer) ?? .null }
    static func of(_ value: Double?) -> AnyJSON { value.map(AnyJSON.double) ?? .null }
    static func of(_ value: Bool) -> AnyJSON { .bool(value) }
    static func of(_ value: UUID?) -> AnyJSON { value.map { .string($0.lower) } ?? .null }
    static func of(_ value: CalendarDate?) -> AnyJSON { value.map { .string($0.description) } ?? .null }
    static func of<E: RawRepresentable<String>>(_ value: E) -> AnyJSON { .string(value.rawValue) }
}

extension String {
    /// Trimmed, or nil when blank — the `optionalText` rule from the web schemas.
    var nilIfBlank: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

/// Errors the UI shows verbatim. Anything else goes through `userMessage(for:)`.
struct DisplayableError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

extension Error {
    /// Postgres SQLSTATE from a PostgREST error, e.g. "23505" for a unique violation.
    var postgresCode: String? { (self as? PostgrestError)?.code }
    var postgresMessage: String { (self as? PostgrestError)?.message ?? "" }
}

/// Rows updated/deleted, for "X not found." checks (update + select("id")).
struct IdRow: Decodable { let id: UUID }

enum DB {
    static var client: SupabaseClient { Backend.client }

    static func currentUserId() async throws -> UUID {
        try await client.auth.session.user.id
    }
}

// Concrete `Row` overloads so dictionary literals type-check at call sites
// (the SDK's `some Encodable` parameters can't infer a literal's type).
extension PostgrestQueryBuilder {
    func insert(_ row: Row) throws -> PostgrestFilterBuilder { try insert(row, returning: nil) }
    func update(_ row: Row) throws -> PostgrestFilterBuilder { try update(row, returning: .representation) }
}

extension SupabaseClient {
    func rpc(_ fn: String, params: Row) throws -> PostgrestFilterBuilder { try rpc(fn, params: params, count: nil) }
}
