import AVFAudio
import Speech
import SwiftUI
import UniformTypeIdentifiers
import UIKit

@main
struct RightsDeskTranscribeApp: App {
    var body: some Scene {
        WindowGroup { TranscriptionView() }
    }
}

private struct TranscriptionView: View {
    @State private var recording: URL?
    @State private var choosingFile = false
    @State private var locales: [Locale] = []
    @State private var localeID = ""
    @State private var transcript = ""
    @State private var hasTranscript = false
    @State private var job: Task<Void, Never>?
    @State private var status = ""
    @State private var errorMessage: String?

    private var transcriptForCopy: String {
        transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button("Choose M4A from Files", systemImage: "waveform") { choosingFile = true }
                        .disabled(job != nil)
                    if let recording {
                        Text(recording.lastPathComponent)
                            .foregroundStyle(.secondary)
                    }
                    if !locales.isEmpty {
                        Picker("Spoken language", selection: $localeID) {
                            ForEach(locales, id: \.identifier) { locale in
                                Text(languageName(locale)).tag(locale.identifier)
                            }
                        }
                        .disabled(job != nil)
                    }
                    Button("Transcribe on this iPhone", action: start)
                        .disabled(recording == nil || localeID.isEmpty || job != nil)
                    if job != nil {
                        ProgressView(status)
                        Button("Cancel transcription", role: .cancel) {
                            status = "Canceling…"
                            job?.cancel()
                        }
                    } else if !status.isEmpty {
                        Text(status).foregroundStyle(.secondary)
                    }
                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Recording")
                } footer: {
                    Text("In Voice Memos, share the recording and choose Save to Files first. Your iPhone transcribes the recording. It may download an Apple language model the first time you use that language.")
                }

                if hasTranscript {
                    Section {
                        TextEditor(text: $transcript)
                            .accessibilityLabel("Editable transcript")
                            .frame(minHeight: 160)
                            .disabled(job != nil)
                        if transcriptForCopy.utf16.count > 8_000 {
                            Text("Shorten the transcript to 8,000 characters for Rights Desk.")
                                .foregroundStyle(.secondary)
                        }
                        Button("Copy for Rights Desk", systemImage: "document.on.document", action: copy)
                            .disabled(transcriptForCopy.isEmpty || transcriptForCopy.utf16.count > 8_000 || job != nil)
                    } header: {
                        Text("Review transcript")
                    } footer: {
                        Text("Check the wording before copying. In Rights Desk, open the saved audio note, choose Paste transcript (or Edit transcript if it already has one), then paste and save.")
                    }
                }
            }
            .navigationTitle("Rights Desk Transcribe")
            .navigationBarTitleDisplayMode(.inline)
            .task { await loadLanguages() }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.mpeg4Audio]) { result in
                do {
                    let file = try result.get()
                    guard file.pathExtension.lowercased() == "m4a" else { throw RecordingError.wrongFormat }
                    if file != recording {
                        transcript = ""
                        hasTranscript = false
                    }
                    recording = file
                    status = ""
                    errorMessage = nil
                } catch {
                    report(error.localizedDescription)
                }
            }
        }
    }

    private func languageName(_ locale: Locale) -> String {
        Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
    }

    private func loadLanguages() async {
        guard SpeechTranscriber.isAvailable else {
            report("On-device transcription is unavailable on this iPhone.")
            return
        }
        let available = await SpeechTranscriber.supportedLocales
        locales = available.sorted { languageName($0).localizedStandardCompare(languageName($1)) == .orderedAscending }
        let preferred = await SpeechTranscriber.supportedLocale(equivalentTo: .current)
        let english = locales.first { $0.language.languageCode?.identifier == "en" }
        localeID = preferred?.identifier ?? english?.identifier ?? locales.first?.identifier ?? ""
        if locales.isEmpty { report("This iPhone has no available transcription languages.") }
    }

    private func start() {
        guard let recording, !localeID.isEmpty, job == nil else { return }
        let locale = Locale(identifier: localeID)
        status = "Preparing transcription…"
        errorMessage = nil
        job = Task { @MainActor in
            defer { job = nil }
            do {
                transcript = try await LocalTranscription.read(recording, locale: locale) { message in
                    status = message
                }
                hasTranscript = true
                status = "Transcript ready to review."
                AccessibilityNotification.Announcement(status).post()
            } catch is CancellationError {
                status = "Transcription cancelled."
            } catch {
                if Task.isCancelled { status = "Transcription cancelled." }
                else { report(error.localizedDescription) }
            }
        }
    }

    private func report(_ message: String) {
        status = ""
        errorMessage = message
        AccessibilityNotification.Announcement(message).post()
    }

    private func copy() {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: transcriptForCopy]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)]
        )
        status = "Copied. You can paste it into your Rights Desk note."
        AccessibilityNotification.Announcement(status).post()
    }
}

