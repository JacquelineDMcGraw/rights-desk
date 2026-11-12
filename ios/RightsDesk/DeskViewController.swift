import AVFAudio
import UniformTypeIdentifiers
import UIKit
import WebKit

@MainActor
final class DeskViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate, AVAudioPlayerDelegate {
    private let store = PrivateDeskStore()
    private var notesView: WKWebView!
    private var deskView: WKWebView?
    private var deskButton: UIButton?
    private var notesStarted = false
    private var deskLoadFailed = false
    private var pickerRequest: String?
    private var modelTaskRunning = false
    private var player: AVAudioPlayer?
    private var playingAudioID: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)

        let websiteURL = Self.websiteURL
        if websiteURL != nil {
            let configuration = WKWebViewConfiguration()
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.rightsDeskNativeHome = true;",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
            deskView = addWebView(configuration, below: nil)

            let button = UIButton(type: .system)
            var style = UIButton.Configuration.plain()
            style.title = "‹  Back to My desk"
            style.baseForegroundColor = UIColor(red: 0.25, green: 0.96, blue: 0.86, alpha: 1)
            style.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
            button.configuration = style
            button.contentHorizontalAlignment = .leading
            button.translatesAutoresizingMaskIntoConstraints = false
            button.addTarget(self, action: #selector(returnToDesk), for: .touchUpInside)
            button.isHidden = true
            view.addSubview(button)
            NSLayoutConstraint.activate([
                button.topAnchor.constraint(equalTo: view.topAnchor),
                button.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                button.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            ])
            deskButton = button
        }

        let notesConfiguration = WKWebViewConfiguration()
        notesConfiguration.websiteDataStore = .nonPersistent()
        notesConfiguration.setURLSchemeHandler(DeskAssets(), forURLScheme: DeskAssets.scheme)
        notesConfiguration.userContentController.add(DeskMessageReceiver(self), name: "rightsDesk")
        notesView = addWebView(notesConfiguration, below: deskButton)
        if let websiteURL {
            notesView.isHidden = true
            openDesk(websiteURL)
        } else {
            showNotes()
        }
    }

    private func addWebView(_ configuration: WKWebViewConfiguration, below button: UIButton?) -> WKWebView {
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.navigationDelegate = self
        browser.isOpaque = false
        browser.backgroundColor = view.backgroundColor
        browser.scrollView.backgroundColor = view.backgroundColor
        browser.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(browser)
        NSLayoutConstraint.activate([
            browser.topAnchor.constraint(equalTo: button?.bottomAnchor ?? view.topAnchor),
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            browser.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        return browser
    }

    private func openDesk(_ url: URL) {
        deskLoadFailed = false
        deskView?.load(URLRequest(url: url, timeoutInterval: 12))
    }

    private func showNotes(afterLoadFailure: Bool = false) {
        deskLoadFailed = afterLoadFailure
        deskButton?.configuration?.title = afterLoadFailure ? "↻  Reopen My desk" : "‹  Back to My desk"
        deskView?.isHidden = true
        deskButton?.isHidden = false
        notesView.isHidden = false
        if !notesStarted {
            notesStarted = true
            notesView.load(URLRequest(url: DeskAssets.home))
        }
    }

    @objc private func returnToDesk() {
        guard let url = Self.websiteURL else { return }
        stopAudio()
        notesView.isHidden = true
        deskButton?.isHidden = true
        deskView?.isHidden = false
        if deskLoadFailed { openDesk(url) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if webView === notesView {
            return DeskAssets.isHome(url) && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel
        }
        guard webView === deskView, let configuredURL = Self.websiteURL else { return .cancel }
        if url.absoluteString == "rightsdesk://ip-notes",
           navigationAction.sourceFrame.isMainFrame,
           let source = navigationAction.sourceFrame.request.url,
           Self.sameOrigin(source, configuredURL) {
            showNotes()
            return .cancel
        }
        let sandbox = url.scheme == "https" &&
            (url.host == "sandbox.paypal.com" || url.host?.hasSuffix(".sandbox.paypal.com") == true)
        if Self.sameOrigin(url, configuredURL) || sandbox {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
                return .cancel
            }
            return .allow
        }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" {
            await UIApplication.shared.open(url)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        deskNavigationFailed(webView, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        deskNavigationFailed(webView, error: error)
    }

    private func deskNavigationFailed(_ webView: WKWebView, error: Error) {
        let error = error as NSError
        guard webView === deskView, !webView.isHidden, error.code != NSURLErrorCancelled,
              let configuredURL = Self.websiteURL,
              webView.url.map({ Self.sameOrigin($0, configuredURL) }) ?? true else { return }
        showNotes(afterLoadFailure: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, DeskAssets.isHome(url),
              let body = message.body as? String,
              body.utf8.count <= PrivateDeskStore.maximumStateBytes + 1024,
              let request = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let id = request["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
              let action = request["action"] as? String else { return }
        let arguments = request["data"] as? [String: Any] ?? [:]
        Task {
            do {
                if action == "importAudio" {
                    try startImport(id: id)
                    return
                }
                let value = try await perform(action, arguments: arguments, id: id)
                reply(id, value: value)
            } catch {
                reject(id, error: error)
            }
        }
    }

    private func perform(_ action: String, arguments: [String: Any], id: String) async throws -> [String: Any] {
        switch action {
        case "getAppInfo":
            return ["maxTranscriptionMinutes": 5, "platform": "ios"]
        case "readState":
            return try store.readState()
        case "writeState":
            try store.writeState(arguments)
        case "getLanguages":
            guard #available(iOS 26.0, *) else { return ["languages": [], "preferredLanguage": ""] }
            return await PhoneSpeech.languages()
        case "downloadLanguage":
            guard #available(iOS 26.0, *) else { throw DeskError.deviceUnsupported }
            guard let language = arguments["languageId"] as? String else { throw DeskError.invalidRequest }
            guard !modelTaskRunning else { throw DeskError.busy }
            modelTaskRunning = true
            defer { modelTaskRunning = false }
            progress(id, message: "Preparing Apple’s language model…")
            try await PhoneSpeech.download(languageID: language)
        case "transcribe":
            guard #available(iOS 26.0, *) else { throw DeskError.deviceUnsupported }
            guard let audioID = arguments["audioId"] as? String,
                  let language = arguments["languageId"] as? String else { throw DeskError.invalidRequest }
            guard !modelTaskRunning else { throw DeskError.busy }
            let url = try store.audioURL(id: audioID)
            modelTaskRunning = true
            defer { modelTaskRunning = false }
            stopAudio()
            progress(id, message: "Transcribing on this iPhone…")
            return ["transcript": try await PhoneSpeech.transcribe(url, languageID: language)]
        case "playAudio":
            guard let audioID = arguments["audioId"] as? String else { throw DeskError.invalidRequest }
            try playAudio(id: audioID)
        case "stopAudio":
            stopAudio()
        case "deleteAudio":
            guard let audioID = arguments["audioId"] as? String else { throw DeskError.invalidRequest }
            if playingAudioID == audioID { stopAudio() }
            try store.deleteAudio(id: audioID)
        case "copyText":
            guard let text = arguments["text"] as? String, !text.isEmpty, text.utf16.count <= 8_000 else {
                throw DeskError.invalidRequest
            }
            UIPasteboard.general.setItems(
                [[UTType.utf8PlainText.identifier: text]],
                options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)]
            )
        default:
            throw DeskError.invalidRequest
        }
        return [:]
    }

    private static var websiteURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "RightsDeskWebsiteURL") as? String,
              let url = URL(string: raw), let host = url.host,
              url.user == nil, url.password == nil else { return nil }
        if url.scheme == "https" { return url }
        let localDemo = Bundle.main.object(forInfoDictionaryKey: "RightsDeskAllowsLocalHTTP") as? Bool == true
        return url.scheme == "http" && localDemo && isPrivateIPv4(host) ? url : nil
    }

    private static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        let octets = parts.compactMap { UInt8($0) }
        guard parts.count == 4, octets.count == 4 else { return false }
        return octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    private static func sameOrigin(_ first: URL, _ second: URL) -> Bool {
        let firstPort = first.port ?? (first.scheme == "https" ? 443 : 80)
        let secondPort = second.port ?? (second.scheme == "https" ? 443 : 80)
        return first.scheme == second.scheme && first.host == second.host && firstPort == secondPort
    }

    private func startImport(id: String) throws {
        guard pickerRequest == nil, presentedViewController == nil else { throw DeskError.busy }
        pickerRequest = id
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.mpeg4Audio, .wav, .mp3], asCopy: false)
        picker.delegate = self
        present(picker, animated: true)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let id = pickerRequest else { return }
        pickerRequest = nil
        reply(id, value: ["cancelled": true])
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let id = pickerRequest else { return }
        guard let source = urls.first else {
            pickerRequest = nil
            reply(id, value: ["cancelled": true])
            return
        }
        progress(id, message: "Importing your recording…")
        let store = store
        Task {
            defer { pickerRequest = nil }
            do {
                let audio = try await Task.detached(priority: .userInitiated) {
                    try store.importAudio(from: source)
                }.value
                reply(id, value: ["id": audio.id, "name": audio.name])
            } catch {
                reject(id, error: error)
            }
        }
    }

    private func playAudio(id: String) throws {
        let url = try store.audioURL(id: id)
        stopAudio()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback)
            try session.setActive(true)
            let audio = try AVAudioPlayer(contentsOf: url)
            audio.delegate = self
            guard audio.play() else { throw DeskError.playbackFailed }
            player = audio
            playingAudioID = id
        } catch {
            stopAudio()
            throw DeskError.playbackFailed
        }
    }

    private func stopAudio() {
        player?.stop()
        player = nil
        playingAudioID = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let playerID = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let currentPlayer = self.player, ObjectIdentifier(currentPlayer) == playerID else { return }
            let audioID = playingAudioID
            stopAudio()
            if let audioID {
                _ = try? await notesView.callAsyncJavaScript(
                    "window.rightsDeskNativeAudioEnded?.(audioId)",
                    arguments: ["audioId": audioID],
                    in: nil,
                    contentWorld: .page
                )
            }
        }
    }

    private func reply(_ id: String, value: [String: Any]) {
        send(["id": id, "ok": true, "data": value])
    }

    private func reject(_ id: String, error: Error) {
        let message = (error as? DeskError)?.errorDescription ?? "Something went wrong. Please try again."
        send(["id": id, "ok": false, "error": message])
    }

    private func progress(_ id: String, message: String) {
        send(["id": id, "progress": message])
    }

    private func send(_ payload: [String: Any]) {
        Task {
            _ = try? await notesView.callAsyncJavaScript(
                "window.rightsDeskNativeReceive?.(payload)",
                arguments: ["payload": payload],
                in: nil,
                contentWorld: .page
            )
        }
    }
}

