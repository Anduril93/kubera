import Foundation

// Pure computations ported from the web app's *-meta.ts / dashboard.ts.
// Kept free of UI and networking so they're unit-tested in KuberaTests.

// MARK: - Accounts (accounts-meta.ts)

struct NetPosition: Equatable, Sendable {
    let assetsCents: Int
    let liabilitiesCents: Int
    var netCents: Int { assetsCents - liabilitiesCents }

    /// Liability balances (credit cards, loans) are stored as positive amounts owed.
    init(accounts: [Account]) {
        var assets = 0
        var liabilities = 0
        for account in accounts {
            if account.type.isLiability {
                liabilities += account.currentBalanceCents
            } else {
                assets += account.currentBalanceCents
            }
        }
        assetsCents = assets
        liabilitiesCents = liabilities
    }
}

struct AccountGroup: Identifiable, Sendable {
    let type: AccountType
    let accounts: [Account]
    var id: AccountType { type }
    var subtotalCents: Int { accounts.reduce(0) { $0 + $1.currentBalanceCents } }

    /// Fixed display order (checking → loan); empty groups are dropped.
    static func grouping(_ accounts: [Account]) -> [AccountGroup] {
        AccountType.allCases.compactMap { type in
            let inType = accounts.filter { $0.type == type }
            return inType.isEmpty ? nil : AccountGroup(type: type, accounts: inType)
        }
    }
}

// MARK: - Budgets (budgets-meta.ts)

enum BudgetStatus: Sendable {
    case under, near, over

    static let nearLimitRatio = 0.8

    init(spentCents: Int, amountCents: Int) {
        if amountCents <= 0 {
            self = .under
        } else if spentCents > amountCents {
            self = .over
        } else if Double(spentCents) / Double(amountCents) >= Self.nearLimitRatio {
            self = .near
        } else {
            self = .under
        }
    }

    var label: String {
        switch self {
        case .under: "On track"
        case .near: "Near limit"
        case .over: "Over budget"
        }
    }
}

/// Math.round(x) for non-negative x — JavaScript rounds .5 up.
func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

func percentUsed(spentCents: Int, amountCents: Int) -> Int {
    amountCents > 0 ? jsRound(Double(spentCents) / Double(amountCents) * 100) : 0
}

// MARK: - Recurring (recurring-meta.ts)

enum Recurring {
    /// Next occurrence after `date`. Month-based steps clamp to month end and
    /// each step starts from the previous (clamped) date, so Jan 31 → Feb 28 →
    /// Mar 28 — the same drift as date-fns and Postgres' advance_recurring_date.
    static func advance(_ date: CalendarDate, by frequency: RecurringFrequency) -> CalendarDate {
        switch frequency {
        case .weekly: date.adding(days: 7)
        case .biweekly: date.adding(days: 14)
        case .monthly: date.adding(months: 1)
        case .quarterly: date.adding(months: 3)
        case .yearly: date.adding(years: 1)
        }
    }

    /// Occurrences of `rule` falling in [start, end] (both inclusive), honoring
    /// end_date. Occurrences before `start` (overdue ones) are stepped over.
    static func occurrences(of rule: RecurringRule, from start: CalendarDate, through end: CalendarDate) -> Int {
        var cursor = rule.nextDueDate
        var count = 0
        var steps = 0
        while steps < 500 && cursor <= end {
            if let endDate = rule.endDate, cursor > endDate { break }
            if cursor >= start { count += 1 }
            cursor = advance(cursor, by: rule.frequency)
            steps += 1
        }
        return count
    }

    struct Totals: Equatable, Sendable {
        let incomeCents: Int
        let expenseCents: Int
        var netCents: Int { incomeCents - expenseCents }
    }

    static func totals(for rules: [RecurringRule], today: CalendarDate, days: Int = 30) -> Totals {
        let end = today.adding(days: days)
        var income = 0
        var expense = 0
        for rule in rules {
            let n = occurrences(of: rule, from: today, through: end)
            guard n > 0 else { continue }
            if rule.type == .income { income += n * rule.amountCents } else { expense += n * rule.amountCents }
        }
        return Totals(incomeCents: income, expenseCents: expense)
    }

    struct Classified: Sendable {
        let overdue: [RecurringRule]
        let upcoming: [RecurringRule]
    }

    /// overdue = due before today; upcoming = due today through today + days.
    static func classify(_ rules: [RecurringRule], today: CalendarDate, days: Int = 30) -> Classified {
        let until = today.adding(days: days)
        var overdue: [RecurringRule] = []
        var upcoming: [RecurringRule] = []
        for rule in rules {
            if rule.nextDueDate < today {
                overdue.append(rule)
            } else if rule.nextDueDate <= until {
                upcoming.append(rule)
            }
        }
        return Classified(overdue: overdue, upcoming: upcoming)
    }
}

// MARK: - Debts (debts-meta.ts)

enum Payoff: Hashable, Sendable {
    case paidOff
    case noPayment
    case minBelowInterest
    case months(Int)

    /// Months to pay off `balanceCents` at a fixed monthly payment and APR:
    /// n = ceil(-ln(1 - P·r/M) / ln(1 + r)), r = APR/1200; with r = 0, ceil(P/M).
    init(balanceCents: Int, apr: Double?, minimumPaymentCents: Int?) {
        guard balanceCents > 0 else { self = .paidOff; return }
        guard let m = minimumPaymentCents, m > 0 else { self = .noPayment; return }
        let p = Double(balanceCents)
        let payment = Double(m)
        let rate = (apr ?? 0) / 100 / 12
        if rate <= 0 {
            self = .months(Int((p / payment).rounded(.up)))
            return
        }
        if payment <= p * rate {
            self = .minBelowInterest
            return
        }
        let n = -log(1 - (p * rate) / payment) / log(1 + rate)
        self = .months(Int(n.rounded(.up)))
    }

