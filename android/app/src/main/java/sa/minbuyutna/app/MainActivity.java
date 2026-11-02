package sa.minbuyutna.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_IMAGES = 101, SAVE_FILE = 102, LOCATION = 103;
    private static final int MAX_FILE = 10 * 1024 * 1024;
    private static final int BRAND = 0xff673746, PAPER = 0xfffaf8f5;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView web;
    private ProgressBar progress;
    private LinearLayout offline;
    private TextView connectionLabel;
    private TextView explanation;
    private String origin;
    private SharedPreferences preferences;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private WebMessagePort nativePort;
    private ByteArrayOutputStream transfer;
    private String transferId, transferName, transferMime;
    private int transferSize;
    private byte[] pendingFile;
    private String checkedSession = "";
    private boolean downloadBusy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        preferences = getSharedPreferences("platform", MODE_PRIVATE);
        origin = Platform.origin(this);
        // Drivers work in the native screens; the website stays for customers, families and admins.
        boolean stayWeb = getIntent().getBooleanExtra(DriverActivity.EXTRA_STAY_WEB, false);
        if (!stayWeb && DriverLaunch.hasSession(this)) {
            openDriver();
            return;
        }
        // Opened on purpose from the driver screens: only a new sign-in should switch back.
        if (stayWeb) {
            String current = DriverLaunch.sessionFromCookies(CookieManager.getInstance().getCookie(origin));
            if (current != null) checkedSession = current;
        }
        makeLayout();
        configureWeb();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
        }
        String path = getIntent().getStringExtra(DriverActivity.EXTRA_PATH);
        boolean known = "/register".equals(path) || "/forgot-password".equals(path) || "/login".equals(path);
        if (state == null || web.restoreState(state) == null) web.loadUrl(origin + (known ? path : "/"));
    }

    private void openDriver() {
        startActivity(new Intent(this, DriverActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    /** After a sign-in on the website, a driver account moves to the native driver screens. */
    private void detectDriver() {
        String token = DriverLaunch.sessionFromCookies(CookieManager.getInstance().getCookie(origin));
        if (token == null || token.equals(checkedSession)) return;
        checkedSession = token;
        final String base = origin;
        io.execute(() -> {
            String[] account = DriverLaunch.account(base, token);
            if (account == null || !"driver".equals(account[0])) return;
            runOnUiThread(() -> {
                if (isFinishing() || !base.equals(origin)) return;
                DriverLaunch.remember(this, base, token, account[1]);
                openDriver();
            });
        });
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }

    private Button button(String text, Runnable action) {
        Button result = new Button(this);
        result.setText(text);
        result.setTextColor(BRAND);
        result.setAllCaps(false);
        result.setTextSize(13);
        result.setMinWidth(0);
        result.setMinimumWidth(0);
        result.setOnClickListener(v -> action.run());
        return result;
    }

    private void makeLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), 0, dp(8), 0);
        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(BRAND);
        title.setTextSize(21);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.addView(button("الرئيسية", () -> web.loadUrl(origin + "/")));
        toolbar.addView(button("تحديث", () -> web.reload()));
        Button menu = button("المزيد", () -> {});
        menu.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, menu);
            popup.getMenu().add("دخول السائقين").setOnMenuItemClickListener(item -> { startActivity(new Intent(this, DriverActivity.class)); return true; });
            if (BuildConfig.CUSTOM_ORIGIN) popup.getMenu().add("رابط المنصة").setOnMenuItemClickListener(item -> { showConnection(); return true; });
            popup.getMenu().add("طباعة الصفحة أو حفظ PDF").setOnMenuItemClickListener(item -> { printPage(); return true; });
            popup.show();
        });
        toolbar.addView(menu);
        root.addView(toolbar);
        connectionLabel = new TextView(this);
        connectionLabel.setGravity(Gravity.CENTER);
        connectionLabel.setTextColor(BRAND);
        connectionLabel.setTextSize(11);
        connectionLabel.setPadding(dp(8), dp(3), dp(8), dp(5));
        root.addView(connectionLabel);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        FrameLayout content = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(PAPER);
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setPadding(dp(28), dp(20), dp(28), dp(20));
        offline.setBackgroundColor(PAPER);
        TextView errorTitle = new TextView(this);
        errorTitle.setText("تعذر الاتصال بالمنصة");
        errorTitle.setTextColor(BRAND);
        errorTitle.setTextSize(24);
        errorTitle.setGravity(Gravity.CENTER);
        offline.addView(errorTitle);
        explanation = new TextView(this);
        explanation.setGravity(Gravity.CENTER);
        explanation.setTextColor(Color.DKGRAY);
        explanation.setTextSize(16);
        explanation.setPadding(0, dp(20), 0, dp(20));
        offline.addView(explanation);
        offline.addView(button("إعادة المحاولة", () -> web.loadUrl(origin + "/")));
        if (BuildConfig.CUSTOM_ORIGIN) offline.addView(button("رابط المنصة", this::showConnection));
        offline.setVisibility(View.GONE);
        content.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        refreshLabel();
    }

    private void refreshLabel() {
        boolean local = origin.startsWith("http:");
        connectionLabel.setVisibility(BuildConfig.CUSTOM_ORIGIN ? View.VISIBLE : View.GONE);
        connectionLabel.setText(local
                ? "نسخة محلية تجريبية • تتطلب اتصال USB بالكمبيوتر" : "متصل بمنصتك • " + Uri.parse(origin).getHost());
        explanation.setText(local
                ? "في النسخة المحلية: شغّل المنصة على الكمبيوتر، ووصل الهاتف عبر USB ثم شغّل سكريبت ربط أندرويد.\n\nللاتصال بالمنصة المستضافة أدخل رابطها الآمن من «رابط المنصة»."
                : "تحقق من اتصال الهاتف بالإنترنت ثم أعد المحاولة. الحسابات والطلبات تحتاج اتصالًا بالخادم."
                        + (BuildConfig.CUSTOM_ORIGIN ? "\n\nلتغيير الخادم استخدم «رابط المنصة»." : ""));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWeb() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " MinBuyutnaAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (EndpointPolicy.sameOrigin(origin, request.getUrl().toString())) return false;
                if (request.isForMainFrame()) openExternal(request.getUrl().toString());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                closeChannel();
                offline.setVisibility(View.GONE);
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                if (EndpointPolicy.sameOrigin(origin, url) && offline.getVisibility() != View.VISIBLE) {
                    installChannel();
                    detectDriver();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showOffline();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!EndpointPolicy.sameOrigin(origin, web.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent chooser = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                chooser.setType("image/*");
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                chooser.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(chooser, PICK_IMAGES); }
                catch (ActivityNotFoundException error) { callback.onReceiveValue(null); fileCallback = null; toast("لا يوجد تطبيق لاختيار الصور"); }
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String requestedOrigin, GeolocationPermissions.Callback callback) {
                if (!EndpointPolicy.sameOrigin(origin, requestedOrigin)) { callback.invoke(requestedOrigin, false, false); return; }
                if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
                new AlertDialog.Builder(MainActivity.this).setTitle("استخدام موقعك")
                        .setMessage("هل تسمح للمنصة باستخدام موقعك لتحديد عنوانك؟ يمكنك إدخال العنوان يدويًا أيضًا.")
                        .setNegativeButton("ليس الآن", (d, which) -> callback.invoke(requestedOrigin, false, false))
                        .setOnCancelListener(d -> callback.invoke(requestedOrigin, false, false))
                        .setPositiveButton("السماح", (d, which) -> {
                            if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                                callback.invoke(requestedOrigin, true, false);
                            } else {
                                locationOrigin = requestedOrigin;
                                locationCallback = callback;
                                requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, LOCATION);
                            }
                        }).show();
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url, disposition, mime));
    }

    private void showOffline() { progress.setVisibility(View.GONE); offline.setVisibility(View.VISIBLE); }

    private void showConnection() {
        if (!BuildConfig.CUSTOM_ORIGIN) return;
        EditText field = new EditText(this);
        field.setText(origin);
        field.setSingleLine(true);
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        field.setTextDirection(View.TEXT_DIRECTION_LTR);
        field.setPadding(dp(20), dp(16), dp(20), dp(16));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("رابط المنصة")
                .setMessage("استخدم http://localhost:3000 للربط المحلي عبر USB، أو رابط HTTPS لاستضافة منصتك. تغيير الرابط يغلق جلسة التطبيق الحالية.")
                .setView(field).setNegativeButton("إلغاء", null).setPositiveButton("اتصال", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            final String next;
            try { next = EndpointPolicy.normalize(field.getText().toString(), BuildConfig.DEBUG); }
            catch (IllegalArgumentException error) { field.setError(error.getMessage()); return; }
            if (downloadBusy) { toast("أكمل حفظ الملف أولًا"); return; }
            closeChannel();
            web.stopLoading();
            android.webkit.WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(removed -> {
                CookieManager.getInstance().flush();
                origin = next;
                preferences.edit().putString("origin", origin).apply();
                DriverLaunch.forget(this);
                refreshLabel();
                web.clearHistory();
                web.clearCache(true);
                web.loadUrl(origin + "/");
            });
            dialog.dismiss();
        }));
        dialog.show();
    }

    private void openExternal(String url) {
        if (!EndpointPolicy.externalAllowed(url)) { toast("هذا النوع من الروابط غير مدعوم"); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { toast("لا يوجد تطبيق مناسب لفتح الرابط"); }
    }

    private void installChannel() {
        closeChannel();
        try (InputStream source = getAssets().open("native-bridge.js")) {
            ByteArrayOutputStream scriptBytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = source.read(buffer)) != -1) scriptBytes.write(buffer, 0, count);
            String script = new String(scriptBytes.toByteArray(), StandardCharsets.UTF_8);
            web.evaluateJavascript(script, ignored -> {
                if (!EndpointPolicy.sameOrigin(origin, web.getUrl())) return;
                WebMessagePort[] ports = web.createWebMessageChannel();
                nativePort = ports[0];
                nativePort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                    @Override public void onMessage(WebMessagePort port, WebMessage message) {
                        if (EndpointPolicy.sameOrigin(origin, web.getUrl())) receiveMessage(message.getData());
                    }
                });
                web.postWebMessage(new WebMessage("min-buyutna-native", new WebMessagePort[]{ports[1]}), Uri.parse(origin));
            });
        } catch (Exception error) { toast("تعذر تجهيز تنزيل الملفات"); }
    }

    private void closeChannel() {
        if (nativePort != null) { nativePort.close(); nativePort = null; }
        transfer = null;
        transferId = null;
        if (pendingFile == null) downloadBusy = false;
    }

    private void receiveMessage(String raw) {
        try {
            if (raw == null || raw.length() > 100000) throw new IllegalArgumentException();
            JSONObject data = new JSONObject(raw);
            String type = data.getString("type");
            if (type.equals("print")) { printPage(); return; }
            if (type.equals("error")) { toast("تعذر تجهيز الملف للتنزيل"); return; }
            if (type.equals("start")) {
                if (downloadBusy) { toast("أكمل حفظ الملف الحالي أولًا"); return; }
                transferSize = data.getInt("size");
                if (transferSize < 0 || transferSize > MAX_FILE) throw new IllegalArgumentException();
                transferName = safeName(data.getString("name"));
                transferMime = safeMime(data.getString("mime"));
                transferId = data.getString("id");
                transfer = new ByteArrayOutputStream();
                downloadBusy = true;
                return;
            }
            if (transfer == null || !data.getString("id").equals(transferId)) return;
            if (type.equals("chunk")) {
                byte[] chunk = Base64.decode(data.getString("data"), Base64.DEFAULT);
                if (transfer.size() + chunk.length > transferSize) throw new IllegalArgumentException();
                transfer.write(chunk);
            } else if (type.equals("finish")) {
                if (transfer.size() != transferSize) throw new IllegalArgumentException();
                byte[] bytes = transfer.toByteArray();
                transfer = null;
                askSave(bytes, transferName, transferMime);
            }
        } catch (Exception error) {
            transfer = null;
            if (pendingFile == null) downloadBusy = false;
            toast("الملف غير مدعوم أو يتجاوز 10 ميجابايت");
        }
    }

    private String safeName(String name) {
        String cleaned = name.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "min-buyutna-download";
        return cleaned.substring(0, Math.min(120, cleaned.length()));
    }

    private String safeMime(String mime) {
        String normalized = mime.split(";", 2)[0].toLowerCase(Locale.ROOT).trim();
        if (normalized.equals("application/json") || normalized.equals("text/csv") || normalized.equals("text/plain")
                || normalized.equals("application/pdf") || normalized.equals("image/webp")
                || normalized.equals("image/jpeg") || normalized.equals("image/png")) return normalized;
        throw new IllegalArgumentException("Unsupported file type");
    }

    private void download(String url, String disposition, String mime) {
        if (!EndpointPolicy.sameOrigin(origin, url)) { toast("التنزيل متاح من منصتك فقط"); return; }
        if (downloadBusy) { toast("أكمل حفظ الملف الحالي أولًا"); return; }
        downloadBusy = true;
        String cookie = CookieManager.getInstance().getCookie(url);
        String activeOrigin = origin;
        io.execute(() -> {
            try {
                String current = url;
                for (int redirects = 0; redirects < 4; redirects++) {
                    if (!EndpointPolicy.sameOrigin(activeOrigin, current)) throw new IllegalArgumentException();
                    HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(20000);
                    connection.setInstanceFollowRedirects(false);
                    if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                    try {
                        int status = connection.getResponseCode();
                        if (status >= 300 && status < 400) {
                            current = new URL(new URL(current), connection.getHeaderField("Location")).toString();
                            continue;
                        }
                        if (status != 200 || connection.getContentLengthLong() > MAX_FILE) throw new IllegalArgumentException();
                        String contentType = connection.getContentType();
                        String fileMime = safeMime(contentType == null ? mime : contentType);
                        String header = connection.getHeaderField("Content-Disposition");
                        String name = safeName(URLUtil.guessFileName(current, header == null ? disposition : header, fileMime));
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        try (InputStream stream = connection.getInputStream()) {
                            byte[] chunk = new byte[32768];
                            int count;
                            while ((count = stream.read(chunk)) != -1) {
                                if (bytes.size() + count > MAX_FILE) throw new IllegalArgumentException();
                                bytes.write(chunk, 0, count);
                            }
                        }
                        runOnUiThread(() -> askSave(bytes.toByteArray(), name, fileMime));
                        return;
                    } finally { connection.disconnect(); }
                }
                throw new IllegalArgumentException();
            } catch (Exception error) {
                runOnUiThread(() -> { downloadBusy = false; toast("تعذر تنزيل الملف؛ تحقق من الاتصال وصلاحية الرابط"); });
            }
        });
    }

    private void askSave(byte[] bytes, String name, String mime) {
        if (isFinishing() || isDestroyed()) return;
        pendingFile = bytes;
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        save.addCategory(Intent.CATEGORY_OPENABLE);
        save.setType(mime);
        save.putExtra(Intent.EXTRA_TITLE, name);
        try { startActivityForResult(save, SAVE_FILE); }
        catch (ActivityNotFoundException error) { pendingFile = null; downloadBusy = false; toast("لا يوجد تطبيق لحفظ الملفات"); }
    }

    private void printPage() {
        if (!EndpointPolicy.sameOrigin(origin, web.getUrl())) return;
        PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
        manager.print(getString(R.string.app_name), web.createPrintDocumentAdapter("min-buyutna-receipt"),
                new PrintAttributes.Builder().build());
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_IMAGES && fileCallback != null) {
            ArrayList<Uri> accepted = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < Math.min(8, data.getClipData().getItemCount()); i++) validateImage(data.getClipData().getItemAt(i).getUri(), accepted);
                } else if (data.getData() != null) validateImage(data.getData(), accepted);
            }
            fileCallback.onReceiveValue(accepted.isEmpty() ? null : accepted.toArray(new Uri[0]));
            fileCallback = null;
        }
        if (request == SAVE_FILE) {
            byte[] bytes = pendingFile;
            pendingFile = null;
            if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) { downloadBusy = false; return; }
            Uri destination = data.getData();
            io.execute(() -> {
                boolean saved = false;
                try (OutputStream stream = getContentResolver().openOutputStream(destination, "w")) {
                    if (stream == null) throw new IllegalArgumentException();
                    stream.write(bytes);
                    saved = true;
                } catch (Exception ignored) { /* Report a readable failure without logging private paths. */ }
                boolean success = saved;
                runOnUiThread(() -> { downloadBusy = false; toast(success ? "تم حفظ الملف" : "تعذر حفظ الملف"); });
            });
        }
    }

    private void validateImage(Uri uri, ArrayList<Uri> accepted) {
        if (!"content".equals(uri.getScheme())) return;
        try {
            String mime = getContentResolver().getType(uri);
            if (mime == null || !mime.startsWith("image/")) return;
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0) > 6 * 1024 * 1024) {
                    toast("اختر صورة لا تتجاوز 6 ميجابايت");
                    return;
                }
            }
            accepted.add(uri);
        } catch (Exception error) { toast("تعذر قراءة الصورة المختارة"); }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == LOCATION && locationCallback != null) {
            boolean allowed = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            locationCallback.invoke(locationOrigin, allowed, false);
            locationCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); if (web != null) web.saveState(state); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    private void goBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    @SuppressWarnings("deprecation") @Override public void onBackPressed() { goBack(); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @Override protected void onDestroy() {
        closeChannel();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        io.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
