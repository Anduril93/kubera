import Foundation

// Row types for the Supabase tables the app reads. Money is always integer
// cents (`Int`); `date` columns are `CalendarDate`. Embedded relations use the
// PostgREST alias given in the select string (see the *API.swift files).

extension UUID {
    /// Postgres renders UUIDs lowercase; use this wherever an id becomes part of
    /// a string the database compares as text (storage paths, receipt keys).
    var lower: String { uuidString.lowercased() }
}

struct Profile: Codable, Sendable {
    let id: UUID
    var fullName: String?
    var email: String?
    var defaultCurrency: String
    var locale: String
    var fiscalMonthStartDay: Int

    enum CodingKeys: String, CodingKey {
        case id, email, locale
        case fullName = "full_name"
        case defaultCurrency = "default_currency"
        case fiscalMonthStartDay = "fiscal_month_start_day"
    }
}

struct Household: Codable, Sendable, Identifiable, Equatable {
    let id: UUID
    var name: String
    let ownerId: UUID
    var inviteCode: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case ownerId = "owner_id"
        case inviteCode = "invite_code"
    }
}

struct HouseholdMember: Codable, Sendable, Identifiable {
    struct ProfileRef: Codable, Sendable {
        let fullName: String?
        let email: String?
        enum CodingKeys: String, CodingKey {
            case email
            case fullName = "full_name"
        }
    }

    let userId: UUID
    let role: HouseholdRole
    let joinedAt: Date
    let profile: ProfileRef?

    var id: UUID { userId }
    var displayName: String { profile?.fullName ?? profile?.email ?? "Household member" }

    enum CodingKeys: String, CodingKey {
        case role
        case userId = "user_id"
        case joinedAt = "joined_at"
        case profile = "profiles"
    }
}

struct Account: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let householdId: UUID
    var name: String
    var type: AccountType
    var institution: String?
    var currentBalanceCents: Int
    var currency: String
    var isManual: Bool
    var isArchived: Bool
    var plaidItemId: UUID? = nil
    var mask: String? = nil
    var availableBalanceCents: Int? = nil
    var bankBalanceAt: Date? = nil

    /// Linked accounts take their balance from the bank (migration 0013).
    var isLinked: Bool { !isManual }

    enum CodingKeys: String, CodingKey {
        case id, name, type, institution, currency, mask
        case householdId = "household_id"
        case currentBalanceCents = "current_balance_cents"
        case isManual = "is_manual"
        case isArchived = "is_archived"
        case plaidItemId = "plaid_item_id"
        case availableBalanceCents = "available_balance_cents"
        case bankBalanceAt = "bank_balance_at"
    }
}

/// One connected bank login (plaid_items). The access token never reaches the app.
struct BankConnection: Codable, Sendable, Identifiable, Hashable {
    enum Status: String, Codable, Sendable { case active, loginRequired = "login_required", error }

    let id: UUID
    let institutionName: String?
    let status: Status
    let errorCode: String?
    let lastSyncedAt: Date?

    var name: String { institutionName ?? "Bank" }

    enum CodingKeys: String, CodingKey {
        case id, status
        case institutionName = "institution_name"
        case errorCode = "error_code"
        case lastSyncedAt = "last_synced_at"
    }
}

struct Category: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var kind: CategoryKind
    var icon: String?
    var color: String?
    var householdId: UUID?

    enum CodingKeys: String, CodingKey {
        case id, name, kind, icon, color
        case householdId = "household_id"
    }
}

/// A category as embedded in another row (`category:categories(...)`).
struct CategoryRef: Codable, Sendable, Hashable {
    let id: UUID
    let name: String
    let kind: CategoryKind?
    let color: String?
}

/// An account as embedded in another row (`account:accounts(...)`).
struct AccountRef: Codable, Sendable, Hashable {
    let id: UUID
    let name: String
    let type: AccountType?
    let currentBalanceCents: Int?
    let currency: String?

    enum CodingKeys: String, CodingKey {
        case id, name, type, currency
        case currentBalanceCents = "current_balance_cents"
    }
}

struct LedgerTransaction: Codable, Sendable, Identifiable, Hashable {
    struct Creator: Codable, Sendable, Hashable {
        let fullName: String?
        let email: String?
        enum CodingKeys: String, CodingKey {
            case email
            case fullName = "full_name"
        }
    }

    let id: UUID
    let accountId: UUID
    let categoryId: UUID?
    let type: TransactionType
    let amountCents: Int
    let currency: String
    let description: String?
    let merchant: String?
    let date: CalendarDate
    let notes: String?
    let pending: Bool
    let receiptUrl: String?
    let splitParentId: UUID?
    let createdBy: UUID?
    let category: CategoryRef?
    let account: AccountRef?
    let creator: Creator?
    var source: TransactionSource = .manual
    var reviewState: String? = nil
    var matchState: String? = nil
    var bankSnapshot: BankSnapshot? = nil

