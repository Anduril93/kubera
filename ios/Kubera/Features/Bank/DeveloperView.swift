#if DEBUG
import SwiftUI

/// Debug-build tools for the Plaid Sandbox: link a fake bank without the Link
/// UI, create bank transactions to exercise matching, and check whether a real
/// institution is supported. All actions are refused by the server outside
/// Sandbox, so these can't touch a real bank connection.
struct DeveloperView: View {
    @Environment(AppModel.self) private var app
    @State private var query = "American Airlines"
    @State private var results: [BankAPI.Institution] = []
    @State private var amount = "12.34"
    @State private var merchant = "Sandbox Coffee"
    @State private var working = false

    var body: some View {
        Form {
            Section {
                Button("Link Sandbox test bank") {
                    run {
                        let summary = try await BankAPI.sandboxLink()
                        app.toasts.show("Linked — \((summary?.added ?? 0) + (summary?.matched ?? 0)) transactions")
                    }
                }
            } footer: {
                Text("Creates a fake “Platypus” bank login in Plaid Sandbox (no real credentials, no Trial slot used).")
            }

            if let connection = app.bankConnections.first {
                Section {
                    AmountField(title: "Amount (+ = spent)", text: $amount, allowsNegative: true)
                    LabeledTextField(title: "Description", text: $merchant, prompt: "Merchant")
                    Button("Create bank transaction") {
                        guard let value = Double(amount) else { return }
                        run {
                            try await BankAPI.sandboxAdd(itemId: connection.id, amount: value, date: .today(), description: merchant)
                            app.toasts.show("Created — the webhook will sync it in a few seconds", style: .info)
                        }
                    }
                } header: {
                    Text("Sandbox transactions · \(connection.name)")
                } footer: {
                    Text("Enter the same amount as one of your own entries on that account to watch it auto-match.")
                }
            }

            Section {
                TextField("Institution", text: $query)
                Button("Check Plaid support") {
                    run { results = try await BankAPI.searchInstitutions(query) }
                }
                ForEach(results) { inst in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(inst.name)
                        Text("\(inst.products.contains("transactions") ? "Transactions ✓" : "No transactions") · \(inst.oauth ? "OAuth" : "Credentials login") · \(inst.id)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Bank support")
            }
        }
        .navigationTitle("Bank sandbox tools")
        .disabled(working)
        .formKeyboard()
    }

    private func run(_ work: @escaping () async throws -> Void) {
        working = true
        Task {
            defer { working = false }
            do {
                try await work()
                await app.didMutate()
            } catch {
                app.toasts.error((error as? DisplayableError)?.message ?? userMessage(for: error, context: "bank", fallback: "That didn't work."))
            }
        }
    }
}
#endif
