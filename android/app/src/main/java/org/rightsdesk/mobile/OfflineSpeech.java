package org.rightsdesk.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

import javax.net.ssl.HttpsURLConnection;

final class OfflineSpeech {
    private static final String MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/"
            + "f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin";
    // PowerToys redistributes the same MIT-licensed model bytes in three parts.
    private static final String FALLBACK_URL = "https://raw.githubusercontent.com/microsoft/PowerToys/"
            + "197135502bd202373d6128a63c70909bd61e1bc9/src/modules/ZoomIt/ZoomIt/third_party/whisper/model/ggml-base-q5_1.part";
    private static final long[] FALLBACK_BYTES = {20_971_520L, 20_971_520L, 17_764_585L};
    private static final String MODEL_SHA256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898";
    static final long MODEL_BYTES = 59_707_625L;
    private static final List<String> LANGUAGES = Arrays.asList("en", "es", "fr", "de", "it", "pt", "nl",
            "ar", "hi", "ja", "ko", "pl", "ru", "tl", "tr", "uk", "vi", "zh");

    private final File model;

    OfflineSpeech(File privateDirectory) {
        model = new File(privateDirectory, "ggml-base-q5_1.bin");
    }

    JSONObject languages() throws JSONException {
        JSONArray result = new JSONArray();
        boolean installed = isInstalled();
        for (String code : LANGUAGES) {
            String label = Locale.forLanguageTag(code).getDisplayLanguage();
            result.put(new JSONObject().put("id", code).put("label", label).put("installed", installed));
        }
        String current = Locale.getDefault().getLanguage();
        return new JSONObject().put("languages", result)
                .put("preferredLanguage", LANGUAGES.contains(current) ? current : "en");
    }

    void download(String language, Consumer<String> progress) throws IOException, InterruptedException {
        checkLanguage(language);
        if (isInstalled()) return;
        File directory = model.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Can’t access the language model folder.");
        if (directory.getUsableSpace() < MODEL_BYTES + 8 * 1024 * 1024L) {
            throw new IOException("Free some space on this phone before downloading the language model.");
        }
        File temporary = File.createTempFile("whisper-", ".part", directory);
        try {
            try {
                downloadModel(temporary, false, progress);
            } catch (IOException primaryFailure) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                progress.accept("Retrying the speech model download…");
                downloadModel(temporary, true, progress);
            }
            Files.move(temporary.toPath(), model.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            temporary.delete();
        }
    }

    private static void downloadModel(File temporary, boolean fallback, Consumer<String> progress)
            throws IOException, InterruptedException {
        MessageDigest digest = sha256();
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            ModelDownload download = new ModelDownload(output, digest, progress);
            if (fallback) {
                for (int index = 0; index < FALLBACK_BYTES.length; index++) {
                    download.part(FALLBACK_URL + index + ".bin", FALLBACK_BYTES[index]);
                }
            } else {
                download.part(MODEL_URL, MODEL_BYTES);
            }
            if (download.received != MODEL_BYTES || !MessageDigest.isEqual(digest.digest(), expectedDigest())) {
                throw new IOException("Couldn’t verify the language download. Please try again.");
            }
            output.getFD().sync();
        }
    }

    private static final class ModelDownload {
        private final FileOutputStream output;
        private final MessageDigest digest;
        private final Consumer<String> progress;
        private final long started = System.nanoTime();
        private final byte[] buffer = new byte[128 * 1024];
        private long received;
        private int lastProgress = -5;

        ModelDownload(FileOutputStream output, MessageDigest digest, Consumer<String> progress) {
            this.output = output;
            this.digest = digest;
            this.progress = progress;
        }

        void part(String url, long expectedBytes) throws IOException, InterruptedException {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            HttpsURLConnection connection = openDownload(url);
            try {
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != expectedBytes) throw new IOException("The language download has an unexpected size.");
                long partBytes = 0;
                try (InputStream input = connection.getInputStream()) {
                    for (int count; (count = input.read(buffer)) != -1;) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                        if (System.nanoTime() - started > 6L * 60 * 1_000_000_000) throw new IOException("The language download timed out.");
                        partBytes += count;
                        if (partBytes > expectedBytes) throw new IOException("The language download is larger than expected.");
                        received += count;
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                        int percent = (int) (received * 100 / MODEL_BYTES);
                        if (percent >= lastProgress + 5 || percent == 100) {
                            progress.accept("Downloading speech model… " + percent + "%");
                            lastProgress = percent;
                        }
                    }
                }
                if (partBytes != expectedBytes) throw new IOException("The language download did not finish. Please try again.");
            } finally {
                connection.disconnect();
            }
        }
    }

    String transcribe(File audio, String language, Consumer<String> progress) throws IOException, InterruptedException {
        checkLanguage(language);
        if (!isInstalled()) throw new IOException("Download the speech model for offline transcription first.");
        progress.accept("Reading the recording…");
        float[] pcm = AudioDecoder.read(audio);
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        progress.accept("Transcribing on this phone…");
        try {
            NativeLibrary.load();
        } catch (LinkageError error) {
            throw new IOException("Offline transcription is unavailable on this Android device.", error);
        }
        byte[] recognized = recognize(model.getAbsolutePath(), language, pcm, Runtime.getRuntime().availableProcessors());
        if (recognized == null) throw new IOException("Couldn’t transcribe this recording. Try a shorter file.");
        String transcript = new String(recognized, StandardCharsets.UTF_8).trim();
        if (transcript.isEmpty()) throw new IOException("No speech was recognized. Check the recording and language.");
        return transcript;
    }

    private boolean isInstalled() {
        return model.isFile() && model.length() == MODEL_BYTES;
    }

    private static HttpsURLConnection openDownload(String address) throws IOException {
        URL url = new URL(address);
        for (int i = 0; i < 6; i++) {
            if (!"https".equals(url.getProtocol())) throw new IOException("The language download was redirected to an insecure location.");
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-cache");
            boolean keep = false;
            try {
                int status = connection.getResponseCode();
                if (status == 200) {
                    keep = true;
                    return connection;
                }
                String location = connection.getHeaderField("Location");
                if (status < 300 || status >= 400 || location == null) {
                    throw new IOException("Couldn’t download the language model. Check your connection and try again.");
                }
                url = new URL(url, location);
            } finally {
                if (!keep) connection.disconnect();
            }
        }
        throw new IOException("Couldn’t reach the language model download.");
    }

    private static void checkLanguage(String language) throws IOException {
        if (!LANGUAGES.contains(language)) throw new IOException("Select a supported spoken language.");
    }

    private static MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    private static byte[] expectedDigest() {
        byte[] bytes = new byte[32];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(MODEL_SHA256.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    private static native byte[] recognize(String modelPath, String language, float[] pcm, int threads);

    private static final class NativeLibrary {
        static { System.loadLibrary("rights_desk_whisper"); }
        static void load() { }
    }
}
