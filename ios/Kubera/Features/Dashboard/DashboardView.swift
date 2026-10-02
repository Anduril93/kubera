import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(AppModel.self) private var app

    @State private var summary: MonthSummary?
    @State private var spending: [CategorySpend] = []
    @State private var recent: [LedgerItem] = []
    @State private var form: TransactionFormView.Mode?
    @State private var scanner = ReceiptScanner()

    private var range: FiscalRange { Fiscal.monthRange(containing: .today(), startDay: app.fiscalMonthStartDay) }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                netWorthCard
                monthCard
                spendingCard
                recentCard
                insightsCard
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Dashboard")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ScanReceiptMenu(scanner: scanner)
                    .disabled(scanner.isWorking)
                Button("Add transaction", systemImage: "plus") {
                    if app.requireAccount() { form = .create() }
                }
            }
        }
        .overlay { if scanner.isWorking { ScanningOverlay() } }
        .task(id: app.dataVersion) { await load() }
        .refreshable {
            await app.syncBanks(announce: true)
            await app.didMutate()
        }
        .sheet(item: $form) { TransactionFormView(mode: $0) }
        .receiptScanner(scanner) { form = .create(scan: $0) }
    }

    // MARK: Cards

    private var netWorthCard: some View {
        let net = NetPosition(accounts: app.accounts)
        return Card {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Net worth").font(.subheadline).foregroundStyle(.secondary)
                    MoneyText(cents: net.netCents, currency: app.currency, tone: .signed)
                        .heroAmount()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                Divider()
                HStack {
                    StatColumn(label: "Assets", cents: net.assetsCents, currency: app.currency)
                    StatColumn(label: "Liabilities", cents: net.liabilitiesCents, currency: app.currency,
                               tone: .expense(net.liabilitiesCents))
                }
            }
        }
    }

    private var monthCard: some View {
        let s = summary ?? MonthSummary(incomeCents: 0, expenseCents: 0)
        return Card("This month", subtitle: range.label) {
            HStack {
                StatColumn(label: "Income", cents: s.incomeCents, currency: app.currency, tone: .income(s.incomeCents))
                StatColumn(label: "Expenses", cents: s.expenseCents, currency: app.currency, tone: .expense(s.expenseCents))
                StatColumn(label: "Net", cents: s.netCents, currency: app.currency, tone: .signed)
            }
        }
    }

    private var spendingCard: some View {
        let total = spending.reduce(0) { $0 + $1.valueCents }
        return Card("Spending by category") {
            if total > 0 { MoneyText(cents: total, currency: app.currency, tone: .neutral).font(.subheadline) }
        } content: {
            if total == 0 {
                Text("No spending recorded this month yet.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 16) {
                    Chart(spending) { item in
                        SectorMark(
                            angle: .value("Amount", item.valueCents),
                            innerRadius: .ratio(0.66),
                            angularInset: 1.5
                        )
                        .cornerRadius(3)
                        .foregroundStyle(Color(hex: item.color))
                        .accessibilityLabel(item.name)
                        .accessibilityValue(Money.format(item.valueCents, currency: app.currency))
                    }
                    .frame(height: 180)
                    .chartBackground { _ in
                        VStack(spacing: 0) {
                            Text("Total").font(.caption).foregroundStyle(.secondary)
                            MoneyText(cents: total, currency: app.currency, tone: .neutral)
                                .font(.headline)
                        }
                    }

                    VStack(spacing: 8) {
                        ForEach(spending) { item in
                            HStack {
                                CategoryDot(hex: item.color)
                                Text(item.name).lineLimit(1)
                                Spacer()
                                Text("\(Money.format(item.valueCents, currency: app.currency)) · \(jsRound(Double(item.valueCents) / Double(total) * 100))%")
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }

    private var recentCard: some View {
        Card("Recent activity") {
            Button("View all") { app.selectedTab = .transactions }
                .font(.subheadline)
        } content: {
            if recent.isEmpty {
                Text("No transactions yet.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(recent.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider() }
                        Button {
                            form = .edit(item)
                        } label: {
                            TransactionRow(transaction: item.transaction, isSplit: !item.children.isEmpty)
                                .padding(.vertical, 8)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var insightsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Monthly insights", systemImage: "sparkles").font(.headline)
                    Spacer()
                    Pill(text: "Coming soon")
                }
                Text("AI-written summaries of your spending trends, budget progress, and anomalies will appear here. This arrives with the AI features in a later phase.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        let range = range
        do {
            async let summary = DashboardAPI.monthSummary(householdId: householdId, range: range)
            async let spending = DashboardAPI.spending(householdId: householdId, range: range)
            async let recent = TransactionsAPI.ledger(householdId: householdId, filters: LedgerFilters(), page: 1, pageSize: 8)
            let (s, sp, r) = try await (summary, spending, recent)
            self.summary = s
            self.spending = sp
            self.recent = r.items
        } catch {
            app.toasts.error(userMessage(for: error, context: "dashboard", fallback: "Couldn't load the dashboard."))
        }
    }
}
