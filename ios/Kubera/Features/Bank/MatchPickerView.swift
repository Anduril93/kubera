import SwiftUI

/// Pairs a bank transaction with an entry the household made (or the other
/// way round). Candidates: same account, within ±10 days, closest amount first.
struct MatchPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let txn: LedgerTransaction

    @State private var candidates: [LedgerTransaction] = []
    @State private var loaded = false
    @State private var isSaving = false

    private var pickingEntries: Bool { txn.source == .imported }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TransactionRow(transaction: txn, detail: .categoryOnly)
                } header: {
                    Text(pickingEntries ? "Bank transaction" : "Your entry")
                }
                Section {
                    ForEach(candidates) { candidate in
                        Button {
                            match(candidate)
                        } label: {
                            HStack {
                                TransactionRow(transaction: candidate, detail: .categoryOnly)
                                if candidate.amountCents == txn.amountCents {
                                    Image(systemName: "equal.circle.fill").foregroundStyle(Color.positive)
                                        .accessibilityLabel("Same amount")
                                }
                            }
                        }
                        .tint(.primary)
                        .disabled(isSaving)
                    }
                } header: {
                    Text(pickingEntries ? "Match to one of your entries" : "Match to a bank transaction")
                } footer: {
                    Text(pickingEntries
                         ? "Your entry keeps its category, notes and receipt; the bank’s amount and date are used."
                         : "Only bank transactions on the same account within 10 days are shown.")
                }
            }
            .navigationTitle("Match")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .overlay {
                if !loaded {
                    ProgressView()
                } else if candidates.isEmpty {
                    ContentUnavailableView("Nothing to match", systemImage: "link",
                                           description: Text("No candidates on this account within 10 days."))
                }
            }
            .task {
                do {
                    candidates = try await BankAPI.candidates(for: txn)
                } catch {
                    app.toasts.error(userMessage(for: error, context: "bank", fallback: "Couldn't load matches."))
                }
                loaded = true
            }
        }
    }

    private func match(_ candidate: LedgerTransaction) {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                let (bank, entry) = pickingEntries ? (txn, candidate) : (candidate, txn)
                try await BankAPI.match(bank: bank.id, entry: entry.id)
                await app.didMutate()
                app.toasts.show("Matched")
                dismiss()
            } catch {
                app.toasts.error((error as? DisplayableError)?.message ?? userMessage(for: error, context: "bank", fallback: "Couldn't match them."))
            }
        }
    }
}
