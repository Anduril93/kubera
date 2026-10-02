import Foundation

// Postgres enums (supabase/migrations). Raw values are the wire values;
// `label` is the display copy from the web app's *-meta.ts files.

enum AccountType: String, Codable, CaseIterable, Identifiable, Sendable {
    case checking, savings, creditCard = "credit_card", cash, investment, loan

    var id: String { rawValue }

    var label: String {
        switch self {
        case .checking: "Checking"
        case .savings: "Savings"
        case .creditCard: "Credit Card"
        case .cash: "Cash"
        case .investment: "Investment"
        case .loan: "Loan"
        }
    }

    /// Credit cards and loans hold amounts owed; everything else is an asset.
    var isLiability: Bool { self == .creditCard || self == .loan }

    var symbol: String {
        switch self {
        case .checking: "building.columns"
        case .savings: "banknote"
        case .creditCard: "creditcard"
        case .cash: "dollarsign.circle"
        case .investment: "chart.line.uptrend.xyaxis"
        case .loan: "doc.text"
        }
    }
}

enum CategoryKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case income, expense, transfer

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum TransactionType: String, Codable, CaseIterable, Identifiable, Sendable {
    case income, expense, transfer

    var id: String { rawValue }
    var label: String { rawValue.capitalized }

    /// Stored amounts are positive magnitudes; income adds, everything else subtracts.
    func signed(_ amountCents: Int) -> Int { self == .income ? amountCents : -amountCents }
}

enum TransactionSource: String, Codable, Sendable {
    case manual, scanned, imported
}

enum BudgetPeriod: String, Codable, CaseIterable, Identifiable, Sendable {
    case weekly, monthly

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum RecurringType: String, Codable, CaseIterable, Identifiable, Sendable {
    case income, expense

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var transactionType: TransactionType { self == .income ? .income : .expense }
    func signed(_ amountCents: Int) -> Int { self == .income ? amountCents : -amountCents }
}

enum RecurringFrequency: String, Codable, CaseIterable, Identifiable, Sendable {
    case weekly, biweekly, monthly, quarterly, yearly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .weekly: "Weekly"
        case .biweekly: "Every 2 weeks"
        case .monthly: "Monthly"
        case .quarterly: "Quarterly"
        case .yearly: "Yearly"
        }
    }
}

enum DebtType: String, Codable, CaseIterable, Identifiable, Sendable {
    case creditCard = "credit_card", studentLoan = "student_loan", mortgage, auto, personal, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .creditCard: "Credit card"
        case .studentLoan: "Student loan"
        case .mortgage: "Mortgage"
        case .auto: "Auto loan"
        case .personal: "Personal loan"
        case .other: "Other"
        }
    }
}

enum HouseholdRole: String, Codable, Sendable {
    case owner, member
}
