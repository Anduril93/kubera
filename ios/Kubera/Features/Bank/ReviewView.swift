import SwiftUI

/// The "To review" inbox: everything that arrived from the bank. Confirm it,
/// fix the category, undo an auto-match, match it to something you entered,
/// or ignore it (it won't come back).
struct ReviewView: View {
    @Environment(AppModel.self) private var app
    var accountId: UUID?

    @State private var items: [LedgerTransaction] = []
    @State private var loaded = false
    @State private var matching: LedgerTransaction?
    @State private var editing: LedgerItem?

    var body: some View {
        List {
            if !items.isEmpty {
                Section {
                    ForEach(items) { txn in
                        ReviewRow(txn: txn, categories: app.categories) { categoryId in
                            run("Couldn't update the category.") { try await BankAPI.setCategory(txn.id, categoryId: categoryId) }
                        } onConfirm: {
                            run("Couldn't mark it reviewed.") { try await BankAPI.markReviewed([txn.id]) }
                        } onUnmatch: {
                            run("Couldn't undo the match.") { _ = try await BankAPI.unmatch(txn.id) }
                        }
                        .swipeActions(edge: .trailing) {
                            Button("Ignore", systemImage: "eye.slash", role: .destructive) {
                                run("Couldn't ignore it.") { try await TransactionsAPI.delete(txn.id) }
                            }
                            Button("Edit", systemImage: "pencil") { editing = LedgerItem(transaction: txn, children: []) }
                        }
                        .swipeActions(edge: .leading) {
                            if txn.source == .imported {
                                Button("Match…", systemImage: "link") { matching = txn }.tint(.indigo)
                            }
                        }
                        .contextMenu {
                            Button("Looks good", systemImage: "checkmark") {
                                run("Couldn't mark it reviewed.") { try await BankAPI.markReviewed([txn.id]) }
                            }
                            if txn.source == .imported {
                                Button("Match to my entry…", systemImage: "link") { matching = txn }
                            }
                            if txn.isMatched {
                                Button("Undo match", systemImage: "link.badge.plus") {
                                    run("Couldn't undo the match.") { _ = try await BankAPI.unmatch(txn.id) }
                                }
                            }
                            Button("Edit", systemImage: "pencil") { editing = LedgerItem(transaction: txn, children: []) }
                            Button("Ignore", systemImage: "eye.slash", role: .destructive) {
                                run("Couldn't ignore it.") { try await TransactionsAPI.delete(txn.id) }
                            }
                        }
                    }
                } footer: {
                    Text("Swipe left to ignore a bank transaction (it won’t be imported again), or right to match it to something you entered yourself.")
                }
            }
        }
        .navigationTitle("To review")
        .toolbar {
            if !items.isEmpty {
                Button("Mark all reviewed") {
                    let ids = items.map(\.id)
                    run("Couldn't mark them reviewed.") { try await BankAPI.markReviewed(ids) }
                }
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .emptyState(when: loaded && items.isEmpty, "All caught up", systemImage: "checkmark.circle",
                    description: "New bank transactions show up here for a quick check before they’re part of your ledger.")
        .task(id: app.dataVersion) { await load() }
        .refreshable {
            await app.syncBanks(announce: true)
            await load()
        }
        .sheet(item: $matching) { MatchPickerView(txn: $0) }
        .sheet(item: $editing) { TransactionFormView(mode: .edit($0)) }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        do {
            items = try await BankAPI.needsReview(householdId: householdId, accountId: accountId)
        } catch {
            app.toasts.error(userMessage(for: error, context: "bank", fallback: "Couldn't load transactions to review."))
        }
        loaded = true
    }

    private func run(_ fallback: String, _ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                await app.didMutate()
            } catch {
                app.toasts.error((error as? DisplayableError)?.message ?? userMessage(for: error, context: "bank", fallback: fallback))
            }
        }
    }
}

private struct ReviewRow: View {
    let txn: LedgerTransaction
    let categories: [Category]
    let onCategory: (UUID?) -> Void
    let onConfirm: () -> Void
    let onUnmatch: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TransactionRow(transaction: txn)
            if txn.isMatched {
                HStack(spacing: 6) {
                    Image(systemName: "link").foregroundStyle(Color.positive)
                    Text("Matched to your entry")
                        .font(.subheadline)
                    if let bankName = txn.bankSnapshot?.name, bankName != txn.merchant {
                        Text("· bank: \(bankName)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Button("Undo", action: onUnmatch).font(.subheadline).buttonStyle(.borderless)
                }
            }
            HStack {
                Menu {
                    Button("No category") { onCategory(nil) }
                    ForEach(CategoryKind.allCases) { kind in
                        let inKind = categories.filter { $0.kind == kind }
                        if !inKind.isEmpty {
                            Section(kind.label) {
                                ForEach(inKind) { category in
                                    Button(category.name) { onCategory(category.id) }
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        CategoryDot(hex: txn.category?.color, size: 8)
                        Text(txn.category?.name ?? "Choose category")
                        Image(systemName: "chevron.up.chevron.down").font(.caption2)
                    }
                    .font(.subheadline)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                Spacer()
                Button(action: onConfirm) {
                    Label("Looks good", systemImage: "checkmark")
                        .foregroundStyle(Color.onGold)
                }
                .goldProminent()
                .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}
