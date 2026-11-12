import AVFAudio
import Foundation

enum DeskError: LocalizedError {
    case invalidRequest, busy, storage, deskFull, wrongFormat, tooLarge, unreadable, missingRecording
    case playbackFailed, deviceUnsupported, languageUnsupported, downloadNeeded, downloadFailed
    case downloadLocaleLimit, downloadResources, downloadPending
    case transcriptionFailed, recordingTooLong, noSpeech, websiteUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidRequest: "Rights Desk couldn’t use that request."
        case .busy: "Finish the current action and try again."
        case .storage: "Couldn’t read or save notes on this iPhone."
        case .deskFull: "This iPhone’s Rights Desk recording space is full."
        case .wrongFormat: "Choose an M4A, WAV, or MP3 recording."
        case .tooLarge: "Choose a recording up to 20 MB."
        case .unreadable: "Couldn’t open this recording. Save it to Files and try again."
        case .missingRecording: "This recording is no longer on this iPhone."
        case .playbackFailed: "Couldn’t play this recording."
        case .deviceUnsupported: "On-device transcription is unavailable on this iPhone."
        case .languageUnsupported: "This iPhone can’t transcribe in that language."
        case .downloadNeeded: "Download this spoken language before you transcribe."
        case .downloadFailed: "Apple couldn’t prepare this language. Try again on Wi-Fi, or skip setup and save the memo."
        case .downloadLocaleLimit: "This app has reached Apple’s offline language limit. Choose an installed language or skip setup."
        case .downloadResources: "iPhone doesn’t have enough resources to prepare this language. Check your available storage and try again."
        case .downloadPending: "Apple is still preparing this language. Stay on Wi-Fi and try again shortly."
        case .transcriptionFailed: "Couldn’t transcribe this recording. You can still edit and save the note."
        case .recordingTooLong: "Automatic transcription supports recordings up to five minutes. You can still play and save this recording."
        case .noSpeech: "No speech was recognized. Check the recording and the spoken language."
        case .websiteUnavailable: "A Rights Desk website link hasn’t been set up for this build."
        }
    }
}

struct PrivateDeskStore: Sendable {
    static let maximumStateBytes = 4 * 1024 * 1024
    private static let maximumAudioBytes = 20 * 1024 * 1024
    private static let maximumLibraryBytes = 500 * 1024 * 1024
    private static let audioExtensions = ["m4a", "wav", "mp3"]
    private let directory = URL.applicationSupportDirectory.appending(path: "RightsDesk", directoryHint: .isDirectory)

    func readState() throws -> [String: Any] {
        let url = try storageDirectory().appending(path: "notes.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
            guard let size, size <= Self.maximumStateBytes,
                  let state = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else {
                throw DeskError.storage
            }
            return state
        } catch {
            throw DeskError.storage
        }
    }

    func writeState(_ state: [String: Any]) throws {
        do {
            let bytes = try JSONSerialization.data(withJSONObject: state)
            guard bytes.count <= Self.maximumStateBytes else { throw DeskError.deskFull }
            try bytes.write(to: storageDirectory().appending(path: "notes.json"), options: [.atomic, .completeFileProtection])
        } catch let error as DeskError {
            throw error
        } catch {
            throw DeskError.storage
        }
    }

    func importAudio(from source: URL) throws -> (id: String, name: String) {
        let fileExtension = source.pathExtension.lowercased()
        guard Self.audioExtensions.contains(fileExtension) else { throw DeskError.wrongFormat }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }

        let folder = try audioDirectory()
        let currentSize = try librarySize(in: folder)
        guard currentSize < Self.maximumLibraryBytes else { throw DeskError.deskFull }
        let id = UUID().uuidString.lowercased()
        let destination = folder.appending(path: "\(id).\(fileExtension)")
        var readingError: NSError?
        var importResult: Result<Void, Error> = .failure(DeskError.unreadable)
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(readingItemAt: source, options: .withoutChanges, error: &readingError) { source in
            importResult = Result { try copyAudio(from: source, to: destination, existingBytes: currentSize) }
        }
        do {
            if readingError != nil { throw DeskError.unreadable }
            try importResult.get()
            guard let audio = try? AVAudioFile(forReading: destination), audio.length > 0 else {
                throw DeskError.unreadable
            }
            return (id: id, name: String(source.lastPathComponent.prefix(160)))
        } catch {
            try? FileManager.default.removeItem(at: destination)
            if let error = error as? DeskError { throw error }
            throw DeskError.unreadable
        }
    }

    func audioURL(id: String) throws -> URL {
        guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else {
            throw DeskError.invalidRequest
        }
        let directory = try audioDirectory()
        for ext in Self.audioExtensions {
            let file = directory.appending(path: "\(id).\(ext)")
            if FileManager.default.fileExists(atPath: file.path) { return file }
        }
        throw DeskError.missingRecording
    }

    func deleteAudio(id: String) throws {
        let state = try readState()
        let notes = state["notes"] as? [[String: Any]] ?? []
        let draft = state["draft"] as? [String: Any]
        let attachments = notes.compactMap { $0["audio"] as? [String: Any] } + [draft?["audio"] as? [String: Any]].compactMap { $0 }
        guard !attachments.contains(where: { $0["id"] as? String == id }) else { return }
        do { try FileManager.default.removeItem(at: audioURL(id: id)) }
        catch DeskError.missingRecording { return }
        catch let error as DeskError { throw error }
        catch { throw DeskError.storage }
    }

    private func storageDirectory() throws -> URL {
        do {
            var url = directory
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [
                .protectionKey: FileProtectionType.complete,
            ])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            return url
        } catch {
            throw DeskError.storage
        }
    }

    private func audioDirectory() throws -> URL {
        do {
            let folder = try storageDirectory().appending(path: "Audio", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [
                .protectionKey: FileProtectionType.complete,
            ])
            return folder
        } catch {
            throw DeskError.storage
        }
    }

    private func librarySize(in folder: URL) throws -> Int {
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])
        return try files.reduce(0) { total, file in
            total + (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        }
    }

    private func copyAudio(from source: URL, to destination: URL, existingBytes: Int) throws {
        let reader = try FileHandle(forReadingFrom: source)
        defer { try? reader.close() }
        guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [
            .protectionKey: FileProtectionType.complete,
        ]) else { throw DeskError.storage }
        let writer = try FileHandle(forWritingTo: destination)
        defer { try? writer.close() }
        var bytes = 0
        while let chunk = try reader.read(upToCount: 64 * 1024), !chunk.isEmpty {
            bytes += chunk.count
            guard bytes <= Self.maximumAudioBytes else { throw DeskError.tooLarge }
            guard existingBytes + bytes <= Self.maximumLibraryBytes else { throw DeskError.deskFull }
            try writer.write(contentsOf: chunk)
        }
        guard bytes > 0 else { throw DeskError.unreadable }
    }
}