    /// "8 mo", "2 yr", "3 yr 4 mo"
    static func durationLabel(months: Int) -> String {
        if months < 12 { return "\(months) mo" }
        let years = months / 12
        let rest = months % 12
        return rest == 0 ? "\(years) yr" : "\(years) yr \(rest) mo"
    }

    var description: String {
        switch self {
        case .paidOff:
            "Paid off."
        case .noPayment:
            "Add a minimum payment to estimate payoff."
        case .minBelowInterest:
            "The minimum payment doesn't cover the monthly interest — the balance won't go down at this rate."
        case .months(let n):
            "About \(Payoff.durationLabel(months: n)) to pay off at the minimum — an estimate assuming no new charges."
        }
    }
}

// MARK: - Goals (goals-meta.ts)

enum GoalPace: Hashable, Sendable {
    case onPace, behind, pastDue, complete

    var label: String {
        switch self {
        case .onPace: "On pace"
        case .behind: "Behind"
        case .pastDue: "Past due"
        case .complete: "Complete"
        }
    }
}

struct GoalProgress: Hashable, Sendable {
    let currentCents: Int
    let targetCents: Int
    let percentComplete: Int
    let remainingCents: Int
    let isComplete: Bool
    let pace: GoalPace?

    /// `createdOn` is the goal's created_at as a UTC calendar date (the web app
    /// takes `created_at.slice(0, 10)`); progress is compared against the share
    /// of time elapsed between it and the target date.
    init(currentCents: Int, targetCents: Int, targetDate: CalendarDate?, createdOn: CalendarDate, today: CalendarDate) {
        self.currentCents = currentCents
        self.targetCents = targetCents
        percentComplete = targetCents > 0
            ? Int((Double(currentCents) / Double(targetCents) * 100 + 0.5).rounded(.down))
            : (currentCents > 0 ? 100 : 0)
        remainingCents = max(0, targetCents - currentCents)
        isComplete = targetCents > 0 && currentCents >= targetCents

        guard let targetDate else { pace = nil; return }
        if isComplete {
            pace = .complete
        } else if today > targetDate {
            pace = .pastDue
        } else {
            let total = createdOn.days(to: targetDate)
            let elapsed = createdOn.days(to: today)
            let timeFraction = total > 0 ? min(max(Double(elapsed) / Double(total), 0), 1) : 1
            let progressFraction = targetCents > 0 ? Double(currentCents) / Double(targetCents) : 0
            pace = progressFraction >= timeFraction ? .onPace : .behind
        }
    }
}

extension CalendarDate {
    /// The UTC calendar day of a timestamp (matches `timestamptz.slice(0, 10)`).
    static func utcDay(of date: Date) -> CalendarDate {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        return CalendarDate(date, calendar: utc)
    }
}

// MARK: - Dashboard (dashboard.ts)

struct MonthSummary: Equatable, Sendable {
    let incomeCents: Int
    let expenseCents: Int
    var netCents: Int { incomeCents - expenseCents }
}

struct CategorySpend: Identifiable, Equatable, Sendable {
    static let uncategorizedColor = "#94a3b8"

    let categoryId: UUID?
    let name: String
    let color: String
    var valueCents: Int
    var id: String { categoryId?.uuidString ?? "uncategorized" }
}

/// One expense row as the spending query returns it.
struct SpendRow: Decodable, Sendable {
    let id: UUID
    let splitParentId: UUID?
    let categoryId: UUID?
    let amountCents: Int
    let category: CategoryRef?

    enum CodingKeys: String, CodingKey {
        case id, category
        case splitParentId = "split_parent_id"
        case categoryId = "category_id"
        case amountCents = "amount_cents"
    }
}

enum Spending {
    /// Expense totals per category. Split parents are replaced by their parts;
    /// rows without a category roll up into "Uncategorized". Largest first.
    static func byCategory(_ rows: [SpendRow]) -> [CategorySpend] {
        let parentsWithChildren = Set(rows.compactMap(\.splitParentId))
        var order: [String] = []
        var totals: [String: CategorySpend] = [:]
        for row in rows {
            let isChild = row.splitParentId != nil
            let isChildlessParent = !isChild && !parentsWithChildren.contains(row.id)
            guard isChild || isChildlessParent else { continue }
            let key = row.categoryId?.uuidString ?? "uncategorized"
            if totals[key] != nil {
                totals[key]!.valueCents += row.amountCents
            } else {
                order.append(key)
                totals[key] = CategorySpend(
                    categoryId: row.categoryId,
                    name: row.categoryId == nil ? "Uncategorized" : (row.category?.name ?? "Category"),
                    color: row.categoryId == nil ? CategorySpend.uncategorizedColor : (row.category?.color ?? CategorySpend.uncategorizedColor),
                    valueCents: row.amountCents
                )
            }
        }
        // Stable sort (ties keep first-seen order, like Array.prototype.sort).
        return order.enumerated()
            .map { (index: $0.offset, spend: totals[$0.element]!) }
            .sorted { $0.spend.valueCents != $1.spend.valueCents ? $0.spend.valueCents > $1.spend.valueCents : $0.index < $1.index }
            .map(\.spend)
    }
}
