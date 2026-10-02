import Foundation
import Observation
import Supabase

/// Session + household state shared by every screen.
///
/// Gating mirrors the web app: no session → login; signed in without a
/// household → onboarding; otherwise the main tabs. Accounts and categories
/// are reference data most screens need, so they live here and are refreshed
/// whenever `dataVersion` changes after a mutation.
@Observable
@MainActor
final class AppModel {
    enum Phase: Equatable {
        case launching
        case signedOut
        case needsHousehold
        case ready
        case failed(String)
    }

    private(set) var phase: Phase = .launching
    private(set) var userId: UUID?
    private(set) var household: Household?
    private(set) var profile: Profile?
    private(set) var accounts: [Account] = []
    private(set) var categories: [Category] = []

    enum Tab: Hashable { case dashboard, transactions, budgets, accounts, more }
    var selectedTab: Tab = .dashboard

    /// Bumped after every successful write; screens reload with `.task(id:)`.
    private(set) var dataVersion = 0

    let toasts = ToastCenter()

    /// Page-level currency, as on the web: the first account's, else USD.
    var currency: String { accounts.first?.currency ?? "USD" }
    var isOwner: Bool { household?.ownerId == userId }
    var fiscalMonthStartDay: Int { profile?.fiscalMonthStartDay ?? 1 }

    private var authTask: Task<Void, Never>?

    func start() {
        guard Backend.isConfigured else {
            phase = .failed("This build has no Supabase configuration. Run ios/scripts/write-secrets.sh and rebuild.")
            return
        }
        guard authTask == nil else { return }
        authTask = Task { [weak self] in
            for await (event, session) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                switch event {
                case .initialSession, .signedIn, .userUpdated:
                    if let session {
                        await self.didAuthenticate(userId: session.user.id)
                    } else {
                        self.reset(to: .signedOut)
                    }
                case .signedOut, .userDeleted:
                    self.reset(to: .signedOut)
                default:
                    break
                }
            }
        }
    }

    // MARK: Auth

    func signIn(email: String, password: String) async throws {
        try await Backend.client.auth.signIn(email: email, password: password)
    }

    func signOut() async {
        try? await Backend.client.auth.signOut()
        reset(to: .signedOut)
    }

    private func didAuthenticate(userId: UUID) async {
        guard self.userId != userId || phase == .launching || phase == .signedOut else { return }
        self.userId = userId
        await loadHousehold()
    }

    private func reset(to phase: Phase) {
        selectedTab = .dashboard
        userId = nil
        household = nil
        profile = nil
        accounts = []
        categories = []
        self.phase = phase
    }

    // MARK: Household

    func loadHousehold() async {
        do {
            household = try await HouseholdAPI.current()
            if household == nil {
                phase = .needsHousehold
                return
            }
            profile = try? await HouseholdAPI.profile()
            await refreshReferenceData()
            phase = .ready
        } catch {
            phase = .failed(userMessage(for: error, context: "household", fallback: "Couldn't load your household."))
        }
    }

    func retry() async {
        phase = .launching
        if userId == nil {
            phase = .signedOut
        } else {
            await loadHousehold()
        }
    }

    func createHousehold(name: String) async throws {
        try await HouseholdAPI.create(name: name)
        await loadHousehold()
    }

    func joinHousehold(code: String) async throws {
        try await HouseholdAPI.join(code: code)
        await loadHousehold()
    }

    func householdChanged(_ updated: Household) {
        household = updated
    }

    // MARK: Reference data

    func refreshReferenceData() async {
        async let accounts = AccountsAPI.list()
        async let categories = CategoriesAPI.list()
        if let accounts = try? await accounts { self.accounts = accounts }
        if let categories = try? await categories { self.categories = categories }
    }

    /// Call after any successful write: refreshes accounts/categories and tells
    /// every visible screen to reload.
    func didMutate() async {
        await refreshReferenceData()
        dataVersion += 1
    }

    func categories(of kind: CategoryKind) -> [Category] { categories.filter { $0.kind == kind } }
    func account(_ id: UUID?) -> Account? { accounts.first { $0.id == id } }
    func category(_ id: UUID?) -> Category? { categories.first { $0.id == id } }
}
