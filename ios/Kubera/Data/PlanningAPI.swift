import Foundation
import Supabase

// Dashboard aggregates, budgets, recurring rules, goals and debts.

enum DashboardAPI {
    /// Income vs expense over top-level rows in [start, end).
    static func monthSummary(householdId: UUID, range: FiscalRange) async throws -> MonthSummary {
        struct R: Decodable {
            let amountCents: Int
            let type: TransactionType
            enum CodingKeys: String, CodingKey { case type; case amountCents = "amount_cents" }
        }
        let rows: [R] = try await DB.client.from("transactions")
            .select("amount_cents, type")
            .eq("household_id", value: householdId)
            .is("split_parent_id", value: nil)
            .in("type", values: ["income", "expense"])
            .gte("date", value: range.start.description)
            .lt("date", value: range.end.description)
            .execute().value
        return MonthSummary(
            incomeCents: rows.filter { $0.type == .income }.reduce(0) { $0 + $1.amountCents },
            expenseCents: rows.filter { $0.type == .expense }.reduce(0) { $0 + $1.amountCents }
        )
    }

    static func spending(householdId: UUID, range: FiscalRange) async throws -> [CategorySpend] {
        let rows: [SpendRow] = try await DB.client.from("transactions")
            .select("id, split_parent_id, category_id, amount_cents, category:categories(id, name, kind, color)")
            .eq("household_id", value: householdId)
            .eq("type", value: "expense")
            .gte("date", value: range.start.description)
            .lt("date", value: range.end.description)
            .execute().value
        return Spending.byCategory(rows)
    }
}

struct BudgetWithSpend: Identifiable, Hashable, Sendable {
    let budget: Budget
    let spentCents: Int
    let periodLabel: String
    var id: UUID { budget.id }
    var remainingCents: Int { budget.amountCents - spentCents }
    var percentUsed: Int { Kubera.percentUsed(spentCents: spentCents, amountCents: budget.amountCents) }
    var status: BudgetStatus { BudgetStatus(spentCents: spentCents, amountCents: budget.amountCents) }
}

enum BudgetsAPI {
    static func listWithSpend(householdId: UUID, fiscalStartDay: Int, today: CalendarDate = .today()) async throws -> [BudgetWithSpend] {
        let budgets: [Budget] = try await DB.client.from("budgets")
            .select("id, category_id, period, amount_cents, rollover, start_date, category:categories(id, name, kind, color)")
            .eq("household_id", value: householdId)
            .order("created_at", ascending: true)
            .execute().value
        let monthly = Fiscal.monthRange(containing: today, startDay: fiscalStartDay)
        let weekly = Fiscal.weekRange(containing: today)

        return try await withThrowingTaskGroup(of: (Int, Int).self) { group in
            for (index, budget) in budgets.enumerated() {
                let range = budget.period == .monthly ? monthly : weekly
                group.addTask {
                    let spent: Int = try await DB.client.rpc("category_period_spend", params: [
                        "p_category_id": .of(budget.categoryId),
                        "p_start": .of(range.start),
                        "p_end": .of(range.end),
                        "p_household_id": .of(householdId),
                    ]).execute().value
                    return (index, spent)
                }
            }
            var spent = [Int](repeating: 0, count: budgets.count)
            for try await (index, value) in group { spent[index] = value }
            return budgets.enumerated().map { index, budget in
                BudgetWithSpend(
                    budget: budget,
                    spentCents: spent[index],
                    periodLabel: budget.period == .monthly ? monthly.label : weekly.label
                )
            }
        }
    }

    static func save(id: UUID?, householdId: UUID, categoryId: UUID, period: BudgetPeriod,
                     amountCents: Int, startDate: CalendarDate, rollover: Bool) async throws {
        let row: Row = [
            "category_id": .of(categoryId),
            "period": .of(period),
            "amount_cents": .of(amountCents),
            "start_date": .of(startDate),
            "rollover": .of(rollover),
        ]
        do {
            if let id {
                let rows: [IdRow] = try await DB.client.from("budgets")
                    .update(row).eq("id", value: id).select("id").execute().value
                if rows.isEmpty { throw DisplayableError("Budget not found.") }
            } else {
                var insert = row
                insert["household_id"] = .of(householdId)
                try await DB.client.from("budgets").insert(insert).execute()
            }
        } catch where error.postgresCode == "23505" {
            throw DisplayableError("A budget already exists for this category and period.")
        } catch where error.postgresCode == "23503" {
            throw DisplayableError("That category isn't available.")
        }
    }

