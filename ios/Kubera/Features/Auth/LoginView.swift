import Auth
import SwiftUI

/// Sign-in only — accounts are provisioned by an admin in Supabase (there is
/// no registration, same as the web app).
struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isSigningIn = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        BrandMark(size: 56)
                        Text("Roundtable Finance").font(.title2.weight(.semibold))
                        Text("Enter your email and password to access your household.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    TextField("Email", text: $email, prompt: Text(verbatim: "you@example.com"))
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                } footer: {
                    FormErrorRow(message: error)
                }

                Section {
                    Button(action: signIn) {
                        Text(isSigningIn ? "Signing in…" : "Sign in")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isSigningIn || email.isEmpty || password.isEmpty)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .formKeyboard()
            .onAppear { focus = .email }
        }
    }

    private func signIn() {
        guard !isSigningIn, !email.isEmpty, !password.isEmpty else { return }
        isSigningIn = true
        error = nil
        Task {
            defer { isSigningIn = false }
            do {
                try await app.signIn(email: email.trimmingCharacters(in: .whitespaces).lowercased(), password: password)
            } catch let AuthError.api(_, code, _, response)
                where response.statusCode == 429 || code == .overRequestRateLimit {
                error = "Too many attempts. Please try again later."
            } catch let urlError as URLError {
                error = userMessage(for: urlError, context: "auth", fallback: "Invalid email or password")
            } catch {
                // Generic on purpose: never reveal whether the email exists.
                self.error = "Invalid email or password"
            }
        }
    }
}

/// The "round table" mark from the app icon, drawn natively.
struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        Canvas { context, canvasSize in
            let s = canvasSize.width / 512
            let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
            func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
                Path(ellipseIn: CGRect(x: c.x - r * s, y: c.y - r * s, width: 2 * r * s, height: 2 * r * s))
            }
            context.stroke(circle(center, 150), with: .foreground, lineWidth: 28 * s)
            context.fill(circle(center, 46), with: .foreground)
            for (dx, dy) in [(0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)] {
                context.fill(circle(CGPoint(x: center.x + dx * 150 * s, y: center.y + dy * 150 * s), 26), with: .foreground)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
