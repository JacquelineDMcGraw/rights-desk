package org.rightsdesk.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PersistableBundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String HOME_PATH = "/assets/mobile/index.html";
    private static final String PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; "
            + "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    private static final int IMPORT_AUDIO = 81;
    private static final int BACKGROUND = Color.rgb(18, 17, 25);

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private WebView webView;
    private NoteFiles files;
    private OfflineSpeech speech;
    private String pendingImport;
    private MediaPlayer player;
    private String playingId;
    private String pendingPlay;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        files = new NoteFiles(getNoBackupFilesDir());
        speech = new OfflineSpeech(getNoBackupFilesDir());

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        setSystemInsets(root);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView error = new TextView(this);
            error.setText("Update Android System WebView or Chrome to open Rights Desk.");
            error.setTextSize(18);
            error.setTextColor(Color.WHITE);
            error.setPadding(24, 24, 24, 24);
            root.addView(error);
            return;
        }

        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        configureWebView();
        webView.loadUrl(ORIGIN + HOME_PATH);
    }

    private void setSystemInsets(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        }
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (local(url) && "GET".equals(request.getMethod())) {
                    WebResourceResponse response = assets.shouldInterceptRequest(url);
                    if (response != null) {
                        if (HOME_PATH.equals(url.getPath())) {
                            response.setResponseHeaders(Collections.singletonMap("Content-Security-Policy", PAGE_POLICY));
                        }
                        return response;
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (request.isForMainFrame() && local(url) && HOME_PATH.equals(url.getPath())) return false;
                if (request.isForMainFrame() && request.hasGesture() && websiteUrl().equals(url.toString())) {
                    openWebsite(null);
                }
                return true;
            }
        });

        WebViewCompat.addWebMessageListener(webView, "RightsDeskBridge", Collections.singleton(ORIGIN),
                (view, message, source, mainFrame, reply) -> {
                    if (mainFrame && local(source)) receive(message.getData());
                });
    }

    private static boolean local(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getHost())
                && url.getPort() == -1 && url.getUserInfo() == null;
    }

    private void receive(String message) {
        if (message == null || message.length() > NoteFiles.STATE_LIMIT + 4096) return;
        JSONObject request;
        try { request = new JSONObject(message); }
        catch (JSONException error) { return; }
        String id = request.optString("id");
        if (id.isEmpty() || id.length() > 120) return;
        String action = request.optString("action");
        JSONObject data = request.optJSONObject("data");
        if (data == null) data = new JSONObject();
        switch (action) {
            case "getAppInfo" -> success(id, object("platform", "android", "websiteUrl", websiteUrl(),
                    "languageDownloadBytes", OfflineSpeech.MODEL_BYTES, "maxTranscriptionMinutes", AudioDecoder.MAX_MINUTES));
            case "openWebsite" -> openWebsite(id);
            case "copyText" -> copyText(id, data.optString("text"));
            case "importAudio" -> chooseAudio(id);
            case "playAudio" -> playAudio(id, data.optString("audioId"));
            case "stopAudio" -> {
                if (data.optString("audioId").isEmpty() || data.optString("audioId").equals(playingId)) releasePlayer();
                success(id, new JSONObject());
            }
            default -> {
                JSONObject input = data;
                background(id, () -> switch (action) {
                    case "readState" -> files.read();
                    case "writeState" -> {
                        files.write(input);
                        yield new JSONObject();
                    }
                    case "getLanguages" -> speech.languages();
                    case "downloadLanguage" -> {
                        speech.download(input.optString("languageId"), status -> progress(id, status));
                        yield new JSONObject();
                    }
                    case "transcribe" -> object("transcript", speech.transcribe(files.recording(input.optString("audioId")),
                            input.optString("languageId"), status -> progress(id, status)));
                    case "deleteAudio" -> {
                        files.deleteDraftAudio(input.optString("audioId"));
                        yield new JSONObject();
                    }
                    default -> throw new IOException("This action isn’t available in Rights Desk.");
                });
            }
        }
    }

    private void chooseAudio(String id) {
        if (pendingImport != null) {
            failure(id, "Finish choosing the current recording first.");
            return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");
        pendingImport = id;
        try { startActivityForResult(picker, IMPORT_AUDIO); }
        catch (ActivityNotFoundException error) {
            pendingImport = null;
            failure(id, "Can’t open Android Files on this device.");
        }
    }

    @Override protected void onActivityResult(int requestCode, int result, Intent data) {
        super.onActivityResult(requestCode, result, data);
        if (requestCode != IMPORT_AUDIO || pendingImport == null) return;
        String id = pendingImport;
        pendingImport = null;
        Uri uri = data == null ? null : data.getData();
        if (result != RESULT_OK || uri == null) success(id, object("cancelled", true));
        else background(id, () -> files.importAudio(getContentResolver(), uri));
    }

    private void playAudio(String id, String audioId) {
        releasePlayer();
        MediaPlayer next = new MediaPlayer();
        player = next;
        playingId = audioId;
        pendingPlay = id;
        try {
            next.setAudioAttributes(new AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setUsage(AudioAttributes.USAGE_MEDIA).build());
            next.setDataSource(files.recording(audioId).getAbsolutePath());
            next.setOnPreparedListener(prepared -> {
                if (player != prepared) return;
                pendingPlay = null;
                try {
                    prepared.start();
                    success(id, new JSONObject());
                } catch (IllegalStateException error) {
                    releasePlayer();
                    failure(id, "Couldn’t play this recording.");
                }
            });
            next.setOnCompletionListener(finished -> {
                if (player != finished) return;
                releasePlayer();
                audioEnded(audioId);
            });
            next.setOnErrorListener((failed, code, detail) -> {
                if (player == failed) {
                    String request = pendingPlay;
                    pendingPlay = null;
                    releasePlayer();
                    if (request != null) failure(request, "Couldn’t play this recording.");
                    else audioEnded(audioId);
                }
                return true;
            });
            next.prepareAsync();
        } catch (IOException | IllegalStateException | IllegalArgumentException error) {
            pendingPlay = null;
            releasePlayer();
            failure(id, "Couldn’t play this recording.");
        }
    }

    private void releasePlayer() {
        if (player != null) player.release();
        player = null;
        playingId = null;
        if (pendingPlay != null) failure(pendingPlay, "Playback stopped.");
        pendingPlay = null;
    }

    private static String websiteUrl() {
        return BuildConfig.RIGHTS_DESK_WEBSITE_URL;
    }

    private void openWebsite(String id) {
        if (websiteUrl().isEmpty()) {
            if (id != null) failure(id, "The Rights Desk website isn’t configured for this build.");
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(websiteUrl())).addCategory(Intent.CATEGORY_BROWSABLE));
            if (id != null) success(id, new JSONObject());
        } catch (ActivityNotFoundException error) {
            if (id != null) failure(id, "No browser is available on this device.");
        }
    }

    private void copyText(String id, String text) {
        if (text.isEmpty() || text.length() > 8_000) {
            failure(id, "Choose up to 8,000 characters to copy.");
            return;
        }
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard == null) {
            failure(id, "The clipboard isn’t available on this device.");
            return;
        }
        ClipData clip = ClipData.newPlainText("Rights Desk transcript", text);
        PersistableBundle extras = new PersistableBundle();
        extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
        clip.getDescription().setExtras(extras);
        clipboard.setPrimaryClip(clip);
        success(id, new JSONObject());
    }

    private void background(String id, Work task) {
        worker.execute(() -> {
            try { success(id, task.run()); }
            catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                failure(id, "This action was interrupted. Please try again.");
            } catch (IOException error) {
                String detail = error.getClass() == IOException.class ? error.getMessage() : null;
                failure(id, detail != null ? detail : "Can’t access this recording or download right now. Please try again.");
            } catch (Exception error) {
                failure(id, "Couldn’t finish this action. Please try again.");
            }
        });
    }

    private static JSONObject object(Object... fields) {
        JSONObject value = new JSONObject();
        try {
            for (int i = 0; i < fields.length; i += 2) value.put((String) fields[i], fields[i + 1]);
        } catch (JSONException error) { throw new IllegalArgumentException(error); }
        return value;
    }

    private void success(String id, JSONObject data) { respond(object("id", id, "ok", true, "data", data)); }
    private void failure(String id, String error) { respond(object("id", id, "ok", false, "error", error)); }
    private void progress(String id, String message) { respond(object("id", id, "progress", message)); }

    private void respond(JSONObject message) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript("window.rightsDeskNativeReceive?.(" + message + ")", null);
        });
    }

    private void audioEnded(String audioId) {
        if (webView != null) webView.evaluateJavascript("window.rightsDeskNativeAudioEnded?.(" + JSONObject.quote(audioId) + ")", null);
    }

    @Override protected void onStop() {
        String previous = playingId;
        releasePlayer();
        if (previous != null) audioEnded(previous);
        super.onStop();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @FunctionalInterface private interface Work { JSONObject run() throws Exception; }
}
