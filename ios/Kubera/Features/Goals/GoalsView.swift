import SwiftUI

struct GoalsView: View {
    @Environment(AppModel.self) private var app
    @State private var goals: [GoalWithProgress] = []
    @State private var loaded = false
    @State private var showingAdd = false
    @State private var editing: GoalWithProgress?
    @State private var contributing: GoalWithProgress?
    @State private var deleting: GoalWithProgress?

    var body: some View {
        List {
            ForEach(goals) { item in
                GoalRow(item: item) { contributing = item }
                    .swipeActions {
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
                        Button("Edit", systemImage: "pencil") { editing = item }
                    }
                    .contextMenu {
                        Button("Edit", systemImage: "pencil") { editing = item }
                        if !item.isLinked {
                            Button("Add contribution", systemImage: "plus") { contributing = item }
                        }
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = item }
                    }
            }
        }
        .navigationTitle("Savings goals")
        .toolbar {
            if !goals.isEmpty { Button("New goal", systemImage: "plus") { showingAdd = true } }
        }
        .overlay { if !loaded { ProgressView() } }
        .emptyState(when: loaded && goals.isEmpty, "No savings goals yet", systemImage: "target",
                    description: "Set a target to save toward — track it manually, or link an account so progress follows its balance.") {
            Button("New goal", systemImage: "plus") { showingAdd = true }.goldProminent()
        }
        .task(id: app.dataVersion) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingAdd) { GoalFormView(existing: nil) }
        .sheet(item: $editing) { GoalFormView(existing: $0.goal) }
        .sheet(item: $contributing) { ContributeView(item: $0) }
        .alert("Delete \(deleting?.goal.name ?? "goal")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
               presenting: deleting) { item in
            Button("Delete", role: .destructive) { delete(item) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This removes the goal. Your accounts and transactions are not affected.")
        }
    }

    private func load() async {
        guard let householdId = app.household?.id else { return }
        do {
            goals = try await GoalsAPI.list(householdId: householdId, defaultCurrency: app.currency)
        } catch {
            app.toasts.error(userMessage(for: error, context: "goals", fallback: "Couldn't load goals."))
        }
        loaded = true
    }

    private func delete(_ item: GoalWithProgress) {
        Task {
            do {
                try await GoalsAPI.delete(item.id)
                await app.didMutate()
                app.toasts.show("Goal deleted")
            } catch {
                app.toasts.error(userMessage(for: error, context: "goals", fallback: "Could not delete the goal."))
            }
        }
    }
}

struct GoalRow: View {
    let item: GoalWithProgress
    let onContribute: () -> Void

    var body: some View {
        let p = item.progress
        let color = Color(hex: item.goal.color ?? GoalsAPI.defaultColor)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "banknote")
                    .font(.subheadline)
                    .foregroundStyle(color)
                    .frame(width: 32, height: 32)
                    .background(color.opacity(0.13), in: .circle)
                Text(item.goal.name).font(.headline)
                Spacer()
                Pill(text: item.isLinked ? "Linked · \(item.goal.linkedAccount?.name ?? "")" : "Manual")
            }
            ProgressBar(fraction: p.targetCents > 0 ? Double(p.currentCents) / Double(p.targetCents) : 0,
                        tint: p.isComplete ? .positive : .accentColor)
            HStack {
                Text("\(Text(Money.format(p.currentCents, currency: item.currency)).fontWeight(.semibold)) of \(Money.format(p.targetCents, currency: item.currency)) · \(p.percentComplete)%")
                    .monospacedDigit()
                Spacer()
                if p.isComplete {
                    Text("Complete").foregroundStyle(Color.positive)
                } else {
                    Text("\(Money.format(p.remainingCents, currency: item.currency)) to go").foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .font(.subheadline)
            if let pace = p.pace, let date = item.goal.targetDate {
                HStack(spacing: 6) {
                    pace.pill
                    Text("by \(date.mediumLabel)").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if !item.isLinked {
                Button("Add contribution", systemImage: "plus", action: onContribute)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}

extension GoalPace {
    var pill: Pill {
        switch self {
        case .complete: Pill(text: label, style: .success)
        case .behind, .pastDue: Pill(text: label, style: .warning)
        case .onPace: Pill(text: label, style: .outline)
        }
    }
}

struct ContributeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let item: GoalWithProgress
    @State private var amount = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    AmountField(title: "Amount", text: $amount, allowsNegative: true)
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Record money you’ve set aside. Use a negative amount to withdraw.")
                        FormErrorRow(message: error)
                    }
                }
            }
            .navigationTitle("Add to \(item.goal.name)")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Add contribution", action: save)
                        .disabled(isSaving || amount.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        error = nil
        guard let cents = try? Money.parse(amount, allowNegative: true) else { error = "Enter a valid amount"; return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await GoalsAPI.contribute(item.id, deltaCents: cents)
                await app.didMutate()
                app.toasts.show("Contribution recorded")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "goals", fallback: "Could not record the contribution.")
            }
        }
    }
}

struct GoalFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: SavingsGoal?

    @State private var name = ""
    @State private var target = ""
    @State private var targetDate: CalendarDate?
    @State private var linkedAccountId: UUID?
    @State private var starting = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledTextField(title: "Name", text: $name, prompt: "Emergency fund, Vacation…")
                    AmountField(title: "Target", text: $target)
                    OptionalDateRow(title: "Target date", date: $targetDate)
                }
                Section {
                    Picker("Track progress by", selection: $linkedAccountId) {
                        Text("Manual — I’ll update it").tag(UUID?.none)
                        ForEach(app.accounts) { Text("Linked · \($0.name)").tag(Optional($0.id)) }
                    }
                    if existing == nil && linkedAccountId == nil {
                        AmountField(title: "Starting amount", text: $starting, prompt: "Optional")
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(linkedAccountId == nil ? "You record contributions yourself." : "Progress follows the linked account's balance.")
                        FormErrorRow(message: error)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New savings goal" : "Edit goal")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save", action: save).disabled(isSaving)
                }
            }
            .onFirstAppear {
                guard let goal = existing else { return }
                name = goal.name
                target = Money.inputString(goal.targetAmountCents)
                targetDate = goal.targetDate
                linkedAccountId = goal.linkedAccountId
            }
        }
    }

    private func save() {
        error = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { error = "Enter a name"; return }
        guard trimmed.count <= 80 else { error = "Name is too long"; return }
        guard !target.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Enter a target amount"; return }
        guard let targetCents = try? Money.parse(target) else { error = "Enter a valid target amount"; return }
        var startingCents = 0
        if existing == nil, linkedAccountId == nil, !starting.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let cents = try? Money.parse(starting) else { error = "Enter a valid starting amount"; return }
            startingCents = cents
        }
        guard let householdId = app.household?.id else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    try await GoalsAPI.update(existing.id, name: trimmed, targetCents: targetCents,
                                              targetDate: targetDate, linkedAccountId: linkedAccountId)
                } else {
                    try await GoalsAPI.create(householdId: householdId, name: trimmed, targetCents: targetCents,
                                              targetDate: targetDate, linkedAccountId: linkedAccountId, startingCents: startingCents)
                }
                await app.didMutate()
                app.toasts.show(existing == nil ? "Goal created" : "Goal updated")
                dismiss()
            } catch let shown as DisplayableError {
                error = shown.message
            } catch {
                self.error = userMessage(for: error, context: "goals", fallback: "Could not save the goal.")
            }
        }
    }
}
