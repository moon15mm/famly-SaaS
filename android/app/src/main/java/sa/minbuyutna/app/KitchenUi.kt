package sa.minbuyutna.app

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The family's live kitchen: the store's real incoming orders and the actions the platform allows on them.
 * Requires a signed-in family account; every change is made on the platform, never only on the phone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KitchenDashboardView(
    client: PlatformClient,
    user: UserProfile?,
    onSignIn: () -> Unit,
    onSwitchToCustomer: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<NativeOrder>>(emptyList()) }
    var storeName by remember { mutableStateOf("") }
    var storeCity by remember { mutableStateOf("") }
    var onVacation by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyOrder by remember { mutableStateOf<String?>(null) }
    var selectedTab by remember { mutableStateOf("active") }
    var confirmCancel by remember { mutableStateOf<NativeOrder?>(null) }
    val isFamily = user?.role == "seller"

    fun load() {
        if (!isFamily) return
        scope.launch {
            loading = true
            try {
                val store = client.getMyHousehold()
                storeName = store.optString("name")
                storeCity = store.optString("city")
                onVacation = store.optBoolean("on_vacation", false)
                orders = client.getMyOrders()
                error = null
            } catch (e: Exception) {
                error = e.message ?: "تعذر تحميل طلبات المطبخ"
            } finally {
                loading = false
            }
        }
    }

    fun act(order: NativeOrder, state: String, done: String) {
        scope.launch {
            busyOrder = order.id
            try {
                client.transitionOrder(order.id, state)
                Toast.makeText(context, done, Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, e.message ?: "تعذر تحديث الطلب", Toast.LENGTH_LONG).show()
            } finally {
                busyOrder = null
                load()
            }
        }
    }

    LaunchedEffect(user?.id) {
        while (isFamily) {
            load()
            delay(30_000)
        }
    }

    Scaffold(
        topBar = {
            Column(modifier = Modifier.fillMaxWidth().background(Color.White)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = PrimaryBurgundy, modifier = Modifier.size(42.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.Restaurant, contentDescription = null, tint = Color.White)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                storeName.ifBlank { "مطبخ الأسرة" },
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Black,
                                color = PrimaryBurgundy
                            )
                            if (storeCity.isNotBlank()) Text(storeCity, style = MaterialTheme.typography.bodySmall, color = TextMuted)
                        }
                    }
                    Surface(
                        modifier = Modifier.clickable { onSwitchToCustomer() },
                        shape = RoundedCornerShape(20.dp),
                        color = WarmSandBackground,
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle)
                    ) {
                        Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Storefront, contentDescription = null, tint = PrimaryBurgundy, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("متجر الزبائن", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = PrimaryBurgundy)
                        }
                    }
                }
                HorizontalDivider(color = BorderSubtle)
                if (isFamily) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        KitchenStatPill("جديدة", "${orders.count { kitchenStage(it.status) == "new" }}", Color(0xFFFFF3E0), Color(0xFFE65100))
                        KitchenStatPill("قيد التجهيز", "${orders.count { kitchenStage(it.status) == "cooking" }}", Color(0xFFE3F2FD), Color(0xFF1565C0))
                        KitchenStatPill("جاهزة", "${orders.count { kitchenStage(it.status) == "ready" }}", Color(0xFFE8F5E9), Color(0xFF2E7D32))
                        KitchenStatPill(
                            "صافي المدفوع",
                            halalasToSar(orders.filter { it.paymentStatus == "paid" }.sumOf { it.merchantPayout }) + " ر.س",
                            Color(0xFFF7EFF1),
                            PrimaryBurgundy
                        )
                    }
                    HorizontalDivider(color = BorderSubtle)
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).background(WarmSandBackground).padding(16.dp)
        ) {
            if (!isFamily) {
                Column(modifier = Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Lock, contentDescription = null, tint = PrimaryBurgundy, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(10.dp))
                    Text("لوحة المطبخ لحسابات الأسر المنتجة", fontWeight = FontWeight.Bold)
                    Text("سجّل الدخول بحساب أسرتك لعرض طلباتك الحقيقية وإدارتها.", fontSize = 12.sp, color = TextMuted)
                    Spacer(Modifier.height(14.dp))
                    Button(onClick = onSignIn, colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy)) {
                        Text("تسجيل الدخول")
                    }
                }
                return@Column
            }

            Surface(
                shape = RoundedCornerShape(14.dp),
                color = Color.White,
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            if (onVacation) "المتجر متوقف عن استقبال الطلبات" else "المتجر يستقبل الطلبات الجديدة",
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            color = if (onVacation) TextDark else Color(0xFF1B5E20)
                        )
                        Text("يُحدَّث في المنصة مباشرة؛ الطلبات القائمة لا تتأثر", fontSize = 11.sp, color = TextMuted)
                    }
                    Switch(
                        checked = !onVacation,
                        enabled = !loading,
                        onCheckedChange = { open ->
                            scope.launch {
                                try {
                                    client.setOnVacation(!open)
                                    onVacation = !open
                                    Toast.makeText(
                                        context,
                                        if (open) "عاد المتجر لاستقبال الطلبات ✓" else "أُوقف استقبال الطلبات الجديدة مؤقتًا",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } catch (e: Exception) {
                                    Toast.makeText(context, e.message ?: "تعذر تحديث حالة المتجر", Toast.LENGTH_LONG).show()
                                }
                            }
                        },
                        colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = AccentMintDark)
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("active" to "الحالية", "new" to "جديدة 🚨", "cooking" to "قيد التجهيز 🍳", "ready" to "جاهزة 📦").forEach { (key, label) ->
                    FilterChip(
                        selected = selectedTab == key,
                        onClick = { selectedTab = key },
                        label = { Text(label) },
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = PrimaryBurgundy, selectedLabelColor = Color.White)
                    )
                }
            }
            Spacer(Modifier.height(12.dp))

            error?.let {
                Text(it, color = Color(0xFFC62828), fontSize = 12.sp)
                TextButton(onClick = { load() }) { Text("إعادة المحاولة") }
            }

            val shown = orders.filter {
                val stage = kitchenStage(it.status)
                if (selectedTab == "active") stage in setOf("new", "cooking", "ready") else stage == selectedTab
            }
            if (shown.isEmpty()) {
                Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = AccentMintDark, modifier = Modifier.size(54.dp))
                        Spacer(Modifier.height(8.dp))
                        Text(if (loading) "جارٍ التحميل…" else "لا توجد طلبات في هذا القسم", fontWeight = FontWeight.Bold, color = TextDark)
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(shown, key = { it.id }) { order ->
                        KitchenOrderCard(
                            order = order,
                            busy = busyOrder == order.id,
                            onAction = { state, done -> act(order, state, done) },
                            onCancel = { confirmCancel = order }
                        )
                    }
                }
            }
        }
    }

    confirmCancel?.let { order ->
        AlertDialog(
            onDismissRequest = { confirmCancel = null },
            title = { Text(if (order.status == "pending_acceptance") "رفض الطلب؟" else "إلغاء الطلب؟", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    if (order.paymentStatus == "paid") "الطلب مدفوع؛ سيُحوَّل للإدارة لاسترداد المبلغ للعميل."
                    else "سيُبلَّغ العميل ويُعاد المخزون.",
                    fontSize = 13.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        confirmCancel = null
                        act(order, "cancelled", "أُلغي الطلب")
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828))
                ) { Text("تأكيد") }
            },
            dismissButton = { TextButton(onClick = { confirmCancel = null }) { Text("رجوع", color = TextMuted) } }
        )
    }
}

