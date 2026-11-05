package sa.minbuyutna.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/** What the platform returns for a checkout before the order is placed. */
data class CheckoutQuote(
    val subtotal: Int,
    val deliveryFee: Int,
    val serviceFee: Int,
    val total: Int,
    val breakdown: String?
)

/** One way to pay an order: a Tap page to open, or a completed simulation in test mode. */
data class PaymentStart(val checkoutUrl: String?, val simulated: Boolean)

/**
 * REST client for customers and families. Every price, state and permission comes from the platform;
 * nothing here invents data when a request fails.
 */
class PlatformClient(
    private val origin: String = BuildConfig.PLATFORM_URL,
    private val tokenProvider: () -> String? = { null }
) {
    var activeSessionToken: String? = null
    private var paymentProvider: String? = null

    class Response(val statusCode: Int, val body: String, val headers: Map<String, List<String>> = emptyMap())

    private fun request(
        method: String,
        endpoint: String,
        jsonBody: JSONObject? = null
    ): Response {
        val fullUrl = "$origin/api$endpoint"
        val conn = try {
            URL(fullUrl).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw ApiException(0, "تعذر الاتصال بالخادم، تأكد من اتصال الإنترنت")
        }

        try {
            conn.requestMethod = method
            conn.connectTimeout = 12_000
            conn.readTimeout = 20_000
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Origin", origin)
            conn.setRequestProperty("User-Agent", "MinBuyutnaNativeAndroid/${BuildConfig.VERSION_NAME}")

            val token = tokenProvider() ?: activeSessionToken
            token?.let {
                conn.setRequestProperty("Cookie", "session=$it")
            }

            if (jsonBody != null) {
                conn.setRequestProperty("Content-Type", "application/json")
                val bytes = jsonBody.toString().toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            } else if (method == "POST" || method == "PUT") {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(0)
            }

            val code = try {
                conn.responseCode
            } catch (e: IOException) {
                throw ApiException(0, "تعذر الاتصال بالخادم، تأكد من اتصال الإنترنت")
            }
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (code !in 200..299) {
                var errorDetail = "حدث خطأ غير متوقع ($code)"
                try {
                    val errorJson = JSONObject(text)
                    if (errorJson.has("detail")) {
                        errorDetail = errorJson.getString("detail")
                    }
                } catch (_: Exception) {}
                throw ApiException(code, errorDetail)
            }

            val headers = conn.headerFields ?: emptyMap()
            return Response(code, text, headers)
        } finally {
            conn.disconnect()
        }
    }

    private fun extractSessionCookie(headers: Map<String, List<String>>): String? {
        // HttpURLConnection keeps the server's header casing (and a null key for the status line).
        val cookies = headers.entries.firstOrNull { it.key.equals("Set-Cookie", ignoreCase = true) }?.value ?: return null
        for (cookie in cookies) {
            for (part in cookie.split(";")) {
                val trimmed = part.trim()
                if (trimmed.startsWith("session=")) {
                    return trimmed.substring("session=".length)
                }
            }
        }
        return null
    }

    private fun profile(json: JSONObject, fallbackRole: String) = UserProfile(
        id = json.getString("id"),
        name = json.getString("name"),
        email = json.getString("email"),
        role = json.optString("role", fallbackRole),
        sessionToken = activeSessionToken
    )

    suspend fun login(email: String, pass: String): UserProfile = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("email", email.trim())
            put("password", pass)
        }
        val res = request("POST", "/auth/login", body)
        extractSessionCookie(res.headers)?.let { activeSessionToken = it }
        profile(JSONObject(res.body), "customer")
    }

    suspend fun register(name: String, email: String, pass: String, role: String = "customer"): UserProfile = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("name", name.trim())
            put("email", email.trim())
            put("password", pass)
            put("role", role)
        }
        val res = request("POST", "/auth/register", body)
        extractSessionCookie(res.headers)?.let { activeSessionToken = it }
        profile(JSONObject(res.body), role)
    }

    suspend fun getMe(): UserProfile? = withContext(Dispatchers.IO) {
        try {
            profile(JSONObject(request("GET", "/auth/me").body), "customer")
        } catch (_: Exception) {
            null
        }
    }

    suspend fun logout(): Unit = withContext(Dispatchers.IO) {
        try {
            request("POST", "/auth/logout")
        } catch (_: Exception) {}
        activeSessionToken = null
    }

    suspend fun getCatalog(category: String? = null, q: String? = null): List<NativeProduct> = withContext(Dispatchers.IO) {
        val params = mutableListOf<String>()
        category?.let { if (it.isNotEmpty() && it != "all") params.add("category=${URLEncoder.encode(it, "UTF-8")}") }
        q?.let { if (it.isNotEmpty()) params.add("q=${URLEncoder.encode(it, "UTF-8")}") }
        val path = if (params.isEmpty()) "/products" else "/products?${params.joinToString("&")}"
        val arr = JSONObject(request("GET", path).body).optJSONArray("items") ?: JSONArray()
        (0 until arr.length()).map { index ->
            val item = arr.getJSONObject(index)
            val imgArr = item.optJSONArray("images") ?: JSONArray()
            val optArr = item.optJSONArray("options") ?: JSONArray()
            NativeProduct(
                id = item.getString("id"),
                householdId = item.optString("household_id", ""),
                householdName = item.optString("household_name", ""),
                name = item.getString("name"),
                description = item.optString("description", ""),
                price = item.optInt("price", 0),
                category = item.optString("category_id", "food"),
                images = (0 until imgArr.length()).map { imgArr.getString(it) },
                prepHours = item.optInt("prep_hours", 0),
                stock = item.optInt("stock", 0) > 0,
                city = item.optString("city", ""),
                options = (0 until optArr.length()).map {
                    val option = optArr.getJSONObject(it)
                    ProductOption(option.getString("id"), option.optString("name"), option.optInt("price_delta", 0))
                }
            )
        }
    }

    suspend fun getHouseholds(): List<HouseholdStore> = withContext(Dispatchers.IO) {
        val arr = JSONArray(request("GET", "/households").body)
        (0 until arr.length()).map { index ->
            val obj = arr.getJSONObject(index)
            HouseholdStore(
                id = obj.getString("id"),
                name = obj.getString("name"),
                city = obj.optString("city", ""),
                verified = obj.optBoolean("verified", true),
                description = obj.optString("description", ""),
                pickupAddress = ""
            )
        }
    }

    private fun JSONObject.optNullableString(key: String): String? {
        return if (has(key) && !isNull(key)) {
            val v = optString(key)
            if (v.isBlank() || v == "null") null else v
        } else null
    }

    /** Orders of the signed-in account: a customer's own, or a family's incoming orders. */
    suspend fun getMyOrders(): List<NativeOrder> = withContext(Dispatchers.IO) {
        val arr = JSONArray(request("GET", "/orders").body)
        (0 until arr.length()).map { index ->
            val obj = arr.getJSONObject(index)
            val itemsArr = obj.optJSONArray("items") ?: JSONArray()
            NativeOrder(
                id = obj.getString("id"),
                householdName = obj.optString("household_name", ""),
                status = obj.optString("status", "pending_acceptance"),
                subtotal = obj.optInt("subtotal", 0),
                deliveryFee = obj.optInt("delivery_fee", 0),
                total = obj.optInt("total", 0),
                scheduledAt = obj.optString("scheduled_at", ""),
                address = obj.optString("address", ""),
                items = (0 until itemsArr.length()).map {
                    val itm = itemsArr.getJSONObject(it)
                    NativeOrderItem(
                        name = itm.optString("name", ""),
                        quantity = itm.optInt("quantity", 1),
                        unitPrice = itm.optInt("unit_price", 0),
                        option = itm.optNullableString("option_label")
                    )
                },
                deliveryMethod = obj.optString("delivery_method", "pickup"),
                paymentStatus = obj.optString("payment_status", "unpaid"),
                serviceFee = obj.optInt("service_fee", 0),
                merchantFee = obj.optInt("merchant_fee", 0),
                merchantPayout = obj.optInt("merchant_payout", obj.optInt("subtotal", 0)),
                createdAt = obj.optString("created_at", ""),
                pickupAddress = obj.optNullableString("pickup_address")
            )
        }
    }

    private fun checkoutBody(
        cart: List<NativeCartItem>,
        deliveryMethod: String,
        address: String,
        scheduledAtIso: String,
        idempotencyKey: String,
        quotedTotal: Int?
    ) = JSONObject().apply {
        // The platform wants one line per product/option pair with the quantities summed.
        val lines = cart.groupBy { it.product.id to (it.optionId ?: "") }
        put("items", JSONArray().apply {
            lines.forEach { (key, items) ->
                put(JSONObject().apply {
                    put("product_id", key.first)
                    put("quantity", items.sumOf { it.quantity })
                    if (key.second.isNotEmpty()) put("option_id", key.second)
                })
            }
        })
        put("delivery_method", deliveryMethod)
        put("address", if (deliveryMethod == "pickup") "" else address.trim())
        put("scheduled_at", scheduledAtIso)
        put("idempotency_key", idempotencyKey)
        quotedTotal?.let { put("quoted_total", it) }
    }

    suspend fun quoteCheckout(
        cart: List<NativeCartItem>,
        deliveryMethod: String,
        address: String,
        scheduledAtIso: String
    ): CheckoutQuote = withContext(Dispatchers.IO) {
        val body = checkoutBody(cart, deliveryMethod, address, scheduledAtIso, "quote-" + UUID.randomUUID(), null)
        val json = JSONObject(request("POST", "/checkout/quote", body).body)
        CheckoutQuote(
            subtotal = json.optInt("subtotal"),
            deliveryFee = json.optInt("delivery_fee"),
            serviceFee = json.optInt("service_fee"),
            total = json.optInt("total"),
            breakdown = json.optJSONObject("quote")?.optNullableString("breakdown")
        )
    }

    /** Places the order at the quoted total; the platform refuses it if any price changed meanwhile. */
    suspend fun placeOrder(
        cart: List<NativeCartItem>,
        deliveryMethod: String,
        address: String,
        scheduledAtIso: String,
        quotedTotal: Int,
        idempotencyKey: String
    ): String = withContext(Dispatchers.IO) {
        val body = checkoutBody(cart, deliveryMethod, address, scheduledAtIso, idempotencyKey, quotedTotal)
        JSONObject(request("POST", "/orders", body).body).getString("id")
    }

    /** Notes the customer chose in the app reach the family through the order chat. */
    suspend fun sendOrderMessage(orderId: String, text: String): Unit = withContext(Dispatchers.IO) {
        request("POST", "/orders/$orderId/chat/messages", JSONObject().put("content", text.take(1500)))
        Unit
    }

    private fun provider(): String {
        paymentProvider?.let { return it }
        val value = JSONObject(request("GET", "/health").body).optString("payments", "disabled")
        paymentProvider = value
        return value
    }

    /** Starts payment after the family accepted: a Tap page in Tap mode, an immediate simulation in test mode. */
    suspend fun startPayment(orderId: String): PaymentStart = withContext(Dispatchers.IO) {
        when (provider()) {
            "tap" -> PaymentStart(JSONObject(request("POST", "/payments/tap/create/$orderId").body).getString("checkout_url"), false)
            "test" -> {
                request("POST", "/payments/test/$orderId")
                PaymentStart(null, true)
            }
            else -> throw ApiException(503, "الدفع غير مفعّل على المنصة حاليًا")
        }
    }

    suspend fun transitionOrder(orderId: String, state: String): Unit = withContext(Dispatchers.IO) {
        request("POST", "/orders/$orderId/transition?state=${URLEncoder.encode(state, "UTF-8")}")
        Unit
    }

    /** The signed-in family's store, as stored on the platform. */
    suspend fun getMyHousehold(): JSONObject = withContext(Dispatchers.IO) {
        JSONObject(request("GET", "/seller/household").body)
    }

    /** Pauses or resumes new orders by switching the store's vacation flag, keeping every other setting. */
    suspend fun setOnVacation(onVacation: Boolean): Unit = withContext(Dispatchers.IO) {
        val store = JSONObject(request("GET", "/seller/household").body)
        val body = JSONObject()
        for (key in listOf(
            "name", "description", "city", "pickup_address", "free_delivery", "delivery_enabled", "pickup_enabled",
            "opening_hour", "closing_hour", "slot_capacity", "pickup_latitude", "pickup_longitude"
        )) {
            body.put(key, if (store.isNull(key)) JSONObject.NULL else store.get(key))
        }
        body.put("on_vacation", onVacation)
        request("PUT", "/seller/household", body)
        Unit
    }
}
