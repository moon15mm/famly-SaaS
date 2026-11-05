package sa.minbuyutna.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

private const val HOUR_MS = 3_600_000L

/**
 * Places a real order: the platform prices it first, then the customer confirms that exact total.
 * Payment happens later from "My orders", once the family has accepted.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeCheckoutDialog(
    client: PlatformClient,
    cart: List<NativeCartItem>,
    defaultAddress: String,
    onDismiss: () -> Unit,
    onPlaced: (orderId: String, notesSent: Boolean) -> Unit
) {
    val scope = rememberCoroutineScope()
    var method by remember { mutableStateOf("pickup") }
    var address by remember { mutableStateOf(defaultAddress) }
    val prepHours = cart.maxOfOrNull { it.product.prepHours } ?: 0
    val earliest = remember(prepHours) { earliestSlotMillis(System.currentTimeMillis(), prepHours) }
    var slotIndex by remember { mutableStateOf(0) }
    var quote by remember { mutableStateOf<CheckoutQuote?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var idempotencyKey by remember { mutableStateOf("app-" + UUID.randomUUID()) }
    val singleFamily = cart.map { it.product.householdId }.toSet().size == 1
    val slotMillis = earliest + slotIndex * HOUR_MS
    val slotLabel = remember(slotMillis) {
        SimpleDateFormat("EEEE d MMMM، HH:mm", Locale("ar")).apply { timeZone = TimeZone.getTimeZone("Asia/Riyadh") }.format(Date(slotMillis))
    }

    // Any change makes the previous price and order key stale.
    fun changed() {
        quote = null
        error = null
        idempotencyKey = "app-" + UUID.randomUUID()
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("مراجعة الطلب", fontWeight = FontWeight.Bold) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                if (!singleFamily) {
                    Text(
                        "السلة فيها منتجات من أكثر من أسرة؛ أكمل طلب أسرة واحدة ثم اطلب من الأخرى.",
                        color = Color(0xFFC62828),
                        fontSize = 12.sp
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Text("طريقة الاستلام:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = method == "pickup", onClick = { method = "pickup"; changed() }, label = { Text("استلام من الأسرة") })
                    FilterChip(selected = method == "paid", onClick = { method = "paid"; changed() }, label = { Text("توصيل بكابتن") })
                }
                if (method != "pickup") {
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it; changed() },
                        label = { Text("عنوان التوصيل بالتفصيل", fontSize = 11.sp) },
                        supportingText = { Text("الحي والشارع ووصف المنزل (10 أحرف على الأقل)", fontSize = 10.sp) },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text("موعد الاستلام أو التوصيل:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { if (slotIndex > 0) { slotIndex -= 1; changed() } }, enabled = slotIndex > 0) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "موعد أبكر")
                    }
                    Text(slotLabel, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    IconButton(onClick = { if (slotIndex < 24 * 7) { slotIndex += 1; changed() } }) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "موعد لاحق")
                    }
                }
                Text(
                    "أبكر موعد يراعي مدة التجهيز. إن كان الموعد خارج ساعات عمل الأسرة أو امتلأ ستخبرك المنصة.",
                    fontSize = 10.sp,
                    color = TextMuted
                )
                quote?.let { q ->
                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider(color = BorderSubtle)
                    QuoteRow("قيمة المنتجات", q.subtotal)
                    if (q.deliveryFee > 0) QuoteRow("التوصيل", q.deliveryFee)
                    q.breakdown?.let { Text(it, fontSize = 10.sp, color = TextMuted) }
                    QuoteRow("رسوم الخدمة", q.serviceFee)
                    QuoteRow("الإجمالي", q.total, bold = true)
                }
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = Color(0xFFC62828), fontSize = 12.sp)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "تراجع الأسرة طلبك أولًا، ثم تدفع من «طلباتي» عبر بوابة الدفع. لا يُخصم شيء الآن.",
                    fontSize = 11.sp,
                    color = TextMuted
                )
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && singleFamily,
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        try {
                            val iso = isoWithOffset(slotMillis)
                            val current = quote
                            if (current == null) {
                                quote = client.quoteCheckout(cart, method, address, iso)
                            } else {
                                val orderId = client.placeOrder(cart, method, address, iso, current.total, idempotencyKey)
                                val notes = cart.filter { it.note.isNotBlank() }
                                    .joinToString("\n") { "• ${it.product.name}: ${it.note}" }
                                val notesSent = notes.isEmpty() || runCatching {
                                    client.sendOrderMessage(orderId, "ملاحظاتي على الطلب:\n$notes")
                                }.isSuccess
                                onPlaced(orderId, notesSent)
                            }
                        } catch (e: Exception) {
                            error = e.message ?: "تعذر إكمال الطلب"
                            quote = null
                        } finally {
                            busy = false
                        }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy)
            ) {
                Text(quote?.let { "إرسال الطلب للأسرة • ${halalasToSar(it.total)} ر.س" } ?: "احسب الإجمالي")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("رجوع", color = TextMuted) } }
    )
}

@Composable
private fun QuoteRow(label: String, amount: Int, bold: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 13.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
        Text("${halalasToSar(amount)} ر.س", fontSize = 13.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
    }
}
