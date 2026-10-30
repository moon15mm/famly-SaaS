package sa.minbuyutna.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlin.math.max

private val Plum = Color(0xFF673746)
private val Paper = Color(0xFFFAF8F5)
private val Leaf = Color(0xFF2E6B4F)
private val Tajawal = FontFamily(Font(R.font.tajawal_regular, FontWeight.Normal), Font(R.font.tajawal_bold, FontWeight.Bold))

object DriverPermissions {
    fun location(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun shift(): Array<String> {
        val wanted = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) wanted += Manifest.permission.POST_NOTIFICATIONS
        return wanted.toTypedArray()
    }

    fun missing(context: Context): Boolean =
        shift().any { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
}

private fun Typography.withTajawal() = Typography(
    displayLarge = displayLarge.copy(fontFamily = Tajawal),
    displayMedium = displayMedium.copy(fontFamily = Tajawal),
    displaySmall = displaySmall.copy(fontFamily = Tajawal),
    headlineLarge = headlineLarge.copy(fontFamily = Tajawal),
    headlineMedium = headlineMedium.copy(fontFamily = Tajawal),
    headlineSmall = headlineSmall.copy(fontFamily = Tajawal),
    titleLarge = titleLarge.copy(fontFamily = Tajawal),
    titleMedium = titleMedium.copy(fontFamily = Tajawal),
    titleSmall = titleSmall.copy(fontFamily = Tajawal),
    bodyLarge = bodyLarge.copy(fontFamily = Tajawal),
    bodyMedium = bodyMedium.copy(fontFamily = Tajawal),
    bodySmall = bodySmall.copy(fontFamily = Tajawal),
    labelLarge = labelLarge.copy(fontFamily = Tajawal),
    labelMedium = labelMedium.copy(fontFamily = Tajawal),
    labelSmall = labelSmall.copy(fontFamily = Tajawal),
)

@Composable
private fun DriverTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Plum,
            onPrimary = Color.White,
            primaryContainer = Color(0xFFF2E4E8),
            onPrimaryContainer = Plum,
            secondary = Leaf,
            onSecondary = Color.White,
            background = Paper,
            surface = Color.White,
            surfaceVariant = Color(0xFFF1ECE7),
        ),
        typography = Typography().withTajawal(),
    ) {
        // The interface is Arabic even on phones set to another language.
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl, content = content)
    }
}

@Composable
fun DriverApp(model: DriverModel, openWeb: (String) -> Unit) {
    DriverTheme {
        val snackbar = remember { SnackbarHostState() }
        val message = model.message
        LaunchedEffect(message) {
            if (message != null) {
                snackbar.showSnackbar(message)
                model.message = null
            }
        }
        if (model.signedIn) MainScreen(model, openWeb, snackbar) else LoginScreen(model, openWeb, snackbar)
    }
}

@Composable
private fun LoginScreen(model: DriverModel, openWeb: (String) -> Unit, snackbar: SnackbarHostState) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val ltr = MaterialTheme.typography.bodyLarge.copy(textDirection = TextDirection.Ltr)
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = MaterialTheme.colorScheme.background) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("من بيوتنا", style = MaterialTheme.typography.headlineMedium, color = Plum, fontWeight = FontWeight.Bold)
            Text("دخول السائقين", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("العروض والرحلات ومشاركة الموقع ورموز الإثبات في مكان واحد.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("البريد الإلكتروني") },
                singleLine = true,
                textStyle = ltr,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("كلمة المرور") },
                singleLine = true,
                textStyle = ltr,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { model.login(email, password) },
                enabled = !model.busy && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (model.busy) "جارٍ الدخول…" else "دخول") }
            TextButton(onClick = { openWeb("/forgot-password") }) { Text("نسيت كلمة المرور؟") }
            TextButton(onClick = { openWeb("/register") }) { Text("تسجيل سائق جديد") }
            TextButton(onClick = { openWeb("/") }) { Text("العودة إلى المتجر") }
        }
    }
}

private fun Tab.icon(): ImageVector = when (this) {
    Tab.HOME -> Icons.Filled.Home
    Tab.OFFERS -> Icons.Filled.Notifications
    Tab.TRIP -> Icons.Filled.Place
    Tab.HISTORY -> Icons.Filled.DateRange
    Tab.MORE -> Icons.Filled.Menu
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(model: DriverModel, openWeb: (String) -> Unit, snackbar: SnackbarHostState) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(model.tab.title, fontWeight = FontWeight.Bold) },
                actions = { IconButton(onClick = model::refresh) { Icon(Icons.Filled.Refresh, contentDescription = "تحديث") } },
            )
        },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = model.tab == tab,
                        onClick = { model.open(tab.key) },
                        icon = {
                            BadgedBox(badge = { if (tab == Tab.OFFERS && model.offers.isNotEmpty()) Badge { Text("${model.offers.size}") } }) {
                                Icon(tab.icon(), contentDescription = null)
                            }
                        },
                        label = { Text(tab.title) },
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (model.tab) {
                Tab.HOME -> HomeScreen(model)
                Tab.OFFERS -> OffersScreen(model)
                Tab.TRIP -> TripScreen(model)
                Tab.HISTORY -> HistoryScreen(model)
                Tab.MORE -> MoreScreen(model, openWeb)
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Empty(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
        if (action != null) Button(onClick = onAction, modifier = Modifier.padding(top = 16.dp)) { Text(action) }
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

private fun openSettings(context: Context, intent: Intent) {
    try {
        context.startActivity(intent)
    } catch (error: ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)))
    }
}

