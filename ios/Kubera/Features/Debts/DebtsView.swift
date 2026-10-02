import SwiftUI

struct DebtsView: View {
    @Environment(AppModel.self) private var app
    @State private var debts: [DebtWithPayoff] = []
    @State private var loaded = false
    @State private var showingAdd = false
    @State private var editing: DebtWithPayoff?
    @State private var deleting: DebtWithPayoff?

    var body: some View {
        let total = debts.reduce(0) { $0 + $1.balanceCents }
        List {
            if !debts.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Total debt").font(.subheadline).foregroundStyle(.secondary)
                        MoneyText(cents: total, currency: app.currency, tone: .expense(total))
                            .heroAmount()
                        Text("Shown here for tracking. Net worth counts debt only through linked account balances, never twice.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    ForEach(debts) { item in
                        DebtRow(item: item)
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
        .navigationTitle("Debts")
        .toolbar {
            if !debts.isEmpty { Button("Add debt", systemImage: "plus") { showingAdd = true } }
        }
        .overlay { if !loaded { ProgressView() } }
        .emptyState(when: loaded && debts.isEmpty, "No debts tracked", systemImage: "building.columns",
                    description: "Track credit cards, loans and mortgages — link an account to follow its balance, or maintain the balance manually. See a payoff estimate for each.") {
            Button("Add debt", systemImage: "plus") { showingAdd = true }.goldProminent()
        }
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingAdd) { DebtFormView(existing: nil) }
        .sheet(item: $editing) { DebtFormView(existing: $0.debt) }
        .alert("Delete \(deleting?.debt.name ?? "debt")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
               presenting: deleting) { item in
            Button("Delete", role: .destructive) { delete(item) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This removes the debt record. Your accounts and transactions are not affected.")
        }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        do {
            debts = try await DebtsAPI.list(householdId: householdId, defaultCurrency: app.currency)
        } catch {
            app.toasts.error(userMessage(for: error, context: "debts", fallback: "Couldn't load debts."))
        }
        loaded = true
    }

    private func delete(_ item: DebtWithPayoff) {
        Task {
            do {
                try await DebtsAPI.delete(item.id)
                await app.didMutate()
                app.toasts.show("Debt deleted")
            } catch {
                app.toasts.error(userMessage(for: error, context: "debts", fallback: "Could not delete the debt."))
            }
        }
    }
}

struct DebtRow: View {
    let item: DebtWithPayoff

    var body: some View {
        let debt = item.debt
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(debt.name).font(.headline)
                    HStack(spacing: 6) {
                        Pill(text: debt.type.label)
                        Pill(text: item.isLinked ? "Linked · \(debt.linkedAccount?.name ?? "")" : "Manual", style: .outline)
                    }
                }
                Spacer()
                MoneyText(cents: item.balanceCents, currency: item.currency, tone: .liability)
                    .font(.headline)
            }
            let details = [
                debt.apr.map { "\($0.formatted(.number.precision(.fractionLength(0...2))))% APR" },
                debt.minimumPaymentCents.map { "\(Money.format($0, currency: item.currency))/mo min" },
                debt.dueDay.map { "due day \($0)" },
            ].compactMap { $0 }
            if !details.isEmpty {
                Text(details.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            }
            Text(item.payoff.description).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct DebtFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: Debt?

    @State private var name = ""
    @State private var type: DebtType = .creditCard
    @State private var linkedAccountId: UUID?
    @State private var balance = ""
    @State private var apr = ""
    @State private var minimum = ""
    @State private var dueDay = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledTextField(title: "Name", text: $name, prompt: "Visa, Car loan…")
                    Picker("Type", selection: $type) {
                        ForEach(DebtType.allCases) { Text($0.label).tag($0) }
                    }
                }
                Section {
                    Picker("Balance source", selection: $linkedAccountId) {
                        Text("Manual balance").tag(UUID?.none)
                        ForEach(app.accounts) { Text("Linked · \($0.name)").tag(Optional($0.id)) }
                    }
                    if linkedAccountId == nil {
                        AmountField(title: "Balance owed", text: $balance)
                    }
                } footer: {
                    Text(linkedAccountId == nil ? "You enter and maintain the balance." : "Balance follows the linked account.")
                }
                Section {
                    LabeledContent("APR %") {
                        TextField("APR %", text: $apr, prompt: Text("18.99"))
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    AmountField(title: "Minimum payment", text: $minimum)
                    LabeledContent("Due day") {
                        TextField("Due day", text: $dueDay, prompt: Text("1–31"))
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                } footer: {
                    FormErrorRow(message: error)
                }
            }
            .navigationTitle(existing == nil ? "Add debt" : "Edit debt")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Add" : "Save", action: save).disabled(isSaving)
                }
            }
            .onFirstAppear {
                guard let debt = existing else { return }
                name = debt.name
                type = debt.type
                linkedAccountId = debt.linkedAccountId
                balance = Money.inputString(debt.principalCents)
                apr = debt.apr.map { $0.formatted(.number.precision(.fractionLength(0...2)).grouping(.never)) } ?? ""
                minimum = debt.minimumPaymentCents.map(Money.inputString) ?? ""
                dueDay = debt.dueDay.map(String.init) ?? ""
            }
        }
    }

    private func save() {
        error = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { error = "Enter a name"; return }
        guard trimmed.count <= 80 else { error = "Name is too long"; return }

        var principal = 0
        if linkedAccountId == nil, !balance.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let cents = try? Money.parse(balance) else { error = "Enter a valid balance"; return }
            principal = cents
        }
        var aprValue: Double?
        if let text = apr.nilIfBlank {
            guard let v = Double(text), v.isFinite, (0...100).contains(v) else { error = "APR must be between 0 and 100"; return }
            aprValue = (v * 100).rounded() / 100
        }
        var minimumCents: Int?
        if !minimum.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let cents = try? Money.parse(minimum) else { error = "Enter a valid minimum payment"; return }
            minimumCents = cents
        }
        var due: Int?
        if let text = dueDay.nilIfBlank {
            guard let v = Int(text), (1...31).contains(v) else { error = "Due day must be between 1 and 31"; return }
            due = v
        }
        guard let householdId = app.household?.id else { return }

        let fields = DebtsAPI.Fields(name: trimmed, type: type, linkedAccountId: linkedAccountId, principalCents: principal,
                                     apr: aprValue, minimumPaymentCents: minimumCents, dueDay: due)
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await DebtsAPI.save(id: existing?.id, householdId: householdId, fields)
                await app.didMutate()
                app.toasts.show(existing == nil ? "Debt added" : "Debt updated")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "debts", fallback: "Could not save the debt.")
            }
        }
    }
}
