import Foundation
import Testing
@testable import Kubera

private func d(_ s: String) -> CalendarDate { CalendarDate(string: s)! }

@Suite("Money")
struct MoneyTests {
    @Test func parsesDollarStringsToCents() throws {
        #expect(try Money.parse("12.34") == 1234)
        #expect(try Money.parse("$1,234.5") == 123450)
        #expect(try Money.parse("  7 ") == 700)
        #expect(try Money.parse(".5") == 50)
        #expect(try Money.parse("0") == 0)
    }

    @Test func roundsHalfUpExactly() throws {
        #expect(try Money.parse("1.005") == 101)
        #expect(try Money.parse("1.004") == 100)
        #expect(try Money.parse("0.125") == 13)
    }

    @Test func negativesOnlyWhenAllowed() throws {
        #expect(throws: Money.ParseError.negative) { try Money.parse("-5") }
        #expect(try Money.parse("-5", allowNegative: true) == -500)
        #expect(try Money.parse("5-3") == 5300) // only a leading minus counts, like the web app
    }

    @Test func rejectsGarbage() {
        #expect(throws: Money.ParseError.empty) { try Money.parse("   ") }
        #expect(throws: Money.ParseError.invalid) { try Money.parse("abc") }
        #expect(throws: Money.ParseError.invalid) { try Money.parse("$") }
        #expect(throws: Money.ParseError.invalid) { try Money.parse("1.2.3") }
    }

    @Test func formats() {
        #expect(Money.format(123456) == "$1,234.56")
        #expect(Money.format(-500) == "-$5.00")
        #expect(Money.format(0) == "$0.00")
        #expect(Money.inputString(1250) == "12.50")
        #expect(Money.inputString(-5) == "-0.05")
    }
}

@Suite("CalendarDate")
struct CalendarDateTests {
    @Test func parsesAndPrints() {
        #expect(d("2026-10-01").description == "2026-10-01")
        #expect(CalendarDate(string: "2026-10-01T12:00:00+00:00") == d("2026-10-01"))
        #expect(CalendarDate(string: "nope") == nil)
        #expect(CalendarDate(string: "2026-13-01") == nil)
    }

    @Test func monthArithmeticClamps() {
        #expect(d("2026-01-31").adding(months: 1) == d("2026-02-28"))
        #expect(d("2028-01-31").adding(months: 1) == d("2028-02-29"))
        #expect(d("2026-12-15").adding(days: 20) == d("2027-01-04"))
    }

