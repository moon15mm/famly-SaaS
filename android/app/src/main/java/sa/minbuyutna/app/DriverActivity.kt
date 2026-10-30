package sa.minbuyutna.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Native screens for drivers; other roles keep using the platform website in [MainActivity]. */
class DriverActivity : ComponentActivity() {
    private val model: DriverModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        DriverNotifications.channels(this)
        intent?.getStringExtra(EXTRA_TAB)?.let(model::open)
        setContent { DriverApp(model, ::openWeb) }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    model.refresh()
                    delay(15_000)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        model.reloadSession()
        intent.getStringExtra(EXTRA_TAB)?.let(model::open)
    }

    private fun openWeb(path: String) {
        startActivity(Intent(this, MainActivity::class.java).putExtra(EXTRA_PATH, path).putExtra(EXTRA_STAY_WEB, true))
    }

    companion object {
        const val EXTRA_TAB = "driver_tab"
        const val EXTRA_PATH = "web_path"
        const val EXTRA_STAY_WEB = "stay_web"
    }
}

enum class Tab(val key: String, val title: String) {
    HOME("home", "الدوام"),
    OFFERS("offers", "العروض"),
    TRIP("trip", "الرحلة"),
    HISTORY("history", "السجل"),
    MORE("more", "المزيد"),
}

class DriverModel(app: Application) : AndroidViewModel(app) {
    private val session = DriverSession(app)
    var origin = Platform.origin(app)
        private set
    var signedIn by mutableStateOf(session.token(origin) != null)
        private set
    var driverName by mutableStateOf(session.name())
        private set
    var tab by mutableStateOf(Tab.HOME)
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
    var summary by mutableStateOf<Summary?>(null)
        private set
    var offers by mutableStateOf<List<Offer>>(emptyList())
        private set
    var trip by mutableStateOf<Trip?>(null)
        private set
    var history by mutableStateOf<List<PastTrip>>(emptyList())
        private set
    var notices by mutableStateOf<List<Notice>>(emptyList())
        private set
    var documents by mutableStateOf<List<DriverDocument>>(emptyList())
        private set

    private fun api() = DriverApi(origin) { session.token(origin) }

    /** Runs a request; [action] marks user actions so buttons stay disabled until they finish. */
    private fun call(action: Boolean = true, block: suspend DriverApi.() -> Unit) {
        viewModelScope.launch {
            if (action) busy = true
            try {
                api().block()
            } catch (error: ApiException) {
                if (error.status == 401 && signedIn) expire("انتهت الجلسة؛ يلزم تسجيل الدخول من جديد") else message = error.message
            } finally {
                if (action) busy = false
            }
        }
    }

    fun open(key: String) {
        tab = Tab.entries.firstOrNull { it.key == key } ?: Tab.HOME
        refresh()
    }

    fun reloadSession() {
        origin = Platform.origin(getApplication())
        signedIn = session.token(origin) != null
        driverName = session.name()
        refresh()
    }

    fun refresh() {
        if (!signedIn) return
        call(action = false) {
            val current = summary()
            summary = current
            driverName = current.name
            offers = if (current.verified && current.available && current.activeTripId == null) offers() else emptyList()
            trip = current.activeTripId?.let { trip(it) }
            when (tab) {
                Tab.HISTORY -> history = history()
                Tab.MORE -> {
                    notices = notices()
                    documents = documents()
                }
                else -> Unit
            }
            syncShift(current)
        }
    }

    /** Keeps the shift service in step with the server, e.g. after availability changed on the website. */
    private fun syncShift(current: Summary) {
        val app = getApplication<Application>()
        if (current.available || current.activeTripId != null) {
            if (DriverPermissions.location(app)) ShiftService.start(app)
        } else {
            ShiftService.stop(app)
        }
    }

    fun login(email: String, password: String) = call {
        val token = login(email.trim(), password)
        val account = DriverApi(origin) { token }.me()
        if (account.role != "driver") {
            try {
                DriverApi(origin) { token }.logout()
            } catch (error: ApiException) {
                // The session expires on its own.
            }
            message = "هذا الحساب ليس حساب سائق؛ يُستخدم من المتجر"
            return@call
        }
        session.save(origin, token, account.name)
        driverName = account.name
        signedIn = true
        tab = Tab.HOME
        refresh()
    }

    fun setAvailable(on: Boolean) = call {
        availability(on)
        message = if (on) "بدأ الدوام؛ ستصل تنبيهات العروض" else "انتهى الدوام"
        refresh()
    }

    fun accept(id: String) = call {
        accept(id)
        tab = Tab.TRIP
        message = "قُبل المشوار؛ التفاصيل في تبويب الرحلة"
        refresh()
    }

    fun reject(id: String) = call {
        reject(id)
        refresh()
    }

    fun advance(code: String) {
        val current = trip ?: return
        val step = Driving.nextStep(current.status) ?: return
        call {
            advance(current.id, step.next, code.trim())
            message = if (step.next == "delivered") "تم تسليم الطلب، أحسنت" else Driving.status(step.next)
            if (step.next == "delivered") tab = Tab.HOME
            refresh()
        }
    }

    fun report(reason: String) {
        val current = trip ?: return
        call {
            issue(current.id, reason.trim())
            message = "سُجّل التعثر وأُبلغت الإدارة"
            refresh()
        }
    }

    fun loadHistory() = call(action = false) { history = history() }

    fun loadMore() = call(action = false) {
        notices = notices()
        documents = documents()
    }

    fun markRead() = call {
        markRead()
        notices = notices()
    }

    fun upload(uri: Uri, kind: String) = call {
        val resolver = getApplication<Application>().contentResolver
        val mime = resolver.getType(uri).orEmpty()
        if (!mime.startsWith("image/")) throw ApiException(0, "اختر صورة واضحة للمستند")
        val bytes = withContext(Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } }
            ?: throw ApiException(0, "تعذر قراءة الصورة")
        if (bytes.size > 5 * 1024 * 1024) throw ApiException(0, "حجم الصورة يتجاوز 5 ميجابايت")
        val extension = when (mime) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            else -> "jpg"
        }
        upload(kind, DriverApi.Upload("document.$extension", mime, bytes))
        message = "رُفع المستند للمراجعة"
        documents = documents()
    }

    fun logout() {
        viewModelScope.launch {
            busy = true
            try {
                val current = summary
                if (current?.available == true && current.activeTripId == null) api().availability(false)
                api().logout()
            } catch (error: ApiException) {
                // Local sign-out still happens.
            }
            busy = false
            expire(null)
        }
    }

    private fun expire(text: String?) {
        session.clear()
        ShiftService.stop(getApplication())
        // The website shares the cookie store; clearing it keeps both screens signed out.
        CookieManager.getInstance().removeAllCookies(null)
        signedIn = false
        summary = null
        offers = emptyList()
        trip = null
        history = emptyList()
        notices = emptyList()
        documents = emptyList()
        tab = Tab.HOME
        message = text
    }
}
