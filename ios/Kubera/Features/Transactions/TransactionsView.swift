import QuickLook
import SwiftUI

struct TransactionsView: View {
    @Environment(AppModel.self) private var app

    @State private var filters = LedgerFilters()
    @State private var searchText = ""
    @State private var items: [LedgerItem] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loaded = false
    @State private var isLoadingMore = false

    @State private var showingFilters = false
    @State private var form: TransactionFormView.Mode?
    @State private var splitting: LedgerItem?
    @State private var deleting: LedgerItem?
    @State private var expanded: Set<UUID> = []
    @State private var receiptURL: URL?
    @State private var scanner = ReceiptScanner()

    var body: some View {
        List {
            if !items.isEmpty {
                Section {
                    ForEach(items) { item in
                        row(item)
                    }
                    if items.count < total {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .onAppear(perform: loadMore)
                    }
                } header: {
                    Text("\(total) \(total == 1 ? "transaction" : "transactions")")
                }
            }
        }
        .navigationTitle("Transactions")
        .searchable(text: $searchText, prompt: "Search description or merchant")
        .toolbar { toolbar }
        .overlay {
            if !loaded {
                ProgressView()
            } else if items.isEmpty {
                ContentUnavailableView {
                    Label(filters.isActive ? "No matches" : "No transactions yet", systemImage: "receipt")
                } description: {
                    Text(emptyMessage)
                } actions: {
                    if filters.isActive {
                        Button("Clear filters") { clearFilters() }
                    } else if !app.accounts.isEmpty {
                        Button("Add transaction", systemImage: "plus") { form = .create() }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .overlay { if scanner.isWorking { ScanningOverlay() } }
        .task(id: searchText) {
            // Debounced like the web filter bar (350 ms).
            guard searchText != filters.search else { return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            filters.search = searchText
        }
        .task(id: ReloadKey(filters: filters, version: app.dataVersion)) { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showingFilters) { TransactionFiltersSheet(filters: $filters) }
        .sheet(item: $form) { TransactionFormView(mode: $0) }
        .sheet(item: $splitting) { SplitFormView(item: $0) }
        .quickLookPreview($receiptURL)
        .receiptScanner(scanner) { result in form = .create(scan: result) }
        .alert("Delete this transaction?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
               presenting: deleting) { item in
            Button("Delete", role: .destructive) { delete(item) }
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text("This permanently removes the transaction\(item.children.isEmpty ? "" : " and its split parts") and updates the account balance. This can’t be undone.")
        }
    }

    @ViewBuilder
    private func row(_ item: LedgerItem) -> some View {
        let isExpanded = expanded.contains(item.id)
        Button {
            if !item.children.isEmpty {
                withAnimation { if isExpanded { expanded.remove(item.id) } else { expanded.insert(item.id) } }
            } else {
                form = .edit(item)
            }
        } label: {
            TransactionRow(transaction: item.transaction, isSplit: !item.children.isEmpty) {
                openReceipt(item.transaction)
            }
        }
        .tint(.primary)
        .accessibilityHint(item.children.isEmpty ? "Edit" : (isExpanded ? "Collapse split" : "Expand split"))
        .swipeActions(edge: .trailing) {
            Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
            Button("Edit", systemImage: "pencil") { form = .edit(item) }
        }
        .swipeActions(edge: .leading) {
            Button(item.children.isEmpty ? "Split" : "Edit split", systemImage: "arrow.triangle.branch") { splitting = item }
                .tint(.indigo)
        }
        .contextMenu {
            Button("Edit", systemImage: "pencil") { form = .edit(item) }
            Button(item.children.isEmpty ? "Split" : "Edit split", systemImage: "arrow.triangle.branch") { splitting = item }
            if item.transaction.receiptUrl != nil {
                Button("View receipt", systemImage: "paperclip") { openReceipt(item.transaction) }
            }
            Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
        }

        if isExpanded {
            ForEach(item.children) { part in
                SplitPartRow(part: part)
                    .listRowBackground(Color(.secondarySystemGroupedBackground).opacity(0.6))
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                showingFilters = true
            } label: {
                Label("Filters", systemImage: filtersActiveIgnoringSearch
                      ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            ScanReceiptMenu(scanner: scanner)
                .disabled(app.accounts.isEmpty || scanner.isWorking)
            Button("Add transaction", systemImage: "plus") { form = .create() }
                .disabled(app.accounts.isEmpty)
        }
    }

    private var filtersActiveIgnoringSearch: Bool {
        var f = filters
        f.search = ""
        return f.isActive
    }

    private var emptyMessage: String {
        if filters.isActive { return "No transactions match these filters." }
        if app.accounts.isEmpty { return "Add an account first, then record transactions here." }
        return "No transactions yet. Add your first one to start the ledger."
    }

    private struct ReloadKey: Equatable {
        let filters: LedgerFilters
        let version: Int
    }

    private func clearFilters() {
        searchText = ""
        filters = LedgerFilters()
    }

    private func reload() async {
        guard let householdId = app.household?.id else { return }
        do {
            let result = try await TransactionsAPI.ledger(householdId: householdId, filters: filters, page: 1)
            items = result.items
            total = result.total
            page = 1
        } catch {
            app.toasts.error(userMessage(for: error, context: "transactions", fallback: "Couldn't load transactions."))
        }
        loaded = true
    }

    private func loadMore() {
        guard !isLoadingMore, items.count < total, let householdId = app.household?.id else { return }
        isLoadingMore = true
        Task {
            defer { isLoadingMore = false }
            do {
                let next = try await TransactionsAPI.ledger(householdId: householdId, filters: filters, page: page + 1)
                let known = Set(items.map(\.id))
                items += next.items.filter { !known.contains($0.id) }
                total = next.total
                page += 1
            } catch {
                app.toasts.error(userMessage(for: error, context: "transactions", fallback: "Couldn't load more transactions."))
            }
        }
    }

    private func delete(_ item: LedgerItem) {
        Task {
            do {
                try await TransactionsAPI.delete(item.id)
                if let key = item.transaction.receiptUrl {
                    await ReceiptsAPI.discard(key: key) // don't orphan the private file
                }
                await app.didMutate()
                app.toasts.show("Transaction deleted")
            } catch {
                app.toasts.error(userMessage(for: error, context: "transactions", fallback: "Could not delete the transaction."))
            }
        }
    }

    private func openReceipt(_ transaction: LedgerTransaction) {
        guard let key = transaction.receiptUrl else { return }
        Task {
            do {
                receiptURL = try await ReceiptsAPI.download(key: key)
            } catch {
                app.toasts.error(userMessage(for: error, context: "receipts", fallback: "Couldn't open the receipt."))
            }
        }
    }
}

struct TransactionFiltersSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: LedgerFilters

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Account", selection: $filters.accountId) {
                        Text("All accounts").tag(UUID?.none)
                        ForEach(app.accounts) { Text($0.name).tag(Optional($0.id)) }
                    }
                    CategoryPicker(title: "Category", selection: $filters.categoryId,
                                   categories: app.categories, noneLabel: "All categories")
                    Picker("Type", selection: $filters.type) {
                        Text("All types").tag(TransactionType?.none)
                        ForEach(TransactionType.allCases) { Text($0.label).tag(Optional($0)) }
                    }
                }
                Section("Dates") {
                    OptionalDateRow(title: "From", date: $filters.from)
                    OptionalDateRow(title: "To", date: $filters.to)
                }
                Section {
                    Button("Clear filters", role: .destructive) {
                        let search = filters.search
                        filters = LedgerFilters()
                        filters.search = search
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Toggle + date picker for an optional `CalendarDate`.
struct OptionalDateRow: View {
    let title: String
    @Binding var date: CalendarDate?

    var body: some View {
        Toggle(title, isOn: Binding(
            get: { date != nil },
            set: { date = $0 ? (date ?? .today()) : nil }
        ))
        if let current = date {
            DatePicker(title, selection: Binding(
                get: { current.date() },
                set: { date = CalendarDate($0) }
            ), displayedComponents: .date)
            .labelsHidden()
        }
    }
}

/// Non-optional `CalendarDate` date picker row.
struct CalendarDatePicker: View {
    let title: String
    @Binding var date: CalendarDate

    var body: some View {
        DatePicker(title, selection: Binding(get: { date.date() }, set: { date = CalendarDate($0) }),
                   displayedComponents: .date)
    }
}