    static func delete(_ id: UUID) async throws {
        try await DB.client.from("budgets").delete().eq("id", value: id).execute()
    }
}

enum RecurringAPI {
    static func list(householdId: UUID) async throws -> [RecurringRule] {
        try await DB.client.from("recurring_rules")
            .select("""
                id, account_id, category_id, name, amount_cents, type, frequency, next_due_date, end_date, auto_post, \
                account:accounts(id, name), category:categories(id, name, color)
                """)
            .eq("household_id", value: householdId)
            .order("next_due_date", ascending: true)
            .execute().value
    }

    struct Fields {
        var name: String
        var type: RecurringType
        var amountCents: Int
        var accountId: UUID
        var categoryId: UUID?
        var frequency: RecurringFrequency
        var nextDueDate: CalendarDate
        var endDate: CalendarDate?
        var autoPost: Bool
    }

    static func save(id: UUID?, householdId: UUID, _ f: Fields) async throws {
        let row: Row = [
            "name": .of(f.name),
            "type": .of(f.type),
            "amount_cents": .of(f.amountCents),
            "account_id": .of(f.accountId),
            "category_id": .of(f.categoryId),
            "frequency": .of(f.frequency),
            "next_due_date": .of(f.nextDueDate),
            "end_date": .of(f.endDate),
            "auto_post": .of(f.autoPost),
        ]
        do {
            if let id {
                let rows: [IdRow] = try await DB.client.from("recurring_rules")
                    .update(row).eq("id", value: id).select("id").execute().value
                if rows.isEmpty { throw DisplayableError("Rule not found.") }
            } else {
                var insert = row
                insert["household_id"] = .of(householdId)
                try await DB.client.from("recurring_rules").insert(insert).execute()
            }
        } catch where error.postgresMessage.contains("End date") {
            throw DisplayableError("The end date can't be before the next due date.")
        } catch where error.postgresCode == "23503" {
            throw DisplayableError("That account or category isn't available.")
        }
    }

    static func delete(_ id: UUID) async throws {
        try await DB.client.from("recurring_rules").delete().eq("id", value: id).execute()
    }

    /// Posts the due instance. Returns false when the rule isn't due yet.
    static func post(_ id: UUID, today: CalendarDate = .today()) async throws -> Bool {
        let txnId: UUID? = try await DB.client.rpc("post_recurring_rule", params: [
            "p_id": .of(id),
            "p_today": .of(today),
        ]).execute().value
        return txnId != nil
    }
}

struct GoalWithProgress: Identifiable, Hashable, Sendable {
    let goal: SavingsGoal
    let progress: GoalProgress
    let currency: String
    var id: UUID { goal.id }
    var isLinked: Bool { goal.linkedAccountId != nil && goal.linkedAccount != nil }
}

enum GoalsAPI {
    static let defaultColor = "#10b981"

    static func list(householdId: UUID, defaultCurrency: String, today: CalendarDate = .today()) async throws -> [GoalWithProgress] {
        let goals: [SavingsGoal] = try await DB.client.from("savings_goals")
            .select("""
                id, name, target_amount_cents, target_date, linked_account_id, current_amount_cents, color, icon, created_at, \
                linked_account:accounts!linked_account_id(id, name, current_balance_cents, currency)
                """)
            .eq("household_id", value: householdId)
            .order("created_at", ascending: true)
            .execute().value
        return goals.map { goal in
            let linked = goal.linkedAccountId != nil ? goal.linkedAccount : nil
            let current = linked?.currentBalanceCents ?? goal.currentAmountCents
            return GoalWithProgress(
                goal: goal,
                progress: GoalProgress(
                    currentCents: current, targetCents: goal.targetAmountCents, targetDate: goal.targetDate,
                    createdOn: .utcDay(of: goal.createdAt), today: today
                ),
                currency: linked?.currency ?? defaultCurrency
            )
        }
    }

