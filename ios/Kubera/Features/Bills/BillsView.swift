import SwiftUI

struct BillsView: View {
    @Environment(AppModel.self) private var app
    @State private var rules: [RecurringRule] = []
    @State private var loaded = false
    @State private var showingAdd = false
    @State private var editing: RecurringRule?
    @State private var deleting: RecurringRule?
    @State private var posting: RecurringRule?

    var body: some View {
        let today = CalendarDate.today()
        let classified = Recurring.classify(rules, today: today)
        let totals = Recurring.totals(for: rules, today: today)
        List {
            if !rules.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Next 30 days").font(.headline)
                        HStack {
                            StatColumn(label: "Income", cents: totals.incomeCents, currency: app.currency, tone: .income(totals.incomeCents))
                            StatColumn(label: "Expenses", cents: totals.expenseCents, currency: app.currency, tone: .expense(totals.expenseCents))
                            StatColumn(label: "Net", cents: totals.netCents, currency: app.currency, tone: .signed)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if !classified.overdue.isEmpty {
                    Section {
                        ForEach(classified.overdue) { ruleRow($0, overdue: true) }
                    } header: {
                        Text("Overdue").foregroundStyle(Color.negative).fontWeight(.semibold)
                    }
                }
                if !classified.upcoming.isEmpty {
                    Section("Upcoming · next 30 days") {
                        ForEach(classified.upcoming) { ruleRow($0, overdue: false) }
                    }
                }
                Section("All recurring rules") {
                    ForEach(rules) { ruleRow($0, overdue: $0.nextDueDate < today) }
                }
            }
        }
        .navigationTitle("Bills & income")
        .toolbar {
            if !rules.isEmpty {
                Button("New rule", systemImage: "plus") { if app.requireAccount() { showingAdd = true } }
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .emptyState(when: loaded && rules.isEmpty, "No recurring rules yet", systemImage: "calendar.badge.clock",
                    description: "Add your recurring bills and income (rent, salary, subscriptions) to see what’s coming up and post each one when it’s due.") {
            Button("New rule", systemImage: "plus") { if app.requireAccount() { showingAdd = true } }
                .buttonStyle(.borderedProminent)
        }
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingAdd) { RecurringFormView(existing: nil) }
        .sheet(item: $editing) { RecurringFormView(existing: $0) }
        .sheet(item: $posting) { PostRuleSheet(rule: $0) }
        .alert("Delete \(deleting?.name ?? "rule")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
               presenting: deleting) { rule in
            Button("Delete", role: .destructive) { delete(rule) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This removes the recurring rule. Transactions you’ve already posted from it are not affected.")
        }
    }

    private func ruleRow(_ rule: RecurringRule, overdue: Bool) -> some View {
        BillRow(rule: rule, overdue: overdue, currency: app.currency) { posting = rule }
            .swipeActions {
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = rule }
                Button("Edit", systemImage: "pencil") { editing = rule }
            }
            .contextMenu {
                Button("Post now", systemImage: "paperplane") { posting = rule }
                Button("Edit", systemImage: "pencil") { editing = rule }
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = rule }
            }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        do {
            rules = try await RecurringAPI.list(householdId: householdId)
        } catch {
            app.toasts.error(userMessage(for: error, context: "recurring", fallback: "Couldn't load bills."))
        }
        loaded = true
    }

    private func delete(_ rule: RecurringRule) {
        Task {
            do {
                try await RecurringAPI.delete(rule.id)
                await app.didMutate()
                app.toasts.show("Recurring rule deleted")
            } catch {
                app.toasts.error(userMessage(for: error, context: "recurring", fallback: "Could not delete the rule."))
            }
        }
    }
}

struct BillRow: View {
    let rule: RecurringRule
    let overdue: Bool
    let currency: String
    let onPost: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(rule.name).font(.headline)
                        Pill(text: rule.type.label)
                        if overdue { Pill(text: "Overdue", style: .danger) }
                    }
                    Text(([rule.account?.name ?? "—", rule.category?.name].compactMap { $0 } + [rule.frequency.label])
                        .joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(overdue ? "Was due \(rule.nextDueDate.mediumLabel)" : "Next due \(rule.nextDueDate.mediumLabel)")
                        .font(.subheadline.weight(overdue ? .medium : .regular))
                        .foregroundStyle(overdue ? Color.negative : .secondary)
                }
                Spacer()
                MoneyText(cents: rule.signedAmountCents, currency: currency, tone: .signed, showsPlus: true)
            }
            Button(action: onPost) {
                // Explicit colors: in a List row the icon would otherwise take the
                // (near-black) accent tint and vanish on the prominent button.
                Label("Post now", systemImage: "paperplane")
                    .foregroundStyle(Color(.systemBackground))
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.vertical, 4)
    }
}

