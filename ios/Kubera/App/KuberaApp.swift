import SwiftUI

@main
struct KuberaApp: App {
    @State private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Gilded navigation titles: the logo's serif, in cream.
        let cream = UIColor(Color.cream)
        func serif(_ style: UIFont.TextStyle, _ weight: UIFont.Weight) -> UIFont {
            let base = UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: style).pointSize, weight: weight)
            return UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: 0)
        }
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: serif(.largeTitle, .bold), .foregroundColor: cream]
        bar.titleTextAttributes = [.font: serif(.headline, .semibold), .foregroundColor: cream]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .toasts(app.toasts)
                .preferredColorScheme(.dark)
                .tint(.gold)
                .foregroundStyle(Color.cream)
                .task { app.start() }
                .onChange(of: scenePhase) { _, phase in
                    // Coming back to the app: pick up anything the bank webhook delivered.
                    if phase == .active, app.phase == .ready { Task { await app.didMutate() } }
                }
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
                    .goldProminent()
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
        .alert("Add an account first", isPresented: $app.needsAccountPrompt) {
            Button("Go to Accounts") { app.selectedTab = .accounts }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Transactions belong to an account. Link your bank or add a manual account, then try again.")
        }
    }
}

struct MoreView: View {
    @Environment(AppModel.self) private var app
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
            }
            #if DEBUG
            Section {
                NavigationLink { DeveloperView() } label: { Label("Bank sandbox tools", systemImage: "hammer") }
            } header: {
                Text("Developer")
            }
            #endif
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
            }
        }
        .navigationTitle("More")
        .confirmationDialog("Sign out of Kubera?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await app.signOut() } }
        }
    }
}