@Composable
fun KitchenStatPill(title: String, value: String, bgColor: Color, textColor: Color) {
    Surface(shape = RoundedCornerShape(10.dp), color = bgColor, modifier = Modifier.padding(horizontal = 2.dp)) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, fontWeight = FontWeight.Black, fontSize = 14.sp, color = textColor)
            Text(title, fontSize = 10.sp, color = textColor.copy(alpha = 0.8f))
        }
    }
}

@Composable
fun KitchenOrderCard(
    order: NativeOrder,
    busy: Boolean,
    onAction: (String, String) -> Unit,
    onCancel: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
        modifier = Modifier.fillMaxWidth(),
        shadowElevation = 2.dp
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("#${order.shortId}", fontWeight = FontWeight.Black, fontSize = 15.sp, color = PrimaryBurgundy)
                Surface(shape = RoundedCornerShape(20.dp), color = Color(0xFFF5F5F5)) {
                    Text(
                        order.statusArabic,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextDark
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                when (order.deliveryMethod) {
                    "pickup" -> "استلام من الأسرة"
                    "free" -> "توصيل من الأسرة: ${order.address}"
                    else -> "توصيل بكابتن المنصة: ${order.address}"
                },
                fontSize = 12.sp,
                color = TextMuted
            )
            Text("الموعد: ${riyadhTime(order.scheduledAt)}", fontSize = 11.sp, color = TextMuted)
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = BorderSubtle.copy(alpha = 0.5f))
            Spacer(Modifier.height(10.dp))
            order.items.forEach { dish ->
                Text(
                    "• ${dish.quantity}× ${dish.name}" + (dish.option?.let { " ($it)" } ?: ""),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = TextDark,
                    modifier = Modifier.padding(vertical = 2.dp)
                )
            }
            Spacer(Modifier.height(12.dp))
            Text("قيمة المنتجات: ${halalasToSar(order.subtotal)} ر.س", fontSize = 11.sp, color = TextMuted)
            Text(
                "صافي الأسرة بعد عمولة المنصة (${halalasToSar(order.merchantFee)} ر.س): ${halalasToSar(order.merchantPayout)} ر.س",
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                color = PrimaryBurgundy
            )
            Text("ملاحظات العميل تصل في محادثة الطلب على المنصة.", fontSize = 10.sp, color = TextMuted)
            Spacer(Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val next = nextKitchenAction(order.status, order.deliveryMethod)
                if (next != null) {
                    Button(
                        onClick = { onAction(next.first, "تم: ${next.second}") },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                        shape = RoundedCornerShape(10.dp)
                    ) { Text(next.second) }
                } else {
                    Text(
                        when (order.status) {
                            "pending_payment" -> "بانتظار دفع العميل"
                            "ready" -> "بانتظار الكابتن؛ أعطه رمز الاستلام من إشعاراتك"
                            else -> ""
                        },
                        fontSize = 11.sp,
                        color = TextMuted,
                        modifier = Modifier.weight(1f)
                    )
                }
                if (kitchenCanCancel(order.status)) {
                    TextButton(onClick = onCancel, enabled = !busy) {
                        Text(if (order.status == "pending_acceptance") "رفض" else "إلغاء", color = Color(0xFFC62828))
                    }
                }
            }
        }
    }
}
