import SwiftUI

struct HouseholdView: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var members: [HouseholdMember] = []
    @State private var isSaving = false
    @State private var isRegenerating = false
    @State private var saved = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        List {
            Section {
                if app.isOwner {
                    TextField("Household name", text: $name)
                        .onChange(of: name) { saved = false }
                    Button(isSaving ? "Saving…" : "Save", action: rename)
                        .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty || name == app.household?.name)
                } else {
                    Text(app.household?.name ?? "").font(.title3)
                }
            } header: {
                Text("Household name")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(app.isOwner ? "Rename your household." : "Only the household owner can change this.")
                    if saved { Text("Saved.") }
                    FormErrorRow(message: error)
                }
            }

            Section {
                HStack {
                    Text(app.household?.inviteCode ?? "")
                        .font(.title3.monospaced())
                        .tracking(4)
                        .textSelection(.enabled)
                    Spacer()
                    Button(copied ? "Copied" : "Copy invite code", systemImage: copied ? "checkmark" : "doc.on.doc", action: copy)
                        .labelStyle(.iconOnly)
                        .contentTransition(.symbolEffect(.replace))
                }
                if app.isOwner {
                    Button(isRegenerating ? "Regenerating…" : "Regenerate code", action: regenerate)
                        .disabled(isRegenerating)
                }
            } header: {
                Text("Invite code")
            } footer: {
                Text("Share this code with your partner so they can join. There is no email invite — hand the code over directly.")
            }

            Section {
                ForEach(members) { member in
                    HStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.title)
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.displayName + (member.userId == app.userId ? " (you)" : ""))
                            if member.profile?.fullName != nil, let email = member.profile?.email {
                                Text(email).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Pill(text: member.role == .owner ? "Owner" : "Member", style: member.role == .owner ? .strong : .neutral)
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text("Members")
            } footer: {
                Text("Everyone in the household has full access to all of its finances.")
            }
        }
        .navigationTitle("Household")
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        name = app.household?.name ?? ""
        guard let householdId = app.household?.id else { return }
        do {
            members = try await HouseholdAPI.members(of: householdId)
        } catch {
            app.toasts.error(userMessage(for: error, context: "household", fallback: "Couldn't load members."))
        }
    }

    private func rename() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        error = nil
        guard !trimmed.isEmpty else { error = "Enter a household name"; return }
        guard trimmed.count <= 60 else { error = "Name is too long"; return }
        guard let householdId = app.household?.id else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                app.householdChanged(try await HouseholdAPI.rename(householdId, to: trimmed))
                saved = true
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "household", fallback: "Could not rename the household.")
            }
        }
    }

    private func regenerate() {
        guard let householdId = app.household?.id else { return }
        isRegenerating = true
        Task {
            defer { isRegenerating = false }
            do {
                app.householdChanged(try await HouseholdAPI.regenerateInviteCode(householdId))
                app.toasts.show("New invite code created")
            } catch {
                app.toasts.error(userMessage(for: error, context: "household", fallback: "Could not regenerate the invite code."))
            }
        }
    }

    private func copy() {
        UIPasteboard.general.string = app.household?.inviteCode
        app.toasts.show("Invite code copied")
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}