/// Confirmation before posting a due instance (web: "Post {name}?").
struct PostRuleSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let rule: RecurringRule
    @State private var isPosting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Type", value: rule.type.label)
                    LabeledContent("Amount") { MoneyText(cents: rule.amountCents, currency: app.currency, tone: .neutral) }
                    LabeledContent("Account", value: rule.account?.name ?? "—")
                    if let category = rule.category?.name { LabeledContent("Category", value: category) }
                    LabeledContent("Date", value: rule.nextDueDate.mediumLabel)
                } header: {
                    Text("This creates a transaction:")
                } footer: {
                    Text("The next due date then advances to \(Recurring.advance(rule.nextDueDate, by: rule.frequency).mediumLabel).")
                }
            }
            .navigationTitle(rule.name)
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isPosting ? "Posting…" : "Post", action: post).disabled(isPosting)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func post() {
        isPosting = true
        Task {
            defer { isPosting = false }
            do {
                if try await RecurringAPI.post(rule.id) {
                    app.toasts.show("Posted")
                } else {
                    app.toasts.show("This rule isn't due yet — nothing was posted.", style: .info)
                }
                await app.didMutate()
                dismiss()
            } catch {
                app.toasts.error(userMessage(for: error, context: "recurring", fallback: "Could not post the rule."))
            }
        }
    }
}

struct RecurringFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: RecurringRule?

    @State private var name = ""
    @State private var type: RecurringType = .expense
    @State private var amount = ""
    @State private var accountId: UUID?
    @State private var categoryId: UUID?
    @State private var frequency: RecurringFrequency = .monthly
    @State private var nextDue = CalendarDate.today()
    @State private var endDate: CalendarDate?
    @State private var autoPost = false
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledTextField(title: "Name", text: $name, prompt: "Rent, Salary, Netflix…")
                    Picker("Type", selection: $type) {
                        ForEach(RecurringType.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    AmountField(title: "Amount", text: $amount)
                }
                Section {
                    Picker("Account", selection: $accountId) {
                        if accountId == nil { Text("Select an account").tag(UUID?.none) }
                        ForEach(app.accounts) { Text($0.name).tag(Optional($0.id)) }
                    }
                    CategoryPicker(title: "Category", selection: $categoryId, categories: app.categories)
                }
                Section {
                    Picker("Frequency", selection: $frequency) {
                        ForEach(RecurringFrequency.allCases) { Text($0.label).tag($0) }
                    }
                    CalendarDatePicker(title: "Next due", date: $nextDue)
                    OptionalDateRow(title: "End date", date: $endDate)
                }
                Section {
                    Toggle("Auto-post", isOn: $autoPost)
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Not automatic yet — for now you post each due instance manually.")
                        FormErrorRow(message: error)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New recurring rule" : "Edit recurring rule")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save", action: save).disabled(isSaving)
                }
            }
            .onFirstAppear(perform: populate)
        }
    }

    private func populate() {
        guard let rule = existing else {
            accountId = app.accounts.first?.id
            return
        }
        name = rule.name
        type = rule.type
        amount = Money.inputString(rule.amountCents)
        accountId = rule.accountId
        categoryId = rule.categoryId
        frequency = rule.frequency
        nextDue = rule.nextDueDate
        endDate = rule.endDate
        autoPost = rule.autoPost
    }

    private func save() {
        error = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { error = "Enter a name"; return }
        guard trimmed.count <= 80 else { error = "Name is too long"; return }
        guard !amount.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Enter an amount"; return }
        guard let cents = try? Money.parse(amount) else { error = "Enter a valid amount"; return }
        guard let accountId else { error = "Pick an account"; return }
        if let endDate, endDate < nextDue { error = "The end date can't be before the next due date."; return }
        guard let householdId = app.household?.id else { return }

        let fields = RecurringAPI.Fields(name: trimmed, type: type, amountCents: cents, accountId: accountId,
                                         categoryId: categoryId, frequency: frequency, nextDueDate: nextDue,
                                         endDate: endDate, autoPost: autoPost)
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await RecurringAPI.save(id: existing?.id, householdId: householdId, fields)
                await app.didMutate()
                app.toasts.show(existing == nil ? "Recurring rule created" : "Rule updated")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "recurring", fallback: "Could not save the rule.")
            }
        }
    }
}
