import SwiftUI

struct AccountFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let account: Account?

    @State private var name = ""
    @State private var type: AccountType = .checking
    @State private var institution = ""
    @State private var balance = ""
    @State private var initialBalance = ""
    @State private var currency = "USD"
    @State private var error: String?
    @State private var isSaving = false

    private var isEditing: Bool { account != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledTextField(title: "Name", text: $name, prompt: "Everyday Checking")
                    Picker("Type", selection: $type) {
                        ForEach(AccountType.allCases) { Text($0.label).tag($0) }
                    }
                    LabeledTextField(title: "Institution", text: $institution, prompt: "Optional")
                }
                Section {
                    if account?.isLinked == true {
                        LabeledContent("Balance") {
                            Text("From your bank").foregroundStyle(.secondary)
                        }
                    } else {
                        AmountField(title: isEditing ? "Balance" : "Starting balance", text: $balance, allowsNegative: true)
                    }
                    LabeledContent("Currency") {
                        TextField("Currency", text: $currency)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .onChange(of: currency) { _, new in
                                let upper = String(new.uppercased().prefix(3))
                                if upper != new { currency = upper }
                            }
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(type.isLiability ? "In dollars. Enter what you owe as a positive amount." : "In dollars.")
                        FormErrorRow(message: error)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit account" : "Add account")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Add", action: save).disabled(isSaving)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .onFirstAppear(perform: populate)
        }
    }

    private func populate() {
        if let account {
            name = account.name
            type = account.type
            institution = account.institution ?? ""
            balance = Money.inputString(account.currentBalanceCents)
            currency = account.currency
        } else {
            currency = app.accounts.first?.currency ?? app.profile?.defaultCurrency ?? "USD"
        }
        initialBalance = balance
    }

    private func save() {
        error = nil
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { error = "Enter an account name"; return }
        guard trimmedName.count <= 80 else { error = "Name is too long"; return }
        guard institution.count <= 120 else { error = "Institution name is too long"; return }
        guard currency.count == 3, currency.allSatisfy(\.isLetter) else { error = "Use a 3-letter currency code"; return }

        var balanceCents: Int?
        if !balance.trimmingCharacters(in: .whitespaces).isEmpty {
            do {
                balanceCents = try Money.parse(balance, allowNegative: true)
            } catch {
                self.error = isEditing ? "Enter a valid balance" : "Enter a valid starting balance"
                return
            }
        }

        let fields = AccountsAPI.Fields(name: trimmedName, type: type, institution: institution.nilIfBlank, currency: currency)
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                if let account {
                    // Only overwrite the stored balance if the user changed it — a
                    // transaction posted while this sheet was open must not be undone.
                    let changed = balance != initialBalance && !account.isLinked
                    try await AccountsAPI.update(account.id, fields, balanceCents: changed ? balanceCents : nil)
                } else {
                    guard let householdId = app.household?.id else { return }
                    try await AccountsAPI.create(householdId: householdId, fields, startingBalanceCents: balanceCents ?? 0)
                }
                await app.didMutate()
                app.toasts.show(isEditing ? "Account updated" : "Account created")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "accounts",
                                         fallback: isEditing ? "Could not update the account." : "Could not create the account.")
            }
        }
    }
}