    /// What the bank reported, kept when a bank transaction is merged into an entry.
    struct BankSnapshot: Codable, Sendable, Hashable {
        let name: String?
        let merchant: String?
        let amountCents: Int?
        let date: CalendarDate?
        enum CodingKeys: String, CodingKey {
            case name, merchant, date
            case amountCents = "amount_cents"
        }
    }

    var title: String { merchant ?? description ?? "—" }
    var needsReview: Bool { reviewState == "needs_review" }
    var isMatched: Bool { matchState != nil }
    var isFromBank: Bool { source == .imported || isMatched }
    var signedAmountCents: Int { type.signed(amountCents) }
    var creatorLabel: String? { creator?.fullName ?? creator?.email }

    enum CodingKeys: String, CodingKey {
        case id, type, currency, description, merchant, date, notes, pending, category, account, creator, source
        case accountId = "account_id"
        case reviewState = "review_state"
        case matchState = "match_state"
        case bankSnapshot = "bank_snapshot"
        case categoryId = "category_id"
        case amountCents = "amount_cents"
        case receiptUrl = "receipt_url"
        case splitParentId = "split_parent_id"
        case createdBy = "created_by"
    }
}

struct Budget: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let categoryId: UUID
    let period: BudgetPeriod
    let amountCents: Int
    let rollover: Bool
    let startDate: CalendarDate
    let category: CategoryRef?

    enum CodingKeys: String, CodingKey {
        case id, period, rollover, category
        case categoryId = "category_id"
        case amountCents = "amount_cents"
        case startDate = "start_date"
    }
}

struct RecurringRule: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let accountId: UUID
    let categoryId: UUID?
    let name: String
    let amountCents: Int
    let type: RecurringType
    let frequency: RecurringFrequency
    let nextDueDate: CalendarDate
    let endDate: CalendarDate?
    let autoPost: Bool
    let account: AccountRef?
    let category: CategoryRef?

    var signedAmountCents: Int { type.signed(amountCents) }

    enum CodingKeys: String, CodingKey {
        case id, name, type, frequency, account, category
        case accountId = "account_id"
        case categoryId = "category_id"
        case amountCents = "amount_cents"
        case nextDueDate = "next_due_date"
        case endDate = "end_date"
        case autoPost = "auto_post"
    }
}

struct SavingsGoal: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let targetAmountCents: Int
    let targetDate: CalendarDate?
    let linkedAccountId: UUID?
    let currentAmountCents: Int
    let color: String?
    let icon: String?
    let createdAt: Date
    let linkedAccount: AccountRef?

    enum CodingKeys: String, CodingKey {
        case id, name, color, icon
        case targetAmountCents = "target_amount_cents"
        case targetDate = "target_date"
        case linkedAccountId = "linked_account_id"
        case currentAmountCents = "current_amount_cents"
        case createdAt = "created_at"
        case linkedAccount = "linked_account"
    }
}

struct Debt: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let type: DebtType
    let principalCents: Int
    let apr: Double?
    let minimumPaymentCents: Int?
    let dueDay: Int?
    let linkedAccountId: UUID?
    let createdAt: Date
    let linkedAccount: AccountRef?

    enum CodingKeys: String, CodingKey {
        case id, name, type, apr
        case principalCents = "principal_cents"
        case minimumPaymentCents = "minimum_payment_cents"
        case dueDay = "due_day"
        case linkedAccountId = "linked_account_id"
        case createdAt = "created_at"
        case linkedAccount = "linked_account"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        type = try c.decode(DebtType.self, forKey: .type)
        principalCents = try c.decode(Int.self, forKey: .principalCents)
        // numeric(5,2) may arrive as a JSON number or a string.
        if let n = try? c.decodeIfPresent(Double.self, forKey: .apr) {
            apr = n
        } else if let s = try? c.decodeIfPresent(String.self, forKey: .apr) {
            apr = Double(s)
        } else {
            apr = nil
        }
        minimumPaymentCents = try c.decodeIfPresent(Int.self, forKey: .minimumPaymentCents)
        dueDay = try c.decodeIfPresent(Int.self, forKey: .dueDay)
        linkedAccountId = try c.decodeIfPresent(UUID.self, forKey: .linkedAccountId)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        linkedAccount = try c.decodeIfPresent(AccountRef.self, forKey: .linkedAccount)
    }
}
