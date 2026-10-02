import SwiftUI

/// Per-account reconciliation for a linked account: the bank's balance, what's
/// still waiting for review, and entries you made that the bank hasn't shown.
struct ReconcileSection: View {
    @Environment(AppModel.self) private var app
    let account: Account

    @State private var reviewCount = 0
    @State private var unseen: [LedgerTransaction] = []
    @State private var matching: LedgerTransaction?
    @State private var deleting: LedgerTransaction?

    var body: some View {
        balanceSection
            .task(id: app.dataVersion) { await load() }
            .sheet(item: $matching) { MatchPickerView(txn: $0) }
            .alert("Delete this entry?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                   presenting: deleting) { txn in
                Button("Delete", role: .destructive) {
                    Task {
                        do {
                            try await TransactionsAPI.delete(txn.id)
                            await app.didMutate()
                        } catch {
                            app.toasts.error(userMessage(for: error, context: "bank", fallback: "Couldn't delete it."))
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("It never showed up at the bank, so removing it keeps your records matching.")
            }
        if !unseen.isEmpty { unseenSection }
    }

    private var balanceSection: some View {
        Section {
            LabeledContent("Bank balance") {
                MoneyText(cents: account.currentBalanceCents, currency: account.currency,
                          tone: account.type.isLiability ? .liability : .auto)
            }
            if let available = account.availableBalanceCents {
                LabeledContent("Available") { MoneyText(cents: available, currency: account.currency, tone: .neutral) }
            }
            NavigationLink {
                ReviewView(accountId: account.id)
            } label: {
                LabeledContent("To review") {
                    Text(reviewCount == 0 ? "All caught up" : "\(reviewCount)")
                        .foregroundStyle(reviewCount == 0 ? Color.positive : .primary)
                }
            }
        } header: {
            Text("Reconcile")
        } footer: {
            if let at = account.bankBalanceAt {
                Text("Balance from \(account.institution ?? "your bank"), updated \(at.formatted(.relative(presentation: .named))).")
            }
        }
    }

    private var unseenSection: some View {
            Section {
                ForEach(unseen) { txn in
                    TransactionRow(transaction: txn, detail: .categoryOnly)
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = txn }
                            Button("Match…", systemImage: "link") { matching = txn }.tint(.indigo)
                        }
                        .contextMenu {
                            Button("Match to bank transaction…", systemImage: "link") { matching = txn }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = txn }
                        }
                }
            } header: {
                Text("Not seen at the bank")
            } footer: {
                Text("Entries you made more than 5 days ago that haven’t matched a bank transaction. Match one by hand, or delete it if it never happened.")
            }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        async let review = BankAPI.needsReview(householdId: householdId, accountId: account.id)
        async let unseen = BankAPI.unseenEntries(accountId: account.id)
        reviewCount = (try? await review.count) ?? 0
        self.unseen = (try? await unseen) ?? []
    }
}

/// Status + actions for one bank connection (Accounts tab).
struct BankConnectionRow: View {
    @Environment(AppModel.self) private var app
    let connection: BankConnection
    let linker: BankLinker
    @State private var confirmingUnlink = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(connection.name)
                Group {
                    switch connection.status {
                    case .active:
                        if let at = connection.lastSyncedAt {
                            Text("Synced \(at.formatted(.relative(presentation: .named)))")
                        } else {
                            Text("Waiting for first sync")
                        }
                    case .loginRequired:
                        Text("Sign in again to keep syncing").foregroundStyle(Color.warningText)
                    case .error:
                        Text("Connection problem — try reconnecting").foregroundStyle(Color.negative)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if connection.status != .active {
                Button("Reconnect") { linker.start(app: app, reconnecting: connection) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
            Menu {
                Button("Sync now", systemImage: "arrow.clockwise") {
                    Task {
                        do {
                            try await BankAPI.sync(connection.id)
                            await app.didMutate()
                            app.toasts.show("Synced \(connection.name)")
                        } catch {
                            app.toasts.error((error as? DisplayableError)?.message ?? "Couldn't sync right now.")
                        }
                    }
                }
                Button("Reconnect", systemImage: "key") { linker.start(app: app, reconnecting: connection) }
                Button("Disconnect", systemImage: "link.badge.plus", role: .destructive) { confirmingUnlink = true }
            } label: {
                Image(systemName: "ellipsis.circle").accessibilityLabel("Connection actions")
            }
        }
        .confirmationDialog("Disconnect \(connection.name)?", isPresented: $confirmingUnlink, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) {
                Task {
                    do {
                        try await BankAPI.unlink(connection.id)
                        await app.didMutate()
                        app.toasts.show("\(connection.name) disconnected")
                    } catch {
                        app.toasts.error((error as? DisplayableError)?.message ?? "Couldn't disconnect.")
                    }
                }
            }
        } message: {
            Text("Its accounts and transaction history stay, as manual accounts. New bank transactions stop arriving.")
        }
    }
}
