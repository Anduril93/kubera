import SwiftUI

@main
struct KuberaApp: App {
    @State private var app = AppModel()
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .toasts(app.toasts)
                .preferredColorScheme(appearance.colorScheme)
                .task { app.start() }
        }
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    static let storageKey = "appearance"

    case system, light, dark

    var id: String { rawValue }
    var label: String { rawValue.capitalized }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Launch gating (web: proxy.ts + the (app) layout's onboarding redirect).
struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        switch app.phase {
        case .launching:
            ProgressView()
        case .signedOut:
            LoginView()
        case .needsHousehold:
            OnboardingView()
        case .ready:
            MainTabView()
        case .failed(let message):
            ContentUnavailableView {
                Label("Something went wrong", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await app.retry() } }
                    .buttonStyle(.borderedProminent)
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            }
        }
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Dashboard", systemImage: "house", value: .dashboard) {
                NavigationStack { DashboardView() }
            }
            Tab("Transactions", systemImage: "list.bullet.rectangle.portrait", value: .transactions) {
                NavigationStack { TransactionsView() }
            }
            Tab("Budgets", systemImage: "chart.pie", value: .budgets) {
                NavigationStack { BudgetsView() }
            }
            Tab("Accounts", systemImage: "building.columns", value: .accounts) {
                NavigationStack { AccountsView() }
            }
            Tab("More", systemImage: "ellipsis", value: .more) {
                NavigationStack { MoreView() }
            }
        }
    }
}

struct MoreView: View {
    @Environment(AppModel.self) private var app
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system
    @State private var confirmSignOut = false

    var body: some View {
        List {
            Section {
                NavigationLink { BillsView() } label: { Label("Bills & income", systemImage: "calendar.badge.clock") }
                NavigationLink { GoalsView() } label: { Label("Savings goals", systemImage: "target") }
                NavigationLink { DebtsView() } label: { Label("Debts", systemImage: "creditcard.trianglebadge.exclamationmark") }
            }
            Section {
                NavigationLink { HouseholdView() } label: {
                    LabeledContent {
                        Text(app.household?.name ?? "")
                    } label: {
                        Label("Household", systemImage: "person.2")
                    }
                }
                Picker(selection: $appearance) {
                    ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                } label: {
                    Label("Appearance", systemImage: "circle.lefthalf.filled")
                }
            }
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
            }
        }
        .navigationTitle("More")
        .confirmationDialog("Sign out of Roundtable?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await app.signOut() } }
        }
    }
}