    @Test func decodesFromJSON() throws {
        let decoded = try JSONDecoder().decode([CalendarDate].self, from: Data(#"["2026-03-09"]"#.utf8))
        #expect(decoded == [d("2026-03-09")])
        #expect(String(data: try JSONEncoder().encode(decoded), encoding: .utf8) == #"["2026-03-09"]"#)
    }
}

@Suite("Fiscal ranges")
struct FiscalTests {
    @Test func calendarMonthWhenStartDayIsOne() {
        let r = Fiscal.monthRange(containing: d("2026-10-17"), startDay: 1)
        #expect(r.start == d("2026-10-01"))
        #expect(r.end == d("2026-11-01"))
        #expect(r.label == "October 2026")
    }

    @Test func customStartDayBeforeAndAfterBoundary() {
        let before = Fiscal.monthRange(containing: d("2026-10-14"), startDay: 15)
        #expect(before.start == d("2026-09-15"))
        #expect(before.end == d("2026-10-15"))
        #expect(before.label == "Sep 15 – Oct 14")

        let on = Fiscal.monthRange(containing: d("2026-10-15"), startDay: 15)
        #expect(on.start == d("2026-10-15"))
    }

    @Test func januaryWrapsToPreviousYear() {
        let r = Fiscal.monthRange(containing: d("2026-01-03"), startDay: 10)
        #expect(r.start == d("2025-12-10"))
        #expect(r.end == d("2026-01-10"))
    }

    @Test func startDayIsClampedTo28() {
        #expect(Fiscal.monthRange(containing: d("2026-03-30"), startDay: 31).start == d("2026-03-28"))
        #expect(Fiscal.monthRange(containing: d("2026-03-30"), startDay: 0).start == d("2026-03-01"))
    }

    @Test func weekIsMondayToSunday() {
        // 2026-10-01 is a Thursday.
        let r = Fiscal.weekRange(containing: d("2026-10-01"))
        #expect(r.start == d("2026-09-28"))
        #expect(r.end == d("2026-10-05"))
        #expect(r.label == "Sep 28 – Oct 4")
        // Sunday belongs to the week that started the previous Monday.
        #expect(Fiscal.weekRange(containing: d("2026-10-04")).start == d("2026-09-28"))
        #expect(Fiscal.weekRange(containing: d("2026-10-05")).start == d("2026-10-05"))
    }
}

@Suite("Budgets")
struct BudgetTests {
    @Test func statusThresholds() {
        #expect(BudgetStatus(spentCents: 0, amountCents: 0) == .under)
        #expect(BudgetStatus(spentCents: 79, amountCents: 100) == .under)
        #expect(BudgetStatus(spentCents: 80, amountCents: 100) == .near)
        #expect(BudgetStatus(spentCents: 100, amountCents: 100) == .near)
        #expect(BudgetStatus(spentCents: 101, amountCents: 100) == .over)
    }

    @Test func percentRoundsLikeJavaScript() {
        #expect(percentUsed(spentCents: 1, amountCents: 8) == 13) // 12.5 → 13
        #expect(percentUsed(spentCents: 150, amountCents: 100) == 150)
        #expect(percentUsed(spentCents: 5, amountCents: 0) == 0)
    }
}

@Suite("Recurring")
struct RecurringTests {
    private func rule(_ next: String, _ freq: RecurringFrequency, type: RecurringType = .expense, amount: Int = 1000, end: String? = nil) -> RecurringRule {
        RecurringRule(
            id: UUID(), accountId: UUID(), categoryId: nil, name: "R", amountCents: amount, type: type,
            frequency: freq, nextDueDate: d(next), endDate: end.map(d), autoPost: false, account: nil, category: nil
        )
    }

    @Test func advanceDriftsFromClampedDate() {
        let feb = Recurring.advance(d("2026-01-31"), by: .monthly)
        #expect(feb == d("2026-02-28"))
        #expect(Recurring.advance(feb, by: .monthly) == d("2026-03-28"))
        #expect(Recurring.advance(d("2026-10-01"), by: .biweekly) == d("2026-10-15"))
        #expect(Recurring.advance(d("2026-11-30"), by: .quarterly) == d("2027-02-28"))
        #expect(Recurring.advance(d("2028-02-29"), by: .yearly) == d("2029-02-28"))
    }

    @Test func occurrencesSkipOverdueAndHonorEndDate() {
        let today = d("2026-10-01")
        let end = today.adding(days: 30)
        #expect(Recurring.occurrences(of: rule("2026-10-01", .weekly), from: today, through: end) == 5)
        #expect(Recurring.occurrences(of: rule("2026-09-20", .weekly), from: today, through: end) == 4)
        #expect(Recurring.occurrences(of: rule("2026-10-01", .weekly, end: "2026-10-10"), from: today, through: end) == 2)
        #expect(Recurring.occurrences(of: rule("2026-12-01", .monthly), from: today, through: end) == 0)
    }

    @Test func monthAheadTotals() {
        let today = d("2026-10-01")
        let totals = Recurring.totals(for: [
            rule("2026-10-05", .monthly, type: .income, amount: 500_000),
            rule("2026-10-01", .weekly, amount: 10_000),
        ], today: today)
        #expect(totals.incomeCents == 500_000)
        #expect(totals.expenseCents == 50_000)
        #expect(totals.netCents == 450_000)
    }

    @Test func classifyOverdueAndUpcoming() {
        let today = d("2026-10-01")
        let c = Recurring.classify([
            rule("2026-09-30", .monthly), rule("2026-10-01", .monthly),
            rule("2026-10-31", .monthly), rule("2026-11-01", .monthly),
        ], today: today)
        #expect(c.overdue.map(\.nextDueDate) == [d("2026-09-30")])
        #expect(c.upcoming.map(\.nextDueDate) == [d("2026-10-01"), d("2026-10-31")])
    }
}

@Suite("Debt payoff")
struct PayoffTests {
    @Test func cases() {
        #expect(Payoff(balanceCents: 0, apr: 20, minimumPaymentCents: 100) == .paidOff)
        #expect(Payoff(balanceCents: 100, apr: 20, minimumPaymentCents: nil) == .noPayment)
        #expect(Payoff(balanceCents: 100_000, apr: 0, minimumPaymentCents: 30_000) == .months(4))
        // $1,000 at 24% APR → $20/mo interest; $20 doesn't cover it.
        #expect(Payoff(balanceCents: 100_000, apr: 24, minimumPaymentCents: 2_000) == .minBelowInterest)
        // $5,000 at 18% paying $200/mo ≈ 31.9 → 32 months.
        #expect(Payoff(balanceCents: 500_000, apr: 18, minimumPaymentCents: 20_000) == .months(32))
    }

    @Test func durationLabels() {
        #expect(Payoff.durationLabel(months: 8) == "8 mo")
        #expect(Payoff.durationLabel(months: 24) == "2 yr")
        #expect(Payoff.durationLabel(months: 40) == "3 yr 4 mo")
    }
}

@Suite("Goals")
struct GoalTests {
    @Test func progressAndPace() {
        let created = d("2026-01-01")
        let target = d("2026-12-31")
        let half = GoalProgress(currentCents: 5_000, targetCents: 10_000, targetDate: target, createdOn: created, today: d("2026-04-01"))
        #expect(half.percentComplete == 50)
        #expect(half.remainingCents == 5_000)
        #expect(half.pace == .onPace)

        let behind = GoalProgress(currentCents: 1_000, targetCents: 10_000, targetDate: target, createdOn: created, today: d("2026-07-01"))
        #expect(behind.pace == .behind)

        let late = GoalProgress(currentCents: 1_000, targetCents: 10_000, targetDate: target, createdOn: created, today: d("2027-01-01"))
        #expect(late.pace == .pastDue)

        let done = GoalProgress(currentCents: 12_000, targetCents: 10_000, targetDate: target, createdOn: created, today: d("2027-01-01"))
        #expect(done.isComplete && done.pace == .complete && done.remainingCents == 0 && done.percentComplete == 120)

        let noDate = GoalProgress(currentCents: 0, targetCents: 0, targetDate: nil, createdOn: created, today: created)
        #expect(noDate.pace == nil && noDate.percentComplete == 0)
    }
}

@Suite("Spending & net worth")
struct DashboardMathTests {
    @Test func splitPartsReplaceParentsAndUncategorizedRollsUp() {
        let groceries = CategoryRef(id: UUID(), name: "Groceries", kind: .expense, color: "#f59e0b")
        let parent = UUID()
        let rows = [
            SpendRow(id: parent, splitParentId: nil, categoryId: groceries.id, amountCents: 1_000, category: groceries),
            SpendRow(id: UUID(), splitParentId: parent, categoryId: groceries.id, amountCents: 600, category: groceries),
            SpendRow(id: UUID(), splitParentId: parent, categoryId: nil, amountCents: 400, category: nil),
            SpendRow(id: UUID(), splitParentId: nil, categoryId: groceries.id, amountCents: 250, category: groceries),
            SpendRow(id: UUID(), splitParentId: nil, categoryId: nil, amountCents: 100, category: nil),
        ]
        let result = Spending.byCategory(rows)
        #expect(result.map(\.name) == ["Groceries", "Uncategorized"])
        #expect(result.map(\.valueCents) == [850, 500])
        #expect(result[1].color == CategorySpend.uncategorizedColor)
    }

    @Test func netPositionTreatsCardsAndLoansAsLiabilities() {
        func account(_ type: AccountType, _ cents: Int) -> Account {
            Account(id: UUID(), householdId: UUID(), name: "A", type: type, institution: nil,
                    currentBalanceCents: cents, currency: "USD", isManual: true, isArchived: false)
        }
        let net = NetPosition(accounts: [account(.checking, 10_000), account(.savings, 5_000), account(.creditCard, 2_500), account(.loan, 1_000)])
        #expect(net.assetsCents == 15_000)
        #expect(net.liabilitiesCents == 3_500)
        #expect(net.netCents == 11_500)
        #expect(AccountGroup.grouping([account(.loan, 1), account(.checking, 2)]).map(\.type) == [.checking, .loan])
    }
}

@Suite("Invite codes & file types")
struct MiscTests {
    @Test func inviteCodesUseTheSafeAlphabet() {
        let code = InviteCode.generate()
        #expect(code.count == 8)
        #expect(code.allSatisfy { InviteCode.alphabet.contains($0) })
        #expect(InviteCode.normalize(" abcd efgh\n") == "ABCDEFGH")
    }

    @Test func magicBytes() {
        #expect(ReceiptFileType.detect(Data([0xFF, 0xD8, 0xFF, 0xE0])) == .jpeg)
        #expect(ReceiptFileType.detect(Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) == .png)
        #expect(ReceiptFileType.detect(Data("RIFF\0\0\0\0WEBP".utf8)) == .webp)
        #expect(ReceiptFileType.detect(Data("%PDF-1.7".utf8)) == .pdf)
        #expect(ReceiptFileType.detect(Data("GIF89a".utf8)) == nil)
        #expect(ReceiptFileType.detect(Data()) == nil)
    }
}