    static func create(householdId: UUID, name: String, targetCents: Int, targetDate: CalendarDate?,
                       linkedAccountId: UUID?, startingCents: Int) async throws {
        try await DB.client.from("savings_goals").insert([
            "household_id": .of(householdId),
            "name": .of(name),
            "target_amount_cents": .of(targetCents),
            "target_date": .of(targetDate),
            "linked_account_id": .of(linkedAccountId),
            "current_amount_cents": .of(linkedAccountId == nil ? startingCents : 0),
            "color": .string(defaultColor),
            "icon": .string("PiggyBank"),
        ]).execute()
    }

    static func update(_ id: UUID, name: String, targetCents: Int, targetDate: CalendarDate?, linkedAccountId: UUID?) async throws {
        let rows: [IdRow] = try await DB.client.from("savings_goals").update([
            "name": .of(name),
            "target_amount_cents": .of(targetCents),
            "target_date": .of(targetDate),
            "linked_account_id": .of(linkedAccountId),
        ]).eq("id", value: id).select("id").execute().value
        if rows.isEmpty { throw DisplayableError("Goal not found.") }
    }

    static func delete(_ id: UUID) async throws {
        try await DB.client.from("savings_goals").delete().eq("id", value: id).execute()
    }

    static func contribute(_ id: UUID, deltaCents: Int) async throws {
        do {
            try await DB.client.rpc("contribute_to_goal", params: ["p_id": .of(id), "p_delta": .of(deltaCents)]).execute()
        } catch where error.postgresMessage.contains("account balance") {
            throw DisplayableError("This goal tracks an account balance — contributions are automatic, not manual.")
        }
    }
}

struct DebtWithPayoff: Identifiable, Hashable, Sendable {
    let debt: Debt
    let balanceCents: Int
    let currency: String
    let payoff: Payoff
    var id: UUID { debt.id }
    var isLinked: Bool { debt.linkedAccountId != nil && debt.linkedAccount != nil }
}

enum DebtsAPI {
    static func list(householdId: UUID, defaultCurrency: String) async throws -> [DebtWithPayoff] {
        let debts: [Debt] = try await DB.client.from("debts")
            .select("""
                id, name, type, principal_cents, apr, minimum_payment_cents, due_day, linked_account_id, created_at, \
                linked_account:accounts!linked_account_id(id, name, current_balance_cents, currency)
                """)
            .eq("household_id", value: householdId)
            .order("created_at", ascending: true)
            .execute().value
        return debts.map { debt in
            let linked = debt.linkedAccountId != nil ? debt.linkedAccount : nil
            let balance = linked?.currentBalanceCents ?? debt.principalCents
            return DebtWithPayoff(
                debt: debt, balanceCents: balance, currency: linked?.currency ?? defaultCurrency,
                payoff: Payoff(balanceCents: balance, apr: debt.apr, minimumPaymentCents: debt.minimumPaymentCents)
            )
        }
    }

    struct Fields {
        var name: String
        var type: DebtType
        var linkedAccountId: UUID?
        var principalCents: Int
        var apr: Double?
        var minimumPaymentCents: Int?
        var dueDay: Int?
    }

    static func save(id: UUID?, householdId: UUID, _ f: Fields) async throws {
        var row: Row = [
            "name": .of(f.name),
            "type": .of(f.type),
            "linked_account_id": .of(f.linkedAccountId),
            "principal_cents": .of(f.linkedAccountId == nil ? f.principalCents : 0),
            "apr": .of(f.apr),
            "minimum_payment_cents": .of(f.minimumPaymentCents),
            "due_day": .of(f.dueDay),
        ]
        do {
            if let id {
                let rows: [IdRow] = try await DB.client.from("debts")
                    .update(row).eq("id", value: id).select("id").execute().value
                if rows.isEmpty { throw DisplayableError("Debt not found.") }
            } else {
                row["household_id"] = .of(householdId)
                try await DB.client.from("debts").insert(row).execute()
            }
        } catch where error.postgresCode == "23503" {
            throw DisplayableError("That account isn't available.")
        }
    }

    static func delete(_ id: UUID) async throws {
        try await DB.client.from("debts").delete().eq("id", value: id).execute()
    }
}
