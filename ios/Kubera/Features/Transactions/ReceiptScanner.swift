import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// Receipt capture → upload → AI scan → prefilled transaction draft.
///
/// Upload failures stop the flow with a toast (nothing to attach). Scan
/// failures still open the form, blank, with the receipt attached — the same
/// behavior as the web app's "Scan receipt" button.
@Observable
@MainActor
final class ReceiptScanner {
    enum Source { case camera, photos, files }

    struct Result: Identifiable {
        let id = UUID()
        let receipts: [ReceiptsAPI.UploadedReceipt]
        let draft: ReceiptDraft?
        let scanError: String?
    }

    var presenting: Source?
    var photoSelection: [PhotosPickerItem] = []
    private(set) var isWorking = false

    func process(_ files: [Data], householdId: UUID, toasts: ToastCenter) async -> Result? {
        guard !files.isEmpty else { return nil }
        guard files.count <= ReceiptFileType.maxFiles else {
            toasts.error("Too many files (max 8).")
            return nil
        }
        isWorking = true
        defer { isWorking = false }

        var uploaded: [ReceiptsAPI.UploadedReceipt] = []
        do {
            for data in files {
                uploaded.append(try await ReceiptsAPI.upload(data, householdId: householdId))
            }
        } catch {
            await ReceiptsAPI.discard(uploaded)
            if let shown = error as? DisplayableError {
                toasts.error(shown.message)
            } else {
                toasts.error(userMessage(for: error, context: "receipts", fallback: "Upload failed. Enter the transaction manually."))
            }
            return nil
        }

        do {
            let draft = try await ReceiptsAPI.scan(uploaded)
            toasts.show("Receipt scanned — review and confirm.")
            return Result(receipts: uploaded, draft: draft, scanError: nil)
        } catch {
            return Result(receipts: uploaded, draft: nil, scanError: error.message)
        }
    }

    /// Re-encodes an image as a JPEG no larger than 2048 px on its long side —
    /// plenty for OCR, well under the 10 MB limit, and fewer tokens to scan.
    nonisolated static func normalizedJPEG(_ image: UIImage) -> Data? {
        let maxSide: CGFloat = 2048
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: 0.8)
    }
}

struct ScanReceiptMenu: View {
    @Environment(AppModel.self) private var app
    let scanner: ReceiptScanner

    var body: some View {
        if app.accounts.isEmpty {
            Button("Scan receipt", systemImage: "doc.text.viewfinder") { _ = app.requireAccount() }
        } else {
            menu
        }
    }

    private var menu: some View {
        Menu {
            if VNDocumentCameraViewController.isSupported {
                Button("Scan with camera", systemImage: "camera") { scanner.presenting = .camera }
            }
            Button("Choose photos", systemImage: "photo.on.rectangle") { scanner.presenting = .photos }
            Button("Choose file", systemImage: "doc") { scanner.presenting = .files }
        } label: {
            Label("Scan receipt", systemImage: "doc.text.viewfinder")
        }
    }
}

struct ScanningOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.15).ignoresSafeArea()
            VStack(spacing: 10) {
                ProgressView()
                Text("Scanning…").font(.subheadline.weight(.medium))
            }
            .padding(24)
            .glassEffect(.regular, in: .rect(cornerRadius: 20))
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ReceiptScannerModifier: ViewModifier {
    @Environment(AppModel.self) private var app
    @Bindable var scanner: ReceiptScanner
    let onResult: (ReceiptScanner.Result) -> Void

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: presented(.camera)) {
                DocumentCamera { images in
                    scanner.presenting = nil
                    let files = images.compactMap(ReceiptScanner.normalizedJPEG)
                    run(files)
                } onCancel: {
                    scanner.presenting = nil
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: presented(.photos), selection: $scanner.photoSelection,
                          maxSelectionCount: ReceiptFileType.maxFiles, matching: .images)
            .onChange(of: scanner.photoSelection) { _, items in
                guard !items.isEmpty else { return }
                scanner.photoSelection = []
                Task {
                    var files: [Data] = []
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self),
                           let image = UIImage(data: data),
                           let jpeg = ReceiptScanner.normalizedJPEG(image) {
                            files.append(jpeg)
                        }
                    }
                    run(files)
                }
            }
            .fileImporter(isPresented: presented(.files), allowedContentTypes: [.pdf, .jpeg, .png, .webP],
                          allowsMultipleSelection: true) { result in
                guard case .success(let urls) = result else { return }
                let files = urls.compactMap { url -> Data? in
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    guard let data = try? Data(contentsOf: url) else { return nil }
                    // PDFs go up as-is; images are normalized like photos.
                    if ReceiptFileType.detect(data) == .pdf { return data }
                    return UIImage(data: data).flatMap(ReceiptScanner.normalizedJPEG) ?? data
                }
                run(files)
            }
    }

    private func presented(_ source: ReceiptScanner.Source) -> Binding<Bool> {
        Binding(get: { scanner.presenting == source }, set: { if !$0, scanner.presenting == source { scanner.presenting = nil } })
    }

    private func run(_ files: [Data]) {
        guard let householdId = app.household?.id else { return }
        Task {
            if let result = await scanner.process(files, householdId: householdId, toasts: app.toasts) {
                onResult(result)
            }
        }
    }
}

extension View {
    func receiptScanner(_ scanner: ReceiptScanner, onResult: @escaping (ReceiptScanner.Result) -> Void) -> some View {
        modifier(ReceiptScannerModifier(scanner: scanner, onResult: onResult))
    }
}

/// VisionKit's document camera: edge detection, perspective correction, multi-page.
private struct DocumentCamera: UIViewControllerRepresentable {
    let onScan: ([UIImage]) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan, onCancel: onCancel) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: ([UIImage]) -> Void
        let onCancel: () -> Void

        init(onScan: @escaping ([UIImage]) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan
            self.onCancel = onCancel
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pages = (0..<min(scan.pageCount, ReceiptFileType.maxFiles)).map { scan.imageOfPage(at: $0) }
            onScan(pages)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onCancel()
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            logError("receipts", "document camera failed: \(error)")
            onCancel()
        }
    }
}