@Composable
private fun HomeScreen(model: DriverModel) {
    val context = LocalContext.current
    val summary = model.summary
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (DriverPermissions.location(context)) model.setAvailable(true)
        else model.message = "يلزم إذن الموقع لبدء الدوام ومشاركة الموقع أثناء التوصيل"
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("أهلًا " + model.driverName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            summary == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            !summary.verified -> Section("حسابك بانتظار الاعتماد") {
                Text("تعتمد الإدارة الحساب بعد توقيع العقد واعتماد المستندات المطلوبة.")
                Button(onClick = { model.open("more") }) { Text("العقد والمستندات") }
            }
            else -> Section("الدوام") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (summary.available) "متاح الآن" else "خارج الدوام", fontWeight = FontWeight.Bold, color = if (summary.available) Leaf else Plum)
                        Note(if (summary.available) "تصل العروض فورًا، ويُشارك الموقع أثناء التوصيل." else "لا تصل عروض حتى تفعيل التوفر.")
                    }
                    Switch(
                        checked = summary.available,
                        enabled = !model.busy,
                        onCheckedChange = { on ->
                            if (!on) model.setAvailable(false)
                            else if (!summary.complete) model.message = "يلزم إكمال العقد والمستندات المطلوبة أولًا من تبويب «المزيد»"
                            else if (DriverPermissions.missing(context)) permissions.launch(DriverPermissions.shift())
                            else model.setAvailable(true)
                        },
                    )
                }
            }
        }
        if (summary != null && !summary.complete) {
            Section("متطلبات العمل") {
                Text("قبل بدء الدوام يلزم إكمال:")
                summary.missing.forEach { Text("• $it") }
                Button(onClick = { model.open("more") }) { Text("إكمال العقد والمستندات") }
            }
        }
        if (summary?.activeTripId != null) {
            Section("رحلة جارية") {
                Text(Driving.status(summary.activeTripStatus.orEmpty()))
                Button(onClick = { model.open("trip") }) { Text("متابعة الرحلة") }
            }
        }
        if (summary != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) {
                    Section("رحلات مكتملة") { Text("${summary.deliveredTrips}", style = MaterialTheme.typography.headlineSmall, color = Plum) }
                }
                Box(Modifier.weight(1f)) {
                    Section("مستحقات معلنة") {
                        Text(Driving.money(summary.declaredFees), style = MaterialTheme.typography.titleLarge, color = Plum)
                        Note("تجريبية؛ ليست مبالغ مسددة")
                    }
                }
            }
        }
        Section("وصول التنبيهات") {
            Text("يُنصح باستثناء التطبيق من تحسين البطارية حتى لا يوقف الهاتف الدوام أو التنبيهات.")
            OutlinedButton(onClick = { openSettings(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }) {
                Text("إعدادات البطارية")
            }
        }
    }
}

@Composable
private fun OffersScreen(model: DriverModel) {
    val summary = model.summary
    when {
        summary == null -> Loading()
        !summary.verified -> Empty("تظهر العروض بعد اعتماد الحساب من الإدارة.")
        summary.activeTripId != null -> Empty("تظهر العروض الجديدة بعد إكمال الرحلة الحالية.", "متابعة الرحلة") { model.open("trip") }
        !summary.available -> Empty("تظهر العروض بعد تفعيل التوفر.", "الذهاب إلى الدوام") { model.open("home") }
        model.offers.isEmpty() -> Empty("لا توجد عروض الآن. يصل تنبيه فور وصول عرض جديد.")
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(model.offers, key = { it.id }) { offer -> OfferCard(offer, model) }
        }
    }
}

