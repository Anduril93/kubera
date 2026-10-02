import SwiftUI

struct BudgetsView: View {
    @Environment(AppModel.self) private var app
    @State private var budgets: [BudgetWithSpend] = []
    @State private var loaded = false
    @State private var showingAdd = false
    @State private var editing: BudgetWithSpend?
    @State private var deleting: BudgetWithSpend?

    var body: some View {
        List {
            if !budgets.isEmpty {
                Section { totalRow }
                Section {
                    ForEach(budgets) { item in
                        BudgetRow(item: item, currency: app.currency)
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
                                Button("Edit", systemImage: "pencil") { editing = item }
                            }
                            .contextMenu {
                                Button("Edit", systemImage: "pencil") { editing = item }
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
                            }
                    }
                }
            }
        }
        .navigationTitle("Budgets")
        .toolbar {
            if !budgets.isEmpty {
                Button("Create budget", systemImage: "plus") { showingAdd = true }
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .emptyState(when: loaded && budgets.isEmpty, "No budgets yet", systemImage: "target",
                    description: "Set a spending limit for a category and track how much of it you’ve used this period.") {
            Button("Create budget", systemImage: "plus") { showingAdd = true }.goldProminent()
        }
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingAdd) { BudgetFormView(existing: nil) }
        .sheet(item: $editing) { BudgetFormView(existing: $0.budget) }
        .alert("Delete this budget?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
               presenting: deleting) { item in
            Button("Delete", role: .destructive) { delete(item) }
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text("This removes the \(item.budget.category?.name ?? "category") budget. Your transactions aren’t affected.")
        }
    }

    private var totalRow: some View {
        let spent = budgets.reduce(0) { $0 + $1.spentCents }
        let amount = budgets.reduce(0) { $0 + $1.budget.amountCents }
        let status = BudgetStatus(spentCents: spent, amountCents: amount)
        return VStack(alignment: .leading, spacing: 10) {
            Text("All budgets").font(.headline)
            HStack(alignment: .firstTextBaseline) {
                MoneyText(cents: spent, currency: app.currency, tone: .neutral).font(.title2.weight(.semibold)).fontDesign(.serif)
                Text("spent of \(Money.format(amount, currency: app.currency))").foregroundStyle(.secondary)
                Spacer()
                LeftOrOver(remainingCents: amount - spent, currency: app.currency)
            }
            ProgressBar(fraction: amount > 0 ? Double(spent) / Double(amount) : 0, tint: status.tint)
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        do {
            budgets = try await BudgetsAPI.listWithSpend(householdId: householdId, fiscalStartDay: app.fiscalMonthStartDay)
        } catch {
            app.toasts.error(userMessage(for: error, context: "budgets", fallback: "Couldn't load budgets."))
        }
        loaded = true
    }

    private func delete(_ item: BudgetWithSpend) {
        Task {
            do {
                try await BudgetsAPI.delete(item.id)
                await app.didMutate()
                app.toasts.show("Budget deleted")
            } catch {
                app.toasts.error(userMessage(for: error, context: "budgets", fallback: "Could not delete the budget."))
            }
        }
    }
}

struct BudgetRow: View {
    let item: BudgetWithSpend
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                CategoryDot(hex: item.budget.category?.color)
                Text(item.budget.category?.name ?? "Category").font(.headline)
                Spacer()
                item.status.pill
            }
            Text("\(item.budget.period.label) · \(item.periodLabel)").font(.subheadline).foregroundStyle(.secondary)
            ProgressBar(fraction: item.budget.amountCents > 0 ? Double(item.spentCents) / Double(item.budget.amountCents) : 0,
                        tint: item.status.tint)
            HStack {
                Text("\(Text(Money.format(item.spentCents, currency: currency)).fontWeight(.semibold)) of \(Money.format(item.budget.amountCents, currency: currency)) · \(item.percentUsed)%")
                    .monospacedDigit()
                Spacer()
                LeftOrOver(remainingCents: item.remainingCents, currency: currency)
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// "$X left" (muted) or "$X over" (red).
struct LeftOrOver: View {
    let remainingCents: Int
    let currency: String

    var body: some View {
        if remainingCents < 0 {
            Text("\(Money.format(-remainingCents, currency: currency)) over").foregroundStyle(Color.negative).monospacedDigit()
        } else {
            Text("\(Money.format(remainingCents, currency: currency)) left").foregroundStyle(.secondary).monospacedDigit()
        }
    }
}

extension BudgetStatus {
    var tint: Color {
        switch self {
        case .under: .accentColor
        case .near: .warning
        case .over: .negative
        }
    }

    var pill: Pill {
        switch self {
        case .under: Pill(text: label)
        case .near: Pill(text: label, style: .warning)
        case .over: Pill(text: label, style: .danger)
        }
    }
}

struct BudgetFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: Budget?

    @State private var categoryId: UUID?
    @State private var period: BudgetPeriod = .monthly
    @State private var amount = ""
    @State private var startDate = CalendarDate.today()
    @State private var rollover = false
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CategoryPicker(title: "Category", selection: $categoryId,
                                   categories: app.categories(of: .expense),
                                   noneLabel: categoryId == nil ? "Pick a category" : nil)
                    Picker("Period", selection: $period) {
                        ForEach(BudgetPeriod.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    AmountField(title: "Amount", text: $amount)
                    CalendarDatePicker(title: "Start date", date: $startDate)
                } footer: {
                    FormErrorRow(message: error)
                }
            }
            .navigationTitle(existing == nil ? "Create budget" : "Edit budget")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save", action: save).disabled(isSaving)
                }
            }
            .onFirstAppear {
                guard let existing else { return }
                categoryId = existing.categoryId
                period = existing.period
                amount = Money.inputString(existing.amountCents)
                startDate = existing.startDate
                rollover = existing.rollover // preserved (the web form reset it)
            }
        }
    }

    private func save() {
        error = nil
        guard let categoryId else { error = "Pick a category"; return }
        guard !amount.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Enter an amount"; return }
        guard let cents = try? Money.parse(amount) else { error = "Enter a valid amount"; return }
        guard let householdId = app.household?.id else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await BudgetsAPI.save(id: existing?.id, householdId: householdId, categoryId: categoryId,
                                          period: period, amountCents: cents, startDate: startDate, rollover: rollover)
                await app.didMutate()
                app.toasts.show(existing == nil ? "Budget created" : "Budget updated")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "budgets", fallback: "Could not save the budget.")
            }
        }
    }
}
