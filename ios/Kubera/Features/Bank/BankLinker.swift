import LinkKit
import SwiftUI

/// Drives Plaid Link: fetch a link token → present Link → exchange the public
/// token server-side. Also used for "Reconnect" (update mode) when a bank asks
/// the household to sign in again.
@Observable
@MainActor
final class BankLinker {
    var isPresented = false
    private(set) var handler: (any Handler)?
    private(set) var isWorking = false

    func start(app: AppModel, reconnecting connection: BankConnection? = nil) {
        guard !isWorking else { return }
        isWorking = true
        Task {
            do {
                let token = try await BankAPI.linkToken(reconnecting: connection?.id)
                // The closures hold self until Link finishes; `handler` is
                // cleared on finish/exit, which breaks the cycle.
                var config = LinkTokenConfiguration(token: token) { success in
                    Task { @MainActor in await self.finish(success, app: app, reconnecting: connection) }
                }
                config.onExit = { exit in
                    Task { @MainActor in
                        self.isPresented = false
                        self.isWorking = false
                        self.handler = nil
                        if let error = exit.error {
                            logError("bank", "link exited: \(error.errorMessage)")
                            app.toasts.error(error.displayMessage ?? "The bank connection didn't finish.")
                        }
                    }
                }
                switch Plaid.create(config) {
                case .success(let handler):
                    self.handler = handler
                    isPresented = true
                case .failure(let error):
                    logError("bank", "Plaid.create failed: \(error)")
                    app.toasts.error("Couldn't start the bank connection.")
                    isWorking = false
                }
            } catch {
                app.toasts.error((error as? DisplayableError)?.message
                                 ?? userMessage(for: error, context: "bank", fallback: "Couldn't start the bank connection."))
                isWorking = false
            }
        }
    }

    private func finish(_ success: LinkSuccess, app: AppModel, reconnecting connection: BankConnection?) async {
        isPresented = false
        defer {
            isWorking = false
            handler = nil
        }
        if let connection {
            // Update mode keeps the same access token — just resync.
            app.toasts.show("\(connection.name) reconnected")
            _ = try? await BankAPI.sync(connection.id)
            await app.didMutate()
            return
        }
        do {
            app.toasts.show("Connecting \(success.metadata.institution.name)…", style: .info)
            let summary = try await BankAPI.exchange(
                publicToken: success.publicToken,
                institutionId: success.metadata.institution.id,
                institutionName: success.metadata.institution.name
            )
            await app.didMutate()
            let count = (summary?.added ?? 0) + (summary?.matched ?? 0)
            app.toasts.show(count > 0
                ? "\(success.metadata.institution.name) linked — \(count) transactions to review"
                : "\(success.metadata.institution.name) linked — transactions will arrive shortly")
        } catch {
            app.toasts.error((error as? DisplayableError)?.message
                             ?? userMessage(for: error, context: "bank", fallback: "Couldn't link the bank."))
        }
    }
}

private struct BankLinkPresenter: ViewModifier {
    @Bindable var linker: BankLinker

    func body(content: Content) -> some View {
        if let handler = linker.handler {
            content.plaidLink(isPresented: $linker.isPresented, handler: handler)
        } else {
            content
        }
    }
}

extension View {
    func bankLink(_ linker: BankLinker) -> some View { modifier(BankLinkPresenter(linker: linker)) }
}
