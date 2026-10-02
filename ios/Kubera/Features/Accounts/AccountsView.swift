import SwiftUI

struct AccountsView: View {
    @Environment(AppModel.self) private var app
    @State private var showingAdd = false
    @State private var editing: Account?
    @State private var archiving: Account?
    @State private var linker = BankLinker()

    private var isEmpty: Bool { app.accounts.isEmpty && app.bankConnections.isEmpty }

    var body: some View {
        let accounts = app.accounts
        let net = NetPosition(accounts: accounts)
        List {
            if !accounts.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Net position").font(.subheadline).foregroundStyle(.secondary)
                            MoneyText(cents: net.netCents, currency: app.currency, tone: .signed)
                                .heroAmount()
                        }
                        Divider()
                        HStack {
                            StatColumn(label: "Assets", cents: net.assetsCents, currency: app.currency)
                            StatColumn(label: "Liabilities", cents: net.liabilitiesCents, currency: app.currency,
                                       tone: .expense(net.liabilitiesCents))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            // Shown even with no accounts, so a broken or stale connection
            // can always be reconnected or disconnected.
            if !app.bankConnections.isEmpty {
                Section("Bank connections") {
                    ForEach(app.bankConnections) { BankConnectionRow(connection: $0, linker: linker) }
                }
            }

            if !accounts.isEmpty {
                ForEach(AccountGroup.grouping(accounts)) { group in
                    Section {
                        ForEach(group.accounts) { account in
                            NavigationLink(value: account.id) {
                                AccountRow(account: account)
                            }
                            .swipeActions {
                                Button("Archive", systemImage: "archivebox") { archiving = account }
                                    .tint(.orange)
                                Button("Edit", systemImage: "pencil") { editing = account }
                            }
                            .contextMenu {
                                Button("Edit", systemImage: "pencil") { editing = account }
                                Button("Archive", systemImage: "archivebox", role: .destructive) { archiving = account }
                            }
                        }
                    } header: {
                        HStack {
                            Text(group.type.label)
                            Spacer()
                            MoneyText(cents: group.subtotalCents, currency: app.currency,
                                      tone: group.type.isLiability ? .liability : .auto)
                        }
                    }
                }
            }
        }
        .navigationTitle("Accounts")
        .navigationDestination(for: UUID.self) { AccountDetailView(accountId: $0) }
        .toolbar {
            if !isEmpty {
                Menu("Add account", systemImage: "plus") {
                    Button("Link a bank", systemImage: "building.columns") { linker.start(app: app) }
                    Button("Add a manual account", systemImage: "square.and.pencil") { showingAdd = true }
                }
                .disabled(linker.isWorking)
            }
        }
        .emptyState(when: isEmpty, "No accounts yet", systemImage: "building.columns",
                    description: "Add your checking, savings, credit cards and more to track balances and your net position.") {
            VStack(spacing: 10) {
                Button("Link a bank", systemImage: "building.columns") { linker.start(app: app) }
                    .goldProminent()
                Button("Add a manual account", systemImage: "square.and.pencil") { showingAdd = true }
            }
            .disabled(linker.isWorking)
        }
        .refreshable {
            await app.syncBanks(announce: true)
            await app.didMutate()
        }
        .bankLink(linker)
        .sheet(isPresented: $showingAdd) { AccountFormView(account: nil) }
        .sheet(item: $editing) { AccountFormView(account: $0) }
        .archiveConfirmation($archiving)
    }
}

struct AccountRow: View {
    @Environment(AppModel.self) private var app
    let account: Account

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(account.name)
                    if account.isLinked {
                        Image(systemName: "link").font(.caption).foregroundStyle(.secondary)
                            .accessibilityLabel("Linked to bank")
                    }
                }
                let detail = [account.institution, account.mask.map { "•••• \($0)" }].compactMap { $0 }
                if !detail.isEmpty {
                    Text(detail.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            MoneyText(cents: account.currentBalanceCents, currency: account.currency,
                      tone: account.type.isLiability ? .liability : .auto)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ArchiveConfirmation: ViewModifier {
    @Environment(AppModel.self) private var app
    @Binding var account: Account?
    var onArchived: () -> Void = {}

    func body(content: Content) -> some View {
        content.alert(
            "Archive \(account?.name ?? "account")?",
            isPresented: Binding(get: { account != nil }, set: { if !$0 { account = nil } }),
            presenting: account
        ) { account in
            Button("Archive", role: .destructive) {
                Task {
                    do {
                        try await AccountsAPI.archive(account.id)
                        await app.didMutate()
                        app.toasts.show("Account archived")
                        onArchived()
                    } catch {
                        app.toasts.error(userMessage(for: error, context: "accounts", fallback: "Could not archive the account."))
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("It will be hidden from your accounts list. You won’t lose any history — this just removes it from view.")
        }
    }
}

extension View {
    func archiveConfirmation(_ account: Binding<Account?>, onArchived: @escaping () -> Void = {}) -> some View {
        modifier(ArchiveConfirmation(account: account, onArchived: onArchived))
    }
}
