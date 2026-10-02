import SwiftUI

/// Create a household, or join a partner's with their invite code.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app

    private enum Mode: String, CaseIterable { case create = "Create", join = "Join" }

    @State private var mode: Mode = .create
    @State private var name = ""
    @State private var code = ""
    @State private var error: String?
    @State private var isWorking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 8) {
                        BrandMark(size: 44)
                        Text("Create a new household, or join your partner’s with their invite code.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)

                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: mode) { error = nil }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                switch mode {
                case .create:
                    Section {
                        TextField("Household name", text: $name, prompt: Text("The Smith Household"))
                            .textInputAutocapitalization(.words)
                    } header: {
                        Text("Household name")
                    } footer: {
                        FormErrorRow(message: error)
                    }
                case .join:
                    Section {
                        TextField("Invite code", text: $code, prompt: Text("ABCD2345"))
                            .font(.body.monospaced())
                            .tracking(2)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Invite code")
                    } footer: {
                        FormErrorRow(message: error)
                    }
                }

                Section {
                    Button(action: submit) {
                        Text(buttonTitle).frame(maxWidth: .infinity)
                    }
                    .goldProminent()
                    .controlSize(.large)
                    .disabled(isWorking)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            .navigationTitle("Set up your household")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out") { Task { await app.signOut() } }
                }
            }
        }
    }

    private var buttonTitle: String {
        switch mode {
        case .create: isWorking ? "Creating…" : "Create household"
        case .join: isWorking ? "Joining…" : "Join household"
        }
    }

    private func submit() {
        error = nil
        switch mode {
        case .create:
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { error = "Enter a household name"; return }
            guard trimmed.count <= 60 else { error = "Name is too long"; return }
            run(fallback: "Could not create the household. Please try again.") {
                try await app.createHousehold(name: trimmed)
            }
        case .join:
            guard InviteCode.normalize(code).count >= 4 else { error = "Enter the invite code"; return }
            run(fallback: "That invite code didn't match a household.") {
                try await app.joinHousehold(code: code)
            }
        }
    }

    private func run(fallback: String, _ work: @escaping () async throws -> Void) {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                try await work()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "household", fallback: fallback)
            }
        }
    }
}
