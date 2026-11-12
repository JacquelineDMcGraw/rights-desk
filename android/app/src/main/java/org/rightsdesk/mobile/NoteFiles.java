package org.rightsdesk.mobile;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

final class NoteFiles {
    static final int STATE_LIMIT = 4 * 1024 * 1024;
    private static final long AUDIO_LIMIT = 20 * 1024 * 1024;
    private final AtomicFile state;
    private final File audio;

    NoteFiles(File root) {
        state = new AtomicFile(new File(root, "offline-notes.json"));
        audio = new File(root, "audio");
    }

    JSONObject read() throws IOException, JSONException {
        if (state.getBaseFile().length() > STATE_LIMIT) throw new IOException("The local notes file is too large to open.");
        try {
            return new JSONObject(new String(state.readFully(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException absent) {
            if (state.getBaseFile().exists()) throw absent;
            return new JSONObject();
        }
    }

    void write(JSONObject data) throws IOException {
        byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > STATE_LIMIT) throw new IOException("This device has reached the saved notes limit.");
        FileOutputStream stream = null;
        try {
            stream = state.startWrite();
            stream.write(bytes);
            state.finishWrite(stream);
        } catch (IOException error) {
            state.failWrite(stream);
            throw error;
        }
    }

    JSONObject importAudio(ContentResolver resolver, Uri uri) throws IOException, JSONException, InterruptedException {
        if (!"content".equals(uri.getScheme())) throw new IOException("Choose a recording from Android Files.");
        String name = fileName(resolver, uri);
        if (!name.toLowerCase(Locale.ROOT).matches(".+\\.(m4a|wav|mp3)")) {
            throw new IOException("Choose an M4A, WAV, or MP3 recording.");
        }
        if (!audio.isDirectory() && !audio.mkdirs()) throw new IOException("Can’t access the recording folder.");
        String id = UUID.randomUUID().toString();
        File destination = path(id);
        boolean saved = false;
        try {
            try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(destination)) {
                if (input == null) throw new IOException("Can’t read this recording. Try saving it to Files first.");
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                    total += count;
                    if (total > AUDIO_LIMIT) throw new IOException("Choose a recording up to 20 MB.");
                    output.write(buffer, 0, count);
                }
                if (total == 0) throw new IOException("The recording file is empty.");
                output.getFD().sync();
            }
            AudioDecoder.validate(destination);
            JSONObject result = new JSONObject().put("id", id).put("name", name);
            saved = true;
            return result;
        } finally {
            if (!saved) destination.delete();
        }
    }

    File recording(String id) throws IOException {
        File file = path(id);
        if (!file.isFile()) throw new IOException("This recording is no longer available on this device.");
        return file;
    }

    void deleteDraftAudio(String id) throws IOException, JSONException {
        File file = path(id);
        JSONArray notes = read().optJSONArray("notes");
        if (notes != null) {
            for (int i = 0; i < notes.length(); i++) {
                JSONObject note = notes.optJSONObject(i);
                JSONObject recording = note == null ? null : note.optJSONObject("audio");
                if (recording != null && id.equals(recording.optString("id"))) {
                    throw new IOException("This recording is still attached to a saved note.");
                }
            }
        }
        if (file.exists() && !file.delete()) throw new IOException("Couldn’t remove the discarded recording.");
    }

    private File path(String id) throws IOException {
        if (!id.matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) throw new IOException("The recording ID is invalid.");
        return new File(audio, id + ".audio");
    }

    private static String fileName(ContentResolver resolver, Uri uri) throws IOException {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) {
                    String safe = cursor.getString(index).replaceAll("[\\p{Cc}\\p{Cf}/\\\\]", " ").trim();
                    if (safe.length() > 180) return safe.substring(0, 160) + safe.substring(safe.length() - 8);
                    if (!safe.isEmpty()) return safe;
                }
            }
        }
        throw new IOException("Can’t find the recording’s name. Try saving it to Files first.");
    }
}
