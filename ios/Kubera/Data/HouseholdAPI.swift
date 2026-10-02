import Foundation
import Supabase

enum HouseholdAPI {
    /// The caller's household (first membership by join date), or nil.
    static func current() async throws -> Household? {
        struct MembershipRow: Decodable { let households: Household? }
        let uid = try await DB.currentUserId()
        let rows: [MembershipRow] = try await DB.client.from("household_members")
            .select("households(*)")
            .eq("user_id", value: uid)
            .order("joined_at", ascending: true)
            .limit(1)
            .execute().value
        return rows.first?.households
    }

    static func profile() async throws -> Profile {
        let uid = try await DB.currentUserId()
        return try await DB.client.from("profiles")
            .select("id, full_name, email, default_currency, locale, fiscal_month_start_day")
            .eq("id", value: uid)
            .single()
            .execute().value
    }

    static func members(of householdId: UUID) async throws -> [HouseholdMember] {
        try await DB.client.from("household_members")
            .select("user_id, role, joined_at, profiles(full_name, email)")
            .eq("household_id", value: householdId)
            .order("joined_at", ascending: true)
            .execute().value
    }

    static func create(name: String) async throws {
        // The invite code is generated here and must be unique; retry on collision.
        for _ in 0..<4 {
            do {
                try await DB.client.rpc("create_household_with_owner", params: [
                    "p_name": .string(name),
                    "p_invite_code": .string(InviteCode.generate()),
                ]).execute()
                return
            } catch where error.postgresCode == "23505" && !error.postgresMessage.contains("Already") {
                continue
            }
        }
        throw DisplayableError("Could not create the household. Please try again.")
    }

    static func join(code: String) async throws {
        do {
            try await DB.client.rpc("join_household_by_invite", params: [
                "p_invite_code": .string(InviteCode.normalize(code)),
            ]).execute()
        } catch let error as PostgrestError {
            logError("household", "join failed: \(error.message)")
            throw DisplayableError("That invite code didn't match a household.")
        }
    }

    static func rename(_ householdId: UUID, to name: String) async throws -> Household {
        let rows: [Household] = try await DB.client.from("households")
            .update(["name": .string(name)])
            .eq("id", value: householdId)
            .select()
            .execute().value
        guard let updated = rows.first else {
            throw DisplayableError("Only the household owner can rename it.")
        }
        return updated
    }

    static func regenerateInviteCode(_ householdId: UUID) async throws -> Household {
        for _ in 0..<4 {
            do {
                let rows: [Household] = try await DB.client.from("households")
                    .update(["invite_code": .string(InviteCode.generate())])
                    .eq("id", value: householdId)
                    .select()
                    .execute().value
                guard let updated = rows.first else {
                    throw DisplayableError("Only the household owner can regenerate the code.")
                }
                return updated
            } catch where error.postgresCode == "23505" {
                continue
            }
        }
        throw DisplayableError("Could not regenerate the invite code.")
    }
}