private enum RecordingError: LocalizedError {
    case wrongFormat, tooLarge, unreadable, modelUnavailable, modelDownload, transcription, noSpeech

    var errorDescription: String? {
        switch self {
        case .wrongFormat: "Choose an M4A recording from Voice Memos."
        case .tooLarge: "Choose a recording up to 20 MB, the Rights Desk upload limit."
        case .unreadable: "Couldn’t open the recording. Save it to Files again and retry."
        case .modelUnavailable: "This iPhone can’t transcribe the selected language. Choose another spoken language."
        case .modelDownload: "Couldn’t prepare the Apple language model. Check your connection and try again."
        case .transcription: "Couldn’t transcribe this file. Try another M4A recording."
        case .noSpeech: "No speech was recognized. Check the recording and selected language."
        }
    }
}

private enum LocalTranscription {
    static func read(
        _ url: URL,
        locale: Locale,
        progress: @MainActor @Sendable (String) -> Void
    ) async throws -> String {
        let scopedAccess = url.startAccessingSecurityScopedResource()
        defer { if scopedAccess { url.stopAccessingSecurityScopedResource() } }
        guard let audio = try? AVAudioFile(forReading: url), audio.length > 0 else {
            throw RecordingError.unreadable
        }
        let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard (size ?? 0) <= 20 * 1_024 * 1_024 else { throw RecordingError.tooLarge }
        try Task.checkCancellation()

        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        let modules = [transcriber]
        let assetStatus = await AssetInventory.status(forModules: modules)
        guard assetStatus != .unsupported else { throw RecordingError.modelUnavailable }
        if assetStatus != .installed {
            await progress("Preparing the Apple language model…")
            do {
                if let installation = try await AssetInventory.assetInstallationRequest(supporting: modules) {
                    try await installation.downloadAndInstall()
                }
                guard await AssetInventory.status(forModules: modules) == .installed else { throw RecordingError.modelDownload }
            } catch {
                try Task.checkCancellation()
                throw RecordingError.modelDownload
            }
        }

        try Task.checkCancellation()
        await progress("Transcribing on this iPhone…")
        let analyzer = SpeechAnalyzer(modules: modules)
        let result = try await withTaskCancellationHandler {
            async let text = collectResults(from: transcriber)
            do {
                if let lastSample = try await analyzer.analyzeSequence(from: audio) {
                    try await analyzer.finalizeAndFinish(through: lastSample)
                } else {
                    await analyzer.cancelAndFinishNow()
                }
                return try await text
            } catch {
                await analyzer.cancelAndFinishNow()
                try Task.checkCancellation()
                throw RecordingError.transcription
            }
        } onCancel: {
            Task { await analyzer.cancelAndFinishNow() }
        }
        try Task.checkCancellation()
        let transcript = result.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { throw RecordingError.noSpeech }
        return transcript
    }

    private static func collectResults(from transcriber: SpeechTranscriber) async throws -> String {
        var text = ""
        for try await result in transcriber.results {
            text += String(result.text.characters)
        }
        return text
    }
}