@Composable
private fun OfferCard(offer: Offer, model: DriverModel) {
    Section(Driving.money(offer.fee) + " • " + offer.city) {
        Driving.distance(offer.distanceKm)?.let { Text("يبعد $it عن موقع الاستلام") }
        Text("موعد التسليم " + Driving.localTime(offer.scheduledAt))
        Driving.minutesLeft(offer.expiresAt, System.currentTimeMillis())?.let { Note("ينتهي العرض خلال ${max(0L, it)} دقيقة") }
        Note("تفاصيل الأسرة والعميل تظهر بعد القبول.")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { model.accept(offer.id) }, enabled = !model.busy, modifier = Modifier.weight(1f)) { Text("قبول المشوار") }
            OutlinedButton(onClick = { model.reject(offer.id) }, enabled = !model.busy, modifier = Modifier.weight(1f)) { Text("رفض") }
        }
    }
}

private fun navigate(context: Context, latitude: Double?, longitude: Double?, address: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Driving.mapsUri(latitude, longitude, address))))
    } catch (error: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Driving.webMapsUrl(latitude, longitude, address))))
        } catch (ignored: ActivityNotFoundException) {
            // No maps app or browser to open the directions.
        }
    }
}

@Composable
private fun TripSteps(status: String) {
    val steps = listOf("assigned" to "إلى الأسرة", "picked_up" to "تم الاستلام", "in_transit" to "إلى العميل", "delivered" to "التسليم")
    val reached = steps.indexOfFirst { it.first == status }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        steps.forEachIndexed { index, step ->
            Card(
                Modifier.weight(1f),
                colors = CardDefaults.cardColors(
                    containerColor = if (index <= reached) Plum else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (index <= reached) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            ) { Text(step.second, Modifier.padding(8.dp).fillMaxWidth(), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium) }
        }
    }
}

@Composable
private fun TripScreen(model: DriverModel) {
    val trip = model.trip
    val context = LocalContext.current
    if (trip == null) {
        if (model.summary == null) Loading() else Empty("لا توجد رحلة جارية؛ تبدأ الرحلة بعد قبول أحد العروض.", "عرض المشاوير") { model.open("offers") }
        return
    }
    val step = Driving.nextStep(trip.status)
    var code by rememberSaveable(trip.id, trip.status) { mutableStateOf("") }
    var reason by rememberSaveable(trip.id) { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TripSteps(trip.status)
        Section("الاستلام من " + trip.householdName) {
            Text(trip.pickupAddress)
            if (trip.pickupLatitude == null) Note("لم تحدد الأسرة نقطة على الخريطة؛ الاتجاهات حسب العنوان.")
            Button(onClick = { navigate(context, trip.pickupLatitude, trip.pickupLongitude, trip.pickupAddress) }) { Text("الاتجاهات إلى الأسرة") }
        }
        Section("الطلب") {
            trip.items.forEach { item -> Text("• " + item.name + (if (item.option.isBlank()) "" else " (" + item.option + ")") + " × " + item.quantity) }
            HorizontalDivider()
            Text("أجرة المشوار " + Driving.money(trip.fee), fontWeight = FontWeight.Bold)
            Text("موعد التسليم " + Driving.localTime(trip.scheduledAt))
        }
        Section("التسليم للعميل") {
            Text(trip.address)
            Button(onClick = { navigate(context, trip.latitude, trip.longitude, trip.address) }) { Text("الاتجاهات إلى العميل") }
        }
        if (step != null) {
            Section(step.label) {
                if (step.codeHint != null) {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { value -> if (value.length <= 6 && value.all(Char::isDigit)) code = value },
                        label = { Text(step.codeHint) },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.titleLarge.copy(textDirection = TextDirection.Ltr),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Note(if (step.next == "picked_up") "تعطيك الأسرة الرمز عند تسليم الطلب." else "يقرأ العميل الرمز من إشعاراته عند الاستلام.")
                }
                Button(
                    onClick = { model.advance(code) },
                    enabled = !model.busy && (step.codeHint == null || code.length == 6),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(step.label) }
            }
        }
        Section("تعذر إكمال الرحلة؟") {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it.take(1000) },
                label = { Text("وصف المشكلة") },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
            Note(if (trip.status == "assigned") "قبل الاستلام يُعرض المشوار على سائق آخر." else "بعد الاستلام تتابع الإدارة الرحلة.")
            OutlinedButton(onClick = { model.report(reason) }, enabled = !model.busy && reason.trim().length >= 10) { Text("الإبلاغ عن تعثر") }
        }
        Note("يظهر موقعك للعميل والأسرة من قبول المشوار حتى التسليم فقط.")
    }
}

