import SwiftUI

struct AccountDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let accountId: UUID

    @State private var account: Account?
    @State private var recent: [LedgerTransaction] = []
    @State private var loaded = false
    @State private var editing: Account?
    @State private var archiving: Account?

    var body: some View {
        List {
            if let account {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text([account.type.label, account.institution].compactMap { $0 }.joined(separator: " · "))
                                .foregroundStyle(.secondary)
                            if account.isArchived { Pill(text: "Archived") }
                        }
                        .font(.subheadline)
                        Text(account.type.isLiability ? "Balance owed" : "Current balance")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(.top, 6)
                        MoneyText(cents: account.currentBalanceCents, currency: account.currency,
                                  tone: account.type.isLiability ? .liability : .auto)
                            .font(.largeTitle.weight(.semibold))
                    }
                    .padding(.vertical, 4)
                }

                Section("Recent transactions") {
                    if recent.isEmpty {
                        Text("No transactions yet. This account’s recent activity will appear here.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(recent) { txn in
                        TransactionRow(transaction: txn, detail: .categoryOnly)
                    }
                }
            }
        }
        .navigationTitle(account?.name ?? "")
        .overlay {
            if !loaded { ProgressView() }
            else if account == nil {
                ContentUnavailableView("Account not found", systemImage: "building.columns")
            }
        }
        .toolbar {
            if let account {
                Menu("Actions", systemImage: "ellipsis") {
                    Button("Edit", systemImage: "pencil") { editing = account }
                    if !account.isArchived {
                        Button("Archive", systemImage: "archivebox", role: .destructive) { archiving = account }
                    }
                }
            }
        }
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
        .sheet(item: $editing) { AccountFormView(account: $0) }
        .archiveConfirmation($archiving) { dismiss() }
    }

    private func load() async {
        do {
            async let account = AccountsAPI.get(accountId)
            async let recent = TransactionsAPI.recent(accountId: accountId)
            (self.account, self.recent) = try await (account, recent)
        } catch {
            app.toasts.error(userMessage(for: error, context: "accounts", fallback: "Couldn't load this account."))
        }
        loaded = true
    }
}
