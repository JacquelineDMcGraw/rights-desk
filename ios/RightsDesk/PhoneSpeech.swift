import AVFAudio
import OSLog
import Speech

@available(iOS 26.0, *)
@MainActor
enum PhoneSpeech {
    private static let log = Logger(subsystem: "org.rightsdesk.mobile", category: "Speech")

    static func languages() async -> [String: Any] {
        let catalog = await Catalog.load()
        var languages: [Language] = []
        for locale in catalog.locales.values {
            let engines = await availableEngines(in: catalog, for: locale.identifier)
            guard !engines.isEmpty else { continue }
            let label = Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
            languages.append(Language(id: locale.identifier, label: label, installed: engines.contains { $0.status == .installed }))
        }
        languages.sort { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
        let preferred = await catalog.preferredLocale()
        let preferredID = languages.first(where: {
            Locale(identifier: $0.id).identifier(.bcp47) == preferred?.identifier(.bcp47)
        })?.id
            ?? languages.first(where: \.installed)?.id ?? languages.first?.id ?? ""
        return [
            "languages": languages.map { ["id": $0.id, "label": $0.label, "installed": $0.installed] },
            "preferredLanguage": preferredID,
        ]
    }

    static func download(languageID: String) async throws {
        let catalog = await Catalog.load()
        let engines = await availableEngines(in: catalog, for: languageID)
        if engines.contains(where: { $0.status == .installed }) { return }
        guard let engine = engines.first?.engine else { throw DeskError.languageUnsupported }
        var failure: Error?
        do {
            // Reserve only during the user's explicit download action.
            for locale in engine.selectedLocales {
                try await AssetInventory.reserve(locale: locale)
            }
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [engine.module]) {
                try await request.downloadAndInstall()
            }
        } catch {
            failure = error
        }
        let latest = await availableEngines(in: catalog, for: languageID)
        if latest.contains(where: { $0.status == .installed }) { return }
        if let failure {
            let systemError = failure as NSError
            log.notice("Apple speech asset setup error: \(systemError.domain, privacy: .public)/\(systemError.code, privacy: .public)")
            if let speech = failure as? SFSpeechError {
                switch speech.code {
                case .tooManyAssetLocalesAllocated: throw DeskError.downloadLocaleLimit
                case .insufficientResources: throw DeskError.downloadResources
                case .cannotAllocateUnsupportedLocale: throw DeskError.languageUnsupported
                default: break
                }
            }
        }
        if latest.contains(where: { $0.status == .downloading }) { throw DeskError.downloadPending }
        throw DeskError.downloadFailed
    }

    static func transcribe(_ url: URL, languageID: String) async throws -> String {
        let engines = await availableEngines(in: Catalog.load(), for: languageID)
        guard !engines.isEmpty else { throw DeskError.languageUnsupported }
        guard let engine = engines.first(where: { $0.status == .installed })?.engine else { throw DeskError.downloadNeeded }
        guard let audio = try? AVAudioFile(forReading: url), audio.length > 0 else {
            throw DeskError.unreadable
        }
        guard Double(audio.length) / audio.fileFormat.sampleRate <= 5 * 60 else {
            throw DeskError.recordingTooLong
        }
        let analyzer = SpeechAnalyzer(modules: [engine.module])
        let result = try await withTaskCancellationHandler {
            async let text = engine.collectResults()
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
                throw DeskError.transcriptionFailed
            }
        } onCancel: {
            Task { await analyzer.cancelAndFinishNow() }
        }
        let transcript = result.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { throw DeskError.noSpeech }
        return transcript
    }

    private static func availableEngines(in catalog: Catalog, for id: String) async -> [(engine: Engine, status: AssetInventory.Status)] {
        guard id.utf8.count <= 80 else { return [] }
        let key = Locale(identifier: id).identifier(.bcp47)
        var engines: [Engine] = []
        if let locale = catalog.speech[key] {
            engines.append(.speech(SpeechTranscriber(locale: locale, preset: .transcription)))
        }
        if let locale = catalog.dictation[key] {
            engines.append(.dictation(DictationTranscriber(locale: locale, preset: .longDictation)))
        }
        var available: [(Engine, AssetInventory.Status)] = []
        for engine in engines {
            let status = await AssetInventory.status(forModules: [engine.module])
            if status != .unsupported { available.append((engine, status)) }
        }
        return available
    }

    private struct Catalog {
        let speech: [String: Locale]
        let dictation: [String: Locale]
        var locales: [String: Locale] { speech.merging(dictation) { primary, _ in primary } }

        static func load() async -> Catalog {
            let speech = SpeechTranscriber.isAvailable ? await SpeechTranscriber.supportedLocales : []
            let dictation = await DictationTranscriber.supportedLocales
            return Catalog(speech: keyed(speech), dictation: keyed(dictation))
        }

        func preferredLocale() async -> Locale? {
            if !speech.isEmpty, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) {
                return locale
            }
            return await DictationTranscriber.supportedLocale(equivalentTo: .current)
        }

        private static func keyed(_ locales: [Locale]) -> [String: Locale] {
            Dictionary(locales.map { ($0.identifier(.bcp47), $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    private enum Engine: Sendable {
        case speech(SpeechTranscriber)
        case dictation(DictationTranscriber)

        var module: any SpeechModule {
            switch self {
            case .speech(let transcriber): transcriber
            case .dictation(let transcriber): transcriber
            }
        }

        var selectedLocales: [Locale] {
            switch self {
            case .speech(let transcriber): transcriber.selectedLocales
            case .dictation(let transcriber): transcriber.selectedLocales
            }
        }

        func collectResults() async throws -> String {
            var text = ""
            switch self {
            case .speech(let transcriber):
                for try await result in transcriber.results where result.isFinal {
                    text += String(result.text.characters)
                }
            case .dictation(let transcriber):
                for try await result in transcriber.results where result.isFinal {
                    text += String(result.text.characters)
                }
            }
            return text
        }
    }

    private struct Language {
        let id: String
        let label: String
        let installed: Bool
    }
}