@MainActor
private final class DeskMessageReceiver: NSObject, WKScriptMessageHandler {
    weak var controller: DeskViewController?

    init(_ controller: DeskViewController) { self.controller = controller }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        self.controller?.userContentController(controller, didReceive: message)
    }
}

private final class DeskAssets: NSObject, WKURLSchemeHandler {
    static let scheme = "rightsdesk"
    static let home = URL(string: "rightsdesk://app/mobile/index.html")!
    private static let commonFiles: Set<String> = ["styles.css", "themes.css", "graffiti.css", "ip-notes.css"]
    private static let contentTypes = ["html": "text/html", "css": "text/css", "js": "text/javascript", "svg": "image/svg+xml", "png": "image/png", "woff2": "font/woff2"]

    static func isHome(_ url: URL) -> Bool {
        url.scheme == scheme && url.host == home.host && url.path == home.path
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == Self.scheme, url.host == Self.home.host,
              let root = Bundle.main.resourceURL,
              let asset = Self.asset(at: url, under: root),
              let mime = Self.contentTypes[asset.pathExtension],
              let data = try? Data(contentsOf: asset),
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": mime,
                "Content-Length": "\(data.count)",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; script-src 'self' rightsdesk:; style-src 'self' rightsdesk:; img-src 'self' rightsdesk: data:; font-src 'self' rightsdesk:; base-uri 'none'; form-action 'none'; frame-src 'none'",
              ]) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    private static func asset(at url: URL, under root: URL) -> URL? {
        let parts = url.path.split(separator: "/").map(String.init)
        guard !parts.contains(where: { $0 == "." || $0 == ".." || $0.contains("\\") }),
              (parts.count == 1 && commonFiles.contains(parts[0])) ||
              (parts.count >= 2 && parts[0] == "mobile") else { return nil }
        let asset = parts.reduce(root) { $0.appending(path: $1) }.standardizedFileURL
        return asset.path.hasPrefix(root.standardizedFileURL.path + "/") ? asset : nil
    }
}
