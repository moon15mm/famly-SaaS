package sa.minbuyutna.app

import java.util.Locale
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

// --- Top Location Bar ---
@Composable
fun TopLocationBar(
    selectedVillage: String,
    onSelectVillage: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.clickable { expanded = true }
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.LocationOn,
                    contentDescription = null,
                    tint = PrimaryBurgundy,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    text = "التوصيل إلى:",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = selectedVillage,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = PrimaryBurgundyDark
                )
                Icon(
                    Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = PrimaryBurgundyDark,
                    modifier = Modifier.size(20.dp)
                )
            }

            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                AL_DARB_VILLAGES.forEach { village ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(village.name, fontWeight = FontWeight.Bold)
                                Text(
                                    "${village.distanceKm} كم · توصيل تقريبي ${village.estimatedMinutes} دقيقة",
                                    fontSize = 11.sp,
                                    color = TextMuted
                                )
                            }
                        },
                        onClick = {
                            onSelectVillage(village.name)
                            expanded = false
                        }
                    )
                }
            }
        }

        // Live badge
        Surface(
            color = Color(0xFFECFDF5),
            shape = RoundedCornerShape(20.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFA7F3D0))
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(AccentMint, CircleShape)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "مطابخ الدرب نشطة",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = AccentMintDark
                )
            }
        }
    }
}

// --- Categories Horizontal Filter ---
@Composable
fun CategoryChipsRow(
    selectedCategory: String,
    onSelectCategory: (String) -> Unit
) {
    val categories = listOf(
        "all" to "كل الإبداعات 🌟",
        "food" to "مأكولات شعبية 🥘",
        "sweets" to "حلا وضيافة 🍰",
        "crafts" to "حرف وهدايا 🎁"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        categories.forEach { (catId, title) ->
            val isSelected = selectedCategory == catId
            Surface(
                modifier = Modifier.clickable { onSelectCategory(catId) },
                color = if (isSelected) PrimaryBurgundy else Color.White,
                shape = RoundedCornerShape(20.dp),
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (isSelected) PrimaryBurgundy else BorderSubtle
                ),
                shadowElevation = if (isSelected) 4.dp else 1.dp
            ) {
                Text(
                    text = title,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    color = if (isSelected) Color.White else TextDark
                )
            }
        }
    }
}

// --- Household Kitchens Showcase ---
@Composable
fun HouseholdShowcase(
    households: List<HouseholdStore>,
    onSelectHousehold: (HouseholdStore) -> Unit
) {
    if (households.isEmpty()) return

    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "أسر الدرب المنتجة المعتمدة 👩‍🍳",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                "${households.size} مطابخ جاهزة",
                style = MaterialTheme.typography.bodySmall,
                color = AccentGold
            )
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(households) { store ->
                Surface(
                    modifier = Modifier
                        .width(220.dp)
                        .clickable { onSelectHousehold(store) },
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White,
                    border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                    shadowElevation = 2.dp
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .background(Color(0xFFF7EFF1), CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Text("⌂", fontSize = 18.sp, color = PrimaryBurgundy)
                            }
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        store.name,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (store.verified) {
                                        Spacer(Modifier.width(4.dp))
                                        Icon(
                                            Icons.Default.CheckCircle,
                                            contentDescription = "معتمد",
                                            tint = AccentMint,
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }
                                }
                                Text(
                                    store.pickupAddress,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextMuted,
                                    maxLines = 1
                                )
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            store.description,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            color = TextDark
                        )
                    }
                }
            }
        }
    }
}