@Composable
private fun HistoryScreen(model: DriverModel) {
    LaunchedEffect(Unit) { model.loadHistory() }
    if (model.history.isEmpty()) {
        Empty("لا رحلات بعد.")
        return
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(model.history, key = { it.id }) { past ->
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(past.household, fontWeight = FontWeight.Bold)
                        Note(Driving.localTime(past.scheduledAt) + " • " + Driving.status(past.status))
                    }
                    Text(Driving.money(past.fee), color = Plum, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ContractSection(model: DriverModel, contract: ContractInfo) {
    if (contract.accepted) {
        Section("العقد") {
            Text("وُقّع «" + contract.title + "» — الإصدار " + contract.version)
            if (contract.acceptedAt.isNotBlank()) Note("بتاريخ " + Driving.localTime(contract.acceptedAt))
        }
        return
    }
    var name by rememberSaveable(contract.id) { mutableStateOf("") }
    var agree by rememberSaveable(contract.id) { mutableStateOf(false) }
    Section(contract.title + " — الإصدار " + contract.version) {
        Text(contract.body, style = MaterialTheme.typography.bodyMedium)
        HorizontalDivider()
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(100) },
            label = { Text("الاسم الكامل كما في الهوية") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = agree, onCheckedChange = { agree = it })
            Text("قرأت العقد وأوافق على الالتزام بجميع بنوده")
        }
        Button(
            onClick = { model.sign(name) },
            enabled = !model.busy && agree && name.trim().length >= 3,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("توقيع العقد إلكترونيًا") }
        Note("يُحفظ مع التوقيع الاسم والوقت وعنوان الاتصال لإثبات الموافقة.")
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoreScreen(model: DriverModel, openWeb: (String) -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { model.loadMore() }
    var target by remember { mutableStateOf<Requirement?>(null) }
    var expiry by remember { mutableStateOf<String?>(null) }
    var choosingDate by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val requirement = target
        if (uri != null && requirement != null) model.upload(uri, requirement, expiry)
        target = null
        expiry = null
    }
    if (choosingDate) {
        val dates = rememberDatePickerState(initialSelectedDateMillis = System.currentTimeMillis() + 365L * 86_400_000L)
        DatePickerDialog(
            onDismissRequest = {
                choosingDate = false
                target = null
            },
            confirmButton = {
                TextButton(onClick = {
                    val millis = dates.selectedDateMillis
                    choosingDate = false
                    if (millis == null) {
                        target = null
                    } else {
                        expiry = Driving.isoDate(millis)
                        picker.launch("image/*")
                    }
                }) { Text("التالي: اختيار الصورة") }
            },
            dismissButton = {
                TextButton(onClick = {
                    choosingDate = false
                    target = null
                }) { Text("إلغاء") }
            },
        ) { DatePicker(state = dates, title = { Text("تاريخ انتهاء المستند", Modifier.padding(16.dp)) }) }
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Section("الحساب") {
            Text(model.driverName, fontWeight = FontWeight.Bold)
            Note("المنصة: " + Uri.parse(model.origin).host.orEmpty())
            OutlinedButton(onClick = model::logout, enabled = !model.busy) { Text("تسجيل الخروج") }
        }
        val compliance = model.compliance
        if (compliance == null) {
            Section("العقد والمستندات") { Note("جارٍ التحميل…") }
        } else {
            compliance.contract?.let { ContractSection(model, it) }
            Section("المستندات المطلوبة") {
                compliance.documents.forEach { requirement ->
                    Text(requirement.title + if (requirement.required) "" else " (اختياري)", fontWeight = FontWeight.Bold)
                    Note(
                        Driving.documentState(requirement.state) +
                            if (requirement.expiresOn.isNotBlank()) " • ينتهي " + requirement.expiresOn else "",
                    )
                    if (requirement.note.isNotBlank()) Note("ملاحظة المراجعة: " + requirement.note)
                    if (Driving.needsUpload(requirement.state) || requirement.state == "expiring") {
                        OutlinedButton(
                            onClick = {
                                target = requirement
                                if (requirement.needsExpiry) choosingDate = true else picker.launch("image/*")
                            },
                            enabled = !model.busy,
                        ) { Text(if (requirement.state == "missing") "رفع المستند" else "رفع نسخة جديدة") }
                    }
                    HorizontalDivider()
                }
                Note("صور واضحة حتى 5 ميجابايت، تُعاد معالجتها على الخادم وتبقى خاصة بالإدارة.")
            }
        }
        Section("الإشعارات") {
            if (model.notices.isEmpty()) Note("لا إشعارات.")
            if (model.notices.any { !it.read }) TextButton(onClick = model::markRead) { Text("تعليم الكل كمقروء") }
            model.notices.take(20).forEach { notice ->
                Text(notice.message, fontWeight = if (notice.read) FontWeight.Normal else FontWeight.Bold)
                Note(Driving.localTime(notice.createdAt))
            }
        }
        Section("التنبيهات والبطارية") {
            OutlinedButton(onClick = {
                openSettings(context, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
            }) { Text("إعدادات الإشعارات") }
            OutlinedButton(onClick = { openSettings(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }) {
                Text("إعدادات البطارية")
            }
        }
        TextButton(onClick = { openWeb("/") }) { Text("فتح المتجر") }
    }
}
