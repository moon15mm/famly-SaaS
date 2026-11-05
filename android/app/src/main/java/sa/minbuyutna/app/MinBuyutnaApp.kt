package sa.minbuyutna.app

import java.util.Locale
import android.content.Intent
import android.widget.Toast
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.automirrored.outlined.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

enum class MainTab {
    DISCOVER,
    CART,
    ORDERS,
    PROFILE
}

enum class AppMode {
    CUSTOMER,
    KITCHEN
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MinBuyutnaApp(
    client: PlatformClient = remember { PlatformClient() }
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val prefs = remember { context.getSharedPreferences("min_buyutna_native_prefs", android.content.Context.MODE_PRIVATE) }
    var currentUser by remember {
        val id = prefs.getString("user_id", null)
        val name = prefs.getString("user_name", null)
        val email = prefs.getString("user_email", null)
        val role = prefs.getString("user_role", "customer")
        prefs.getString("user_token", null)?.let { plain ->
            prefs.edit().putString("user_token_enc", SessionVault.encrypt(plain)).remove("user_token").apply()
        }
        val token = prefs.getString("user_token_enc", null)?.let(SessionVault::decrypt)
        client.activeSessionToken = token
        if (id != null && name != null && email != null) {
            mutableStateOf<UserProfile?>(UserProfile(id, name, email, role ?: "customer", token))
        } else {
            mutableStateOf<UserProfile?>(null)
        }
    }
    var showAuthDialog by remember { mutableStateOf(false) }

    fun saveUserSession(user: UserProfile?) {
        currentUser = user
        client.activeSessionToken = user?.sessionToken
        prefs.edit().apply {
            if (user != null) {
                putString("user_id", user.id)
                putString("user_name", user.name)
                putString("user_email", user.email)
                putString("user_role", user.role)
                user.sessionToken?.let { putString("user_token_enc", SessionVault.encrypt(it)) } ?: remove("user_token_enc")
            } else {
                remove("user_id")
                remove("user_name")
                remove("user_email")
                remove("user_role")
                remove("user_token_enc")
            }
            apply()
        }
    }

    var appMode by remember { mutableStateOf(AppMode.CUSTOMER) }
    var currentTab by remember { mutableStateOf(MainTab.DISCOVER) }
    var selectedVillage by remember { mutableStateOf(AL_DARB_VILLAGES.first().name) }
    var selectedCategory by remember { mutableStateOf("all") }
    var searchQuery by remember { mutableStateOf("") }

    // Live Data States
    var products by remember { mutableStateOf<List<NativeProduct>>(emptyList()) }
    var households by remember { mutableStateOf<List<HouseholdStore>>(emptyList()) }
    var orders by remember { mutableStateOf<List<NativeOrder>>(emptyList()) }
    var cartItems by remember { mutableStateOf<List<NativeCartItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    // Customization dialog state
    var selectedProductForDetail by remember { mutableStateOf<NativeProduct?>(null) }
    var detailQuantity by remember { mutableStateOf(1) }
    var detailOption by remember { mutableStateOf<ProductOption?>(null) }
    var detailSpicy by remember { mutableStateOf("عادي") }
    var detailCustomNote by remember { mutableStateOf("") }

    var loadError by remember { mutableStateOf<String?>(null) }
    var showCheckout by remember { mutableStateOf(false) }
    var busyOrderId by remember { mutableStateOf<String?>(null) }

    fun loadData() {
        scope.launch {
            loading = true
            try {
                products = client.getCatalog(category = selectedCategory, q = searchQuery)
                households = client.getHouseholds()
                loadError = null
            } catch (e: Exception) {
                loadError = e.message ?: "تعذر تحميل المنتجات من المنصة"
            }
            if (currentUser != null) {
                try {
                    orders = client.getMyOrders()
                } catch (e: ApiException) {
                    if (e.status == 401) saveUserSession(null) else loadError = e.message
                } catch (e: Exception) {
                    loadError = e.message ?: "تعذر تحميل الطلبات"
                }
            } else {
                orders = emptyList()
            }
            loading = false
        }
    }

    LaunchedEffect(selectedCategory, currentUser?.id) {
        loadData()
    }

    // Filter products locally by search query as well
    val displayedProducts = remember(products, searchQuery, selectedCategory) {
        products.filter { p ->
            (selectedCategory == "all" || p.category == selectedCategory) &&
            (searchQuery.isBlank() || p.name.contains(searchQuery, ignoreCase = true) || p.householdName.contains(searchQuery, ignoreCase = true) || p.description.contains(searchQuery, ignoreCase = true))
        }
    }

    fun addToCart(product: NativeProduct, quantity: Int = 1, option: ProductOption? = null, note: String = "") {
        val current = cartItems.toMutableList()
        val existing = current.find { it.product.id == product.id && it.optionId == option?.id && it.note == note }
        if (existing != null) {
            existing.quantity += quantity
        } else {
            current.add(NativeCartItem(product, quantity, option?.name, note, option?.id, option?.priceDiff ?: 0))
        }
        cartItems = current
        Toast.makeText(context, "تمت إضافة ${product.name} إلى السلة ✓", Toast.LENGTH_SHORT).show()
    }

    // If in Kitchen Mode, show full Kitchen Dashboard
    if (appMode == AppMode.KITCHEN) {
        KitchenDashboardView(
            client = client,
            user = currentUser,
            onSignIn = {
                appMode = AppMode.CUSTOMER
                currentTab = MainTab.PROFILE
                showAuthDialog = true
            },
            onSwitchToCustomer = { appMode = AppMode.CUSTOMER }
        )
        return
    }

    Scaffold(
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White)
            ) {
                // Main Brand Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = PrimaryBurgundy,
                            modifier = Modifier.size(38.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text("⌂", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                "من بيوتنا",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Black,
                                color = PrimaryBurgundy
                            )
                            Text(
                                "صُنع بحب، من قريب · محافظة الدرب",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextMuted
                            )
                        }
                    }

                    // Mode switch pills
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        // Switch to Kitchen
                        Surface(
                            modifier = Modifier.clickable {
                                appMode = AppMode.KITCHEN
                                Toast.makeText(context, "مرحباً بك في لوحة مطبخ الأسرة 🍳", Toast.LENGTH_SHORT).show()
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = Color(0xFFFFF3E0),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFFB74D))
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.Restaurant, contentDescription = null, tint = Color(0xFFE65100), modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(3.dp))
                                Text("المطبخ", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFFE65100))
                            }
                        }

                        // Switch to Driver
                        Surface(
                            modifier = Modifier.clickable {
                                context.startActivity(Intent(context, DriverActivity::class.java))
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = Color(0xFFF7EFF1),
                            border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBurgundy.copy(alpha = 0.2f))
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.TwoWheeler, contentDescription = null, tint = PrimaryBurgundy, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(3.dp))
                                Text("الكابتن", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = PrimaryBurgundy)
                            }
                        }
                    }
                }

                if (currentTab == MainTab.DISCOVER) {
                    TopLocationBar(
                        selectedVillage = selectedVillage,
                        onSelectVillage = {
                            selectedVillage = it
                            loadData()
                        }
                    )

                    // Search input bar
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        shape = RoundedCornerShape(12.dp),
                        color = WarmSandBackground,
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Search, contentDescription = null, tint = TextMuted, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            TextField(
                                value = searchQuery,
                                onValueChange = { searchQuery = it },
                                placeholder = { Text("وش خاطرك فيه اليوم؟ (مغش، مرسة، خمير...)", fontSize = 13.sp, color = TextMuted) },
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Color.Transparent,
                                    unfocusedContainerColor = Color.Transparent,
                                    disabledContainerColor = Color.Transparent,
                                    focusedIndicatorColor = Color.Transparent,
                                    unfocusedIndicatorColor = Color.Transparent
                                ),
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            if (searchQuery.isNotBlank()) {
                                IconButton(
                                    onClick = { searchQuery = "" },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = "مسح", tint = TextMuted, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
                HorizontalDivider(color = BorderSubtle, thickness = 1.dp)
            }
        },
        bottomBar = {
            NavigationBar(
                containerColor = Color.White,
                tonalElevation = 8.dp
            ) {
                NavigationBarItem(
                    selected = currentTab == MainTab.DISCOVER,
                    onClick = { currentTab = MainTab.DISCOVER },
                    icon = { Icon(if (currentTab == MainTab.DISCOVER) Icons.Filled.Home else Icons.Outlined.Home, contentDescription = "الرئيسية") },
                    label = { Text("الرئيسية") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = PrimaryBurgundy,
                        selectedTextColor = PrimaryBurgundy,
                        indicatorColor = Color(0xFFF7EFF1)
                    )
                )

                NavigationBarItem(
                    selected = currentTab == MainTab.CART,
                    onClick = { currentTab = MainTab.CART },
                    icon = {
                        BadgedBox(
                            badge = {
                                if (cartItems.isNotEmpty()) {
                                    Badge(containerColor = AccentMintDark) {
                                        Text("${cartItems.sumOf { it.quantity }}")
                                    }
                                }
                            }
                        ) {
                            Icon(if (currentTab == MainTab.CART) Icons.Filled.ShoppingCart else Icons.Outlined.ShoppingCart, contentDescription = "السلة")
                        }
                    },
                    label = { Text("السلة") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = PrimaryBurgundy,
                        selectedTextColor = PrimaryBurgundy,
                        indicatorColor = Color(0xFFF7EFF1)
                    )
                )

                NavigationBarItem(
                    selected = currentTab == MainTab.ORDERS,
                    onClick = { currentTab = MainTab.ORDERS },
                    icon = { Icon(if (currentTab == MainTab.ORDERS) Icons.Default.ReceiptLong else Icons.Outlined.ReceiptLong, contentDescription = "طلباتي") },
                    label = { Text("طلباتي") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = PrimaryBurgundy,
                        selectedTextColor = PrimaryBurgundy,
                        indicatorColor = Color(0xFFF7EFF1)
                    )
                )

                NavigationBarItem(
                    selected = currentTab == MainTab.PROFILE,
                    onClick = { currentTab = MainTab.PROFILE },
                    icon = { Icon(if (currentTab == MainTab.PROFILE) Icons.Filled.Person else Icons.Outlined.Person, contentDescription = "حسابي") },
                    label = { Text("حسابي") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = PrimaryBurgundy,
                        selectedTextColor = PrimaryBurgundy,
                        indicatorColor = Color(0xFFF7EFF1)
                    )
                )
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(WarmSandBackground)
        ) {
            when (currentTab) {
                MainTab.DISCOVER -> {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 16.dp)
                    ) {
                        item(span = { GridItemSpan(2) }) {
                            CategoryChipsRow(
                                selectedCategory = selectedCategory,
                                onSelectCategory = { selectedCategory = it }
                            )
                        }

                        loadError?.let { message ->
                            item(span = { GridItemSpan(2) }) {
                                Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFFFEBEE), modifier = Modifier.fillMaxWidth()) {
                                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(message, fontSize = 12.sp, color = Color(0xFFC62828), modifier = Modifier.weight(1f))
                                        TextButton(onClick = { loadData() }) { Text("إعادة المحاولة") }
                                    }
                                }
                            }
                        }

                        if (searchQuery.isBlank()) {
                            item(span = { GridItemSpan(2) }) {
                                HouseholdShowcase(
                                    households = households,
                                    onSelectHousehold = { store ->
                                        searchQuery = store.name
                                        Toast.makeText(context, "تصفح أطباق ${store.name}", Toast.LENGTH_SHORT).show()
                                    }
                                )
                            }
                        }

                        item(span = { GridItemSpan(2) }) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp, bottom = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    if (searchQuery.isBlank()) "أشهى الأطباق المنزلية الطازجة 🍲" else "نتائج البحث عن «$searchQuery»",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    "${displayedProducts.size} وجبة",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextMuted
                                )
                            }
                        }

                        if (displayedProducts.isEmpty()) {
                            item(span = { GridItemSpan(2) }) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(40.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("لا توجد وجبات تطابق بحثك حالياً", fontWeight = FontWeight.Bold)
                                        Spacer(Modifier.height(6.dp))
                                        Text("جرب تصنيفاً آخر أو امسح البحث", fontSize = 12.sp, color = TextMuted)
                                    }
                                }
                            }
                        } else {
                            items(displayedProducts) { product ->
                                ProductCard(
                                    product = product,
                                    onAddToCart = {
                                        selectedProductForDetail = it
                                        detailQuantity = 1
                                        detailOption = it.options.firstOrNull()
                                        detailSpicy = "عادي"
                                        detailCustomNote = ""
                                    },
                                    onClick = {
                                        selectedProductForDetail = it
                                        detailQuantity = 1
                                        detailOption = it.options.firstOrNull()
                                        detailSpicy = "عادي"
                                        detailCustomNote = ""
                                    }
                                )
                            }
                        }
                    }
                }

                MainTab.CART -> {
                    NativeCartView(
                        items = cartItems,
                        onIncrease = { itm ->
                            val current = cartItems.toMutableList()
                            current.find { it == itm }?.let { it.quantity += 1 }
                            cartItems = current
                        },
                        onDecrease = { itm ->
                            val current = cartItems.toMutableList()
                            current.find { it == itm }?.let {
                                if (it.quantity > 1) it.quantity -= 1 else current.remove(it)
                            }
                            cartItems = current
                        },
                        onRemove = { itm ->
                            val current = cartItems.toMutableList()
                            current.remove(itm)
                            cartItems = current
                        },
                        onCheckout = {
                            if (currentUser?.role != "customer") {
                                Toast.makeText(context, "سجّل الدخول بحساب عميل لإتمام الطلب", Toast.LENGTH_LONG).show()
                                currentTab = MainTab.PROFILE
                                showAuthDialog = currentUser == null
                            } else {
                                showCheckout = true
                            }
                        }
                    )
                }

                MainTab.ORDERS -> {
                    if (currentUser == null) {
                        Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                            Button(onClick = { showAuthDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy)) {
                                Text("سجّل الدخول لعرض طلباتك")
                            }
                        }
                    } else {
                        NativeOrdersView(
                            orders = orders,
                            onRefresh = { loadData() },
                            busyOrderId = busyOrderId,
                            onPay = { order ->
                                scope.launch {
                                    busyOrderId = order.id
                                    try {
                                        val start = client.startPayment(order.id)
                                        val url = start.checkoutUrl
                                        if (url != null) {
                                            // Tap hosts the card page in the browser; the order updates here once Tap confirms.
                                            context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
                                            Toast.makeText(context, "بعد إتمام الدفع ارجع هنا واضغط تحديث", Toast.LENGTH_LONG).show()
                                        } else {
                                            Toast.makeText(context, "تم الدفع التجريبي", Toast.LENGTH_SHORT).show()
                                        }
                                    } catch (e: Exception) {
                                        Toast.makeText(context, e.message ?: "تعذر بدء الدفع", Toast.LENGTH_LONG).show()
                                    } finally {
                                        busyOrderId = null
                                        loadData()
                                    }
                                }
                            },
                            onCancel = { order ->
                                scope.launch {
                                    busyOrderId = order.id
                                    try {
                                        client.transitionOrder(order.id, "cancelled")
                                        Toast.makeText(context, "أُلغي الطلب", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        Toast.makeText(context, e.message ?: "تعذر إلغاء الطلب", Toast.LENGTH_LONG).show()
                                    } finally {
                                        busyOrderId = null
                                        loadData()
                                    }
                                }
                            }
                        )
                    }
                }

                MainTab.PROFILE -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(20.dp)
                    ) {
                        Text("حسابي وإعدادات المنصة 👤", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(16.dp))

                        if (currentUser == null) {
                            // Guest / Not logged in
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = Color.White,
                                border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(20.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Icon(
                                        Icons.Default.AccountCircle,
                                        contentDescription = null,
                                        tint = PrimaryBurgundy,
                                        modifier = Modifier.size(56.dp)
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Text("أهلاً بك يا ضيفنا الكريم 🌿", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        "سجّل دخولك أو أنشئ حسابك لتتبع طلباتك، حفظ عناوينك في قرى ومراكز الدرب، والاستمتاع بأكلات بيوتنا الأصيلة.",
                                        fontSize = 12.sp,
                                        color = TextMuted,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.padding(horizontal = 8.dp)
                                    )
                                    Spacer(Modifier.height(14.dp))
                                    Button(
                                        onClick = { showAuthDialog = true },
                                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.fillMaxWidth().height(46.dp)
                                    ) {
                                        Icon(Icons.Default.Login, contentDescription = null, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Text("تسجيل الدخول / إنشاء حساب عميل", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                    }
                                }
                            }
                        } else {
                            // Authenticated User
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = Color.White,
                                border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(modifier = Modifier.padding(18.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(48.dp)
                                                .clip(CircleShape)
                                                .background(PrimaryBurgundy.copy(alpha = 0.12f)),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Text(
                                                currentUser!!.name.take(1),
                                                color = PrimaryBurgundy,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 20.sp
                                            )
                                        }
                                        Spacer(Modifier.width(12.dp))
                                        Column {
                                            Text(currentUser!!.name, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                            Text(currentUser!!.email, fontSize = 13.sp, color = TextMuted)
                                        }
                                        Spacer(Modifier.weight(1f))
                                        Surface(
                                            color = Color(0xFFE8F5E9),
                                            shape = RoundedCornerShape(12.dp),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFA5D6A7))
                                        ) {
                                            Text(
                                                when (currentUser!!.role) {
                                                    "seller" -> "حساب أسرة"
                                                    "driver" -> "حساب كابتن"
                                                    "admin" -> "حساب إدارة"
                                                    else -> "حساب عميل"
                                                },
                                                fontSize = 11.sp,
                                                color = Color(0xFF2E7D32),
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    }
                                    HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp), color = BorderSubtle)
                                    Text("الموقع الافتراضي: $selectedVillage - محافظة الدرب", fontSize = 13.sp, color = TextDark)
                                    Spacer(Modifier.height(4.dp))
                                    Spacer(Modifier.height(14.dp))
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                client.logout()
                                                saveUserSession(null)
                                                Toast.makeText(context, "تم تسجيل الخروج بنجاح", Toast.LENGTH_SHORT).show()
                                            }
                                        },
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFFCDD2)),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Icon(Icons.Default.Logout, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("تسجيل الخروج", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(20.dp))
                        Text("التبديل لأدوار المنصة الأخرى:", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Spacer(Modifier.height(10.dp))

                        // Switch to Kitchen Mode
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    appMode = AppMode.KITCHEN
                                    Toast.makeText(context, "تم التحويل إلى وضع مطبخ الأسرة 🍳", Toast.LENGTH_SHORT).show()
                                },
                            shape = RoundedCornerShape(12.dp),
                            color = Color(0xFFFFF3E0),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFFB74D))
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.Restaurant, contentDescription = null, tint = Color(0xFFE65100))
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text("وضع مطبخ الأسرة المنتجة", fontWeight = FontWeight.Bold, color = Color(0xFFE65100))
                                    Text("إدارة وقبول طلبات المطبخ، والتسليم برمز الاستلام", fontSize = 11.sp, color = TextDark)
                                }
                            }
                        }

                        Spacer(Modifier.height(12.dp))

                        // Switch to Driver Mode
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    context.startActivity(Intent(context, DriverActivity::class.java))
                                },
                            shape = RoundedCornerShape(12.dp),
                            color = PrimaryBurgundy,
                            border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBurgundy)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.TwoWheeler, contentDescription = null, tint = Color.White)
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text("وضع كابتن التوصيل (Radar)", fontWeight = FontWeight.Bold, color = Color.White)
                                    Text("استلام الطلبات الجاهزة من المطبخ وتوصيلها لمنازل الدرب", fontSize = 11.sp, color = Color.White.copy(alpha = 0.8f))
                                }
                            }
                        }
                    }
                }
            }

            // Mature Detail & Customization Bottom Sheet / Dialog
            if (selectedProductForDetail != null) {
                val prod = selectedProductForDetail!!
                // The price the platform will charge: base price plus the chosen option's delta.
                val calculatedPrice = (prod.price + (detailOption?.priceDiff ?: 0)) * detailQuantity
                val calculatedSar = String.format(Locale.US, "%.2f", calculatedPrice / 100.0)

                AlertDialog(
                    onDismissRequest = { selectedProductForDetail = null },
                    confirmButton = {
                        Button(
                            onClick = {
                                // Spice level and free text are not priced options; they reach the family in the order chat.
                                val note = listOfNotNull(
                                    detailSpicy.takeIf { it != "عادي" },
                                    detailCustomNote.trim().takeIf { it.isNotEmpty() }
                                ).joinToString(" • ")
                                addToCart(prod, detailQuantity, detailOption, note)
                                selectedProductForDetail = null
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("إضافة للسلة • $calculatedSar ر.س")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { selectedProductForDetail = null }) {
                            Text("إلغاء", color = TextMuted)
                        }
                    },
                    title = {
                        Text(prod.name, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    },
                    text = {
                        Column {
                            Text(
                                "المطبخ: ${prod.householdName}",
                                style = MaterialTheme.typography.bodySmall,
                                color = AccentGold,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(prod.description, fontSize = 12.sp, color = TextDark)
                            Spacer(Modifier.height(10.dp))

                            HorizontalDivider(color = BorderSubtle)
                            Spacer(Modifier.height(8.dp))

                            if (prod.options.isNotEmpty()) {
                                Text("اختر الخيار:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                    prod.options.forEach { option ->
                                        FilterChip(
                                            selected = detailOption?.id == option.id,
                                            onClick = { detailOption = option },
                                            label = {
                                                Text(
                                                    option.name + if (option.priceDiff != 0) " (${if (option.priceDiff > 0) "+" else ""}${halalasToSar(option.priceDiff)} ر.س)" else ""
                                                )
                                            }
                                        )
                                    }
                                }
                            }

                            // Flavor Choice
                            Spacer(Modifier.height(4.dp))
                            Text("مستوى الحرارة (يصل للأسرة كملاحظة):", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                FilterChip(
                                    selected = detailSpicy == "عادي",
                                    onClick = { detailSpicy = "عادي" },
                                    label = { Text("عادي") }
                                )
                                FilterChip(
                                    selected = detailSpicy == "حار تهامي 🌶️",
                                    onClick = { detailSpicy = "حار تهامي 🌶️" },
                                    label = { Text("حار 🌶️") }
                                )
                            }

                            // Custom cooking note
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(
                                value = detailCustomNote,
                                onValueChange = { detailCustomNote = it },
                                label = { Text("ملاحظتك لمطبخ الأسرة (اختياري)", fontSize = 11.sp) },
                                placeholder = { Text("مثال: بدون بصل، سمن زيادة...", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )

                            // Quantity Stepper
                            Spacer(Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("الكمية المطلوبة:", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(
                                        onClick = { if (detailQuantity > 1) detailQuantity -= 1 },
                                        modifier = Modifier.size(32.dp)
                                    ) {
                                        Icon(Icons.Default.RemoveCircleOutline, contentDescription = null, tint = PrimaryBurgundy)
                                    }
                                    Text("$detailQuantity", fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(horizontal = 8.dp))
                                    IconButton(
                                        onClick = { detailQuantity += 1 },
                                        modifier = Modifier.size(32.dp)
                                    ) {
                                        Icon(Icons.Default.AddCircle, contentDescription = null, tint = PrimaryBurgundy)
                                    }
                                }
                            }
                        }
                    }
                )
            }

            if (showCheckout) {
                NativeCheckoutDialog(
                    client = client,
                    cart = cartItems,
                    defaultAddress = "$selectedVillage، محافظة الدرب - ",
                    onDismiss = { showCheckout = false },
                    onPlaced = { _, notesSent ->
                        showCheckout = false
                        cartItems = emptyList()
                        currentTab = MainTab.ORDERS
                        Toast.makeText(
                            context,
                            if (notesSent) "أُرسل طلبك للأسرة؛ يظهر زر الدفع بعد موافقتها" else "أُرسل طلبك، لكن تعذر إرسال ملاحظاتك؛ اكتبها في محادثة الطلب",
                            Toast.LENGTH_LONG
                        ).show()
                        loadData()
                    }
                )
            }

            if (showAuthDialog) {
                AuthDialog(
                    isOpen = showAuthDialog,
                    onDismiss = { showAuthDialog = false },
                    onSuccess = { user ->
                        saveUserSession(user)
                        showAuthDialog = false
                        Toast.makeText(context, "مرحباً بك يا ${user.name}! تم تسجيل الدخول بنجاح ✓", Toast.LENGTH_LONG).show()
                        loadData()
                    },
                    client = client
                )
            }
        }
    }
}

@Composable
fun AuthDialog(
    isOpen: Boolean,
    onDismiss: () -> Unit,
    onSuccess: (UserProfile) -> Unit,
    client: PlatformClient
) {
    if (!isOpen) return

    val scope = rememberCoroutineScope()
    var isRegisterMode by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (isRegisterMode) "إنشاء حساب عميل جديد 🌿" else "تسجيل الدخول إلى من بيوتنا 🔑",
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleMedium
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                // Tab Switcher
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFFF1EAE5))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    Text(
                        "تسجيل الدخول",
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (!isRegisterMode) PrimaryBurgundy else Color.Transparent)
                            .clickable { isRegisterMode = false; errorMessage = null }
                            .padding(vertical = 8.dp),
                        color = if (!isRegisterMode) Color.White else TextDark,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        fontSize = 13.sp
                    )
                    Text(
                        "حساب جديد",
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isRegisterMode) PrimaryBurgundy else Color.Transparent)
                            .clickable { isRegisterMode = true; errorMessage = null }
                            .padding(vertical = 8.dp),
                        color = if (isRegisterMode) Color.White else TextDark,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        fontSize = 13.sp
                    )
                }

                Spacer(Modifier.height(14.dp))

                if (isRegisterMode) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("الاسم الكامل") },
                        placeholder = { Text("مثال: عبد الله الدرباوي") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp)
                    )
                    Spacer(Modifier.height(10.dp))
                }

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكتروني") },
                    placeholder = { Text("name@example.com") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )

                Spacer(Modifier.height(10.dp))

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("كلمة المرور") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                    shape = RoundedCornerShape(10.dp)
                )

                if (errorMessage != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        errorMessage!!,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (email.isBlank() || password.isBlank() || (isRegisterMode && name.isBlank())) {
                        errorMessage = "يرجى تعبئة كافة الحقول المطلوبة"
                        return@Button
                    }
                    scope.launch {
                        loading = true
                        errorMessage = null
                        try {
                            val user = if (isRegisterMode) {
                                client.register(name = name, email = email, pass = password, role = "customer")
                            } else {
                                client.login(email = email, pass = password)
                            }
                            onSuccess(user)
                        } catch (e: Exception) {
                            errorMessage = e.message ?: "فشل تسجيل الدخول، يرجى المحاولة لاحقاً"
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading,
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBurgundy),
                shape = RoundedCornerShape(8.dp)
            ) {
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text(if (isRegisterMode) "إنشاء الحساب ✓" else "دخول 🔑", fontWeight = FontWeight.Bold)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("إلغاء", color = TextMuted)
            }
        }
    )
}