// --- Product Card ---
@Composable
fun ProductCard(
    product: NativeProduct,
    onAddToCart: (NativeProduct) -> Unit,
    onClick: (NativeProduct) -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(product) },
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
        shadowElevation = 2.dp
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(130.dp)
                    .background(Color(0xFFF3F4F6))
            ) {
                if (product.fullImageUrl != null) {
                    AsyncImage(
                        model = product.fullImageUrl,
                        contentDescription = product.name,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("صُنع بحب في الدرب", color = TextMuted, fontSize = 12.sp)
                    }
                }

                // Prep hours badge
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp),
                    color = Color.Black.copy(alpha = 0.65f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        "${product.prepHours} س تحضير",
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            Column(modifier = Modifier.padding(10.dp)) {
                Text(
                    product.householdName,
                    style = MaterialTheme.typography.bodySmall,
                    color = AccentGold,
                    maxLines = 1
                )
                Text(
                    product.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "${product.priceSar} ر.س",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                        color = PrimaryBurgundy
                    )

                    Button(
                        onClick = { onAddToCart(product) },
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "إضافة", modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(2.dp))
                        Text("أضف", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

// --- Cart Screen ---
@Composable
fun NativeCartView(
    items: List<NativeCartItem>,
    onIncrease: (NativeCartItem) -> Unit,
    onDecrease: (NativeCartItem) -> Unit,
    onRemove: (NativeCartItem) -> Unit,
    onCheckout: () -> Unit
) {
    if (items.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Outlined.ShoppingCart,
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = BorderSubtle
                )
                Spacer(Modifier.height(16.dp))
                Text("سلتك فارغة حالياً", style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    "اكتشف أشهى المأكولات الشعبية والحلويات من أسر الدرب وأضفها لسلتك.",
                    textAlign = TextAlign.Center,
                    color = TextMuted,
                    fontSize = 13.sp
                )
            }
        }
        return
    }

    // An estimate only: the platform prices delivery by distance and confirms the total at review.
    val subtotalHalalas = items.sumOf { it.totalHalalas }
    val serviceFeeHalalas = CUSTOMER_SERVICE_FEE_HALALAS
    val totalHalalas = subtotalHalalas + serviceFeeHalalas

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text("سلة الطلبات 🛒", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(items) { item ->
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = Color.White,
                    border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                    shadowElevation = 1.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(item.product.name, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            if (!item.selectedOption.isNullOrBlank()) {
                                Text("الخيار: ${item.selectedOption}", fontSize = 11.sp, color = AccentGold, fontWeight = FontWeight.Bold)
                            }
                            if (item.note.isNotBlank()) {
                                Text("ملاحظة: ${item.note}", fontSize = 11.sp, color = TextMuted)
                            }
                            Text(
                                "المطبخ: ${item.product.householdName}",
                                fontSize = 11.sp,
                                color = TextMuted
                            )
                            Text(
                                "${halalasToSar(item.unitHalalas)} ر.س للوحدة",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = PrimaryBurgundy
                            )
                        }

                        // Stepper
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(
                                onClick = { onDecrease(item) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(Icons.Default.Remove, contentDescription = "إنقاص", modifier = Modifier.size(16.dp))
                            }
                            Text(
                                "${item.quantity}",
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                modifier = Modifier.padding(horizontal = 6.dp)
                            )
                            IconButton(
                                onClick = { onIncrease(item) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(Icons.Default.Add, contentDescription = "زيادة", modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }
            }
        }

        // Bill Summary Card
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFFF9FAFB),
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("قيمة المنتجات:", color = TextMuted, fontSize = 13.sp)
                    Text(String.format(Locale.US, "%.2f ر.س", subtotalHalalas / 100.0), fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("التوصيل:", color = TextMuted, fontSize = 13.sp)
                    Text("يُحسب حسب المسافة عند المراجعة", fontSize = 12.sp, color = TextMuted)
                }
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("رسوم الخدمة والتشغيل:", color = TextMuted, fontSize = 13.sp)
                    Text(String.format(Locale.US, "%.2f ر.س", serviceFeeHalalas / 100.0), fontWeight = FontWeight.Bold)
                }
                HorizontalDivider(modifier = Modifier.padding(vertical = 10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("الإجمالي قبل التوصيل:", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        String.format(Locale.US, "%.2f ر.س", totalHalalas / 100.0),
                        style = MaterialTheme.typography.titleLarge,
                        color = PrimaryBurgundy,
                        fontWeight = FontWeight.ExtraBold
                    )
                }
            }
        }

        Button(
            onClick = onCheckout,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy)
        ) {
            Text("مراجعة الطلب وتحديد الموعد", fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// --- Orders View ---
@Composable
fun NativeOrdersView(
    orders: List<NativeOrder>,
    onRefresh: () -> Unit,
    busyOrderId: String? = null,
    onPay: (NativeOrder) -> Unit = {},
    onCancel: (NativeOrder) -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("طلباتي النشطة 📦", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = PrimaryBurgundy)
            }
        }

        if (orders.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.ReceiptLong,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = BorderSubtle
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("لا توجد طلبات جارية حالياً", style = MaterialTheme.typography.titleMedium)
                }
            }
            return
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(orders) { order ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White,
                    border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                    shadowElevation = 2.dp
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                order.householdName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Surface(
                                color = Color(0xFFF3E8FF),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text(
                                    order.statusArabic,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF6B21A8),
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }

                        Spacer(Modifier.height(10.dp))

                        // OTP Display if available
                        if (!order.deliveryOtp.isNullOrEmpty()) {
                            Surface(
                                color = Color(0xFFFEF3C7),
                                shape = RoundedCornerShape(10.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFDE68A)),
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("رمز استلام طلبك (Delivery OTP):", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    Text(order.deliveryOtp, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = Color(0xFF92400E))
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        Text("#${order.shortId} · الموعد: ${riyadhTime(order.scheduledAt)}", fontSize = 12.sp, color = TextMuted)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                if (order.deliveryMethod == "pickup") (order.pickupAddress?.let { "الاستلام: $it" } ?: "استلام من الأسرة (يظهر الموقع بعد الدفع)")
                                else "العنوان: ${order.address}",
                                fontSize = 12.sp,
                                color = TextMuted,
                                modifier = Modifier.weight(1f)
                            )
                            Text("الإجمالي: ${order.totalSar} ر.س", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = PrimaryBurgundy)
                        }
                        when (order.status) {
                            "pending_acceptance" -> Text("بانتظار مراجعة الأسرة؛ يظهر زر الدفع بعد قبولها.", fontSize = 11.sp, color = TextMuted)
                            "pending_payment" -> Button(
                                onClick = { onPay(order) },
                                enabled = busyOrderId != order.id,
                                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                            ) { Text("ادفع الآن · ${order.totalSar} ر.س") }
                        }
                        if (order.status == "pending_acceptance" || order.status == "pending_payment" || order.status == "confirmed") {
                            TextButton(onClick = { onCancel(order) }, enabled = busyOrderId != order.id) {
                                Text("إلغاء الطلب", color = Color(0xFFC62828))
                            }
                        }
                        if (order.paymentStatus == "refund_pending") {
                            Text("أُلغي الطلب المدفوع؛ الإدارة تعالج استرداد المبلغ.", fontSize = 11.sp, color = Color(0xFF92400E))
                        }
                    }
                }
            }
        }
    }
}
