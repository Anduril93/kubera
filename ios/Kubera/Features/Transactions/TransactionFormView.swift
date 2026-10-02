import SwiftUI

struct TransactionFormView: View {
    enum Mode: Identifiable {
        case create(scan: ReceiptScanner.Result? = nil)
        case edit(LedgerItem)

        var id: String {
            switch self {
            case .create(let scan): "create-\(scan?.id.uuidString ?? "manual")"
            case .edit(let item): "edit-\(item.id)"
            }
        }
    }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let mode: Mode

    @State private var type: TransactionType = .expense
    @State private var amount = ""
    @State private var accountId: UUID?
    @State private var categoryId: UUID?
    @State private var date = CalendarDate.today()
    @State private var merchant = ""
    @State private var description = ""
    @State private var notes = ""
    @State private var pending = false
    @State private var error: String?
    @State private var isSaving = false
    @State private var didSave = false

    private var editing: LedgerItem? {
        if case .edit(let item) = mode { item } else { nil }
    }

    private var scan: ReceiptScanner.Result? {
        if case .create(let scan) = mode { scan } else { nil }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let scan {
                    Section {
                        Label(scan.scanError ?? "Receipt scanned — review and confirm.",
                              systemImage: scan.scanError == nil ? "doc.text.viewfinder" : "exclamationmark.triangle")
                            .foregroundStyle(scan.scanError == nil ? Color.primary : Color.warningText)
                            .font(.subheadline)
                    }
                }
                Section {
                    Picker("Type", selection: $type) {
                        ForEach(TransactionType.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    AmountField(title: "Amount", text: $amount)
                } footer: {
                    if let editing, !editing.children.isEmpty {
                        Text("Changing the amount removes the split.")
                    }
                }
                Section {
                    Picker("Account", selection: $accountId) {
                        if accountId == nil { Text("Select an account").tag(UUID?.none) }
                        ForEach(app.accounts) { Text($0.name).tag(Optional($0.id)) }
                    }
                    CategoryPicker(title: "Category", selection: $categoryId, categories: app.categories)
                    CalendarDatePicker(title: "Date", date: $date)
                }
                Section {
                    LabeledTextField(title: "Merchant", text: $merchant)
                    LabeledTextField(title: "Description", text: $description)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Notes")
                        TextField("Notes", text: $notes, prompt: Text("Optional"), axis: .vertical)
                            .lineLimit(2...5)
                            .foregroundStyle(.secondary)
                    }
                    Toggle("Pending", isOn: $pending)
                } footer: {
                    FormErrorRow(message: error)
                }
            }
            .navigationTitle(editing == nil ? "Add transaction" : "Edit transaction")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing == nil ? "Add" : "Save", action: save).disabled(isSaving)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .onFirstAppear(perform: populate)
            .onDisappear {
                // Scanned receipts that never got attached shouldn't linger in storage.
                if !didSave, let scan { Task { await ReceiptsAPI.discard(scan.receipts) } }
            }
        }
    }

    private func populate() {
        if let txn = editing?.transaction {
            type = txn.type
            amount = Money.inputString(txn.amountCents)
            accountId = txn.accountId
            categoryId = txn.categoryId
            date = txn.date
            merchant = txn.merchant ?? ""
            description = txn.description ?? ""
            notes = txn.notes ?? ""
            pending = txn.pending
        } else {
            accountId = app.accounts.first?.id
            if let draft = scan?.draft {
                if let cents = draft.amountCents { amount = Money.inputString(cents) }
                categoryId = draft.categoryId
                if let d = draft.date { date = d }
                merchant = draft.merchant ?? ""
            }
        }
    }

    private func save() {
        error = nil
        guard !amount.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Enter an amount"; return }
        let cents: Int
        do { cents = try Money.parse(amount) } catch { self.error = "Enter a valid amount"; return }
        guard let accountId else { error = "Pick an account"; return }
        guard merchant.count <= 120 else { error = "Merchant is too long"; return }
        guard description.count <= 200 else { error = "Description is too long"; return }
        guard notes.count <= 1000 else { error = "Notes are too long"; return }

        let fields = TransactionsAPI.Fields(
            accountId: accountId, type: type, amountCents: cents, date: date, categoryId: categoryId,
            merchant: merchant.nilIfBlank, description: description.nilIfBlank, notes: notes.nilIfBlank, pending: pending
        )
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                if let editing {
                    try await TransactionsAPI.update(editing.id, fields)
                } else {
                    try await TransactionsAPI.create(fields, receiptKey: scan?.receipts.first?.key)
                    if let extra = scan?.receipts.dropFirst(), !extra.isEmpty {
                        await ReceiptsAPI.discard(Array(extra)) // only the first page is attached (web parity)
                    }
                }
                didSave = true
                await app.didMutate()
                app.toasts.show(editing == nil ? "Transaction added" : "Transaction updated")
                dismiss()
            } catch {
                self.error = userMessage(for: error, context: "transactions",
                                         fallback: editing == nil ? "Could not create the transaction." : "Could not update the transaction.")
            }
        }
    }
}

struct SplitFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let item: LedgerItem

    private struct Part: Identifiable {
        let id = UUID()
        var categoryId: UUID?
        var amount = ""
        var description: String?
    }

    @State private var parts: [Part] = []
    @State private var error: String?
    @State private var isSaving = false

    private var parentCents: Int { item.transaction.amountCents }
    private var allocatedCents: Int { parts.reduce(0) { $0 + ((try? Money.parse($1.amount)) ?? 0) } }
    private var remainingCents: Int { parentCents - allocatedCents }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Divide \(Money.format(parentCents, currency: item.transaction.currency)) into parts that sum to the total. This doesn’t change the account balance.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach($parts) { $part in
                    Section {
                        CategoryPicker(title: "Category", selection: $part.categoryId, categories: app.categories)
                        AmountField(title: "Amount", text: $part.amount)
                        if parts.count > 2 {
                            Button("Remove part", systemImage: "trash", role: .destructive) {
                                parts.removeAll { $0.id == part.id }
                            }
                        }
                    }
                }
                Section {
                    Button("Add part", systemImage: "plus") { parts.append(Part()) }
                    LabeledContent("Remaining to allocate") {
                        MoneyText(cents: remainingCents, currency: item.transaction.currency,
                                  color: remainingCents == 0 ? .positive : .negative)
                    }
                } footer: {
                    FormErrorRow(message: error)
                }
            }
            .navigationTitle("Split transaction")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Splitting…" : "Save split", action: save)
                        .disabled(isSaving || remainingCents != 0)
                }
            }
            .onFirstAppear {
                guard parts.isEmpty else { return }
                parts = item.children.count >= 2
                    ? item.children.map { Part(categoryId: $0.categoryId, amount: Money.inputString($0.amountCents), description: $0.description) }
                    : [Part(), Part()]
            }
        }
    }

    private func save() {
        error = nil
        var split: [TransactionsAPI.SplitPart] = []
        for part in parts {
            guard let cents = try? Money.parse(part.amount) else { error = "Enter valid amounts for each part"; return }
            guard cents > 0 else { error = "Each part must be greater than zero"; return }
            split.append(.init(categoryId: part.categoryId, amountCents: cents, description: part.description))
        }
        guard split.count >= 2 else { error = "A split needs at least two parts"; return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await TransactionsAPI.split(item.id, parts: split)
                await app.didMutate()
                app.toasts.show("Transaction split")
                dismiss()
            } catch {
                self.error = userMessage(for: error, context: "transactions", fallback: "Could not split the transaction.")
            }
        }
    }
}
