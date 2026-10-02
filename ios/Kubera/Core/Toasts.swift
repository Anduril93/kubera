import SwiftUI

/// Lightweight toast messages, the native stand-in for the web app's sonner toasts.
@Observable
@MainActor
final class ToastCenter {
    enum Style { case success, info, error }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let style: Style
    }

    private(set) var current: Toast?

    func show(_ message: String, style: Style = .success) {
        let toast = Toast(message: message, style: style)
        current = toast
        Task {
            try? await Task.sleep(for: .seconds(style == .error ? 4 : 2.5))
            if current == toast { current = nil }
        }
    }

    func error(_ message: String) { show(message, style: .error) }
}

struct ToastOverlay: ViewModifier {
    let center: ToastCenter

    func body(content: Content) -> some View {
        content.overlay {
            // Inside an ignoresSafeArea container the proxy reports a zero inset,
            // so read the window's real top inset (status bar / Dynamic Island).
            GeometryReader { _ in
                VStack {
                    if let toast = center.current {
                        Label(toast.message, systemImage: icon(for: toast.style))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(toast.style == .error ? AnyShapeStyle(Color.negative) : AnyShapeStyle(.primary))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .glassEffect(.regular, in: .capsule)
                            .padding(.horizontal, 16)
                            .transition(.move(edge: .top).combined(with: .opacity))
                            .id(toast.id)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, windowTopInset + 6)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
        .animation(.spring(duration: 0.3), value: center.current)
        .onChange(of: center.current) { _, toast in
            if let toast { AccessibilityNotification.Announcement(toast.message).post() }
        }
    }

    private var windowTopInset: CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow?.safeAreaInsets.top ?? 54
    }

    private func icon(for style: ToastCenter.Style) -> String {
        switch style {
        case .success: "checkmark.circle.fill"
        case .info: "info.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}

extension View {
    func toasts(_ center: ToastCenter) -> some View { modifier(ToastOverlay(center: center)) }
}
