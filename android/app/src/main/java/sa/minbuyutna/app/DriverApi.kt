package sa.minbuyutna.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class ApiException(val status: Int, message: String) : Exception(message)

data class Account(val role: String, val name: String)

data class Summary(
    val name: String,
    val verified: Boolean,
    val available: Boolean,
    val activeTripId: String?,
    val activeTripStatus: String?,
    val deliveredTrips: Int,
    val declaredFees: Int,
    val complete: Boolean,
    val missing: List<String>,
)

data class Offer(val id: String, val city: String, val scheduledAt: String, val fee: Int, val expiresAt: String, val distanceKm: Double?)

data class TripItem(val name: String, val quantity: Int, val option: String)

data class Trip(
    val id: String,
    val status: String,
    val fee: Int,
    val scheduledAt: String,
    val householdName: String,
    val pickupAddress: String,
    val pickupLatitude: Double?,
    val pickupLongitude: Double?,
    val address: String,
    val latitude: Double?,
    val longitude: Double?,
    val items: List<TripItem>,
)

data class PastTrip(val id: String, val household: String, val status: String, val fee: Int, val scheduledAt: String)

data class Notice(val message: String, val read: Boolean, val createdAt: String)

data class ContractInfo(val id: String, val version: Int, val title: String, val body: String, val accepted: Boolean, val acceptedAt: String)

data class Requirement(
    val id: String,
    val title: String,
    val description: String,
    val required: Boolean,
    val needsExpiry: Boolean,
    val state: String,
    val expiresOn: String,
    val note: String,
)

data class Compliance(val complete: Boolean, val missing: List<String>, val contract: ContractInfo?, val documents: List<Requirement>)

private fun JSONObject.text(name: String): String = if (isNull(name)) "" else optString(name, "")

private fun JSONObject.decimal(name: String): Double? = if (isNull(name)) null else optDouble(name).takeIf { !it.isNaN() }

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

private fun JSONArray?.texts(): List<String> = if (this == null) emptyList() else (0 until length()).map { getString(it) }

/** The platform API with the driver's session cookie; the same origin and CSRF rules as the website. */
class DriverApi(private val origin: String, private val token: () -> String?) {
    class Reply(val text: String, val cookies: List<String>)

    class Upload(val name: String, val mime: String, val bytes: ByteArray)

    /** Blocking request; the suspend helpers below run it on the IO dispatcher. */
    fun send(method: String, path: String, json: JSONObject? = null, upload: Upload? = null): Reply {
        val connection = try {
            URL("$origin/api$path").openConnection() as HttpURLConnection
        } catch (error: IOException) {
            throw offline()
        }
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            // The API accepts state changes only from its own origin, as it does for the website.
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("User-Agent", "MinBuyutnaDriver/" + BuildConfig.VERSION_NAME)
            token()?.let { connection.setRequestProperty("Cookie", "session=$it") }
            val body = when {
                upload != null -> multipart(connection, upload)
                json != null -> {
                    connection.setRequestProperty("Content-Type", "application/json")
                    json.toString().toByteArray()
                }
                method == "POST" -> ByteArray(0)
                else -> null
            }
            if (body != null) {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status >= 400) throw ApiException(status, detail(text, status))
            val cookies = connection.headerFields.filterKeys { it != null && it.equals("set-cookie", ignoreCase = true) }.values.flatten()
            return Reply(text, cookies)
        } catch (error: IOException) {
            throw offline()
        } finally {
            connection.disconnect()
        }
    }

    private fun multipart(connection: HttpURLConnection, upload: Upload): ByteArray {
        val boundary = "MinBuyutna" + System.nanoTime()
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${upload.name}\"\r\n" +
            "Content-Type: ${upload.mime}\r\n\r\n"
        return head.toByteArray() + upload.bytes + "\r\n--$boundary--\r\n".toByteArray()
    }

    private fun detail(text: String, status: Int): String {
        val parsed = try {
            JSONObject(text).optString("detail", "")
        } catch (error: Exception) {
            ""
        }
        return parsed.ifBlank {
            when {
                status == 401 -> "انتهت الجلسة؛ يلزم تسجيل الدخول من جديد"
                status == 429 -> "طلبات كثيرة؛ حاول بعد قليل"
                status >= 500 -> "تعذر إكمال الطلب لدى الخادم؛ حاول لاحقًا"
                else -> "تحقق من البيانات وحاول مجددًا"
            }
        }
    }

    private fun offline() = ApiException(0, "تعذر الاتصال بالمنصة؛ تحقق من الإنترنت")

    private suspend fun get(path: String): String = withContext(Dispatchers.IO) { send("GET", path).text }

    private suspend fun post(path: String, json: JSONObject? = null): String = withContext(Dispatchers.IO) { send("POST", path, json).text }

    /** Signs in and returns the new session token from the response cookie. */
    suspend fun login(email: String, password: String): String = withContext(Dispatchers.IO) {
        val reply = send("POST", "/auth/login", JSONObject().put("email", email).put("password", password))
        reply.cookies.firstNotNullOfOrNull { Driving.sessionCookie(it) } ?: throw ApiException(0, "لم تُنشأ جلسة؛ حاول مجددًا")
    }

    suspend fun me(): Account = JSONObject(get("/auth/me")).let { Account(it.text("role"), it.text("name")) }

    suspend fun logout() {
        post("/auth/logout")
    }

    suspend fun summary(): Summary = JSONObject(get("/driver/summary")).let { json ->
        val trip = json.optJSONObject("active_trip")
        Summary(
            name = json.text("name"),
            verified = json.optBoolean("driver_verified"),
            available = json.optBoolean("available"),
            activeTripId = trip?.text("id"),
            activeTripStatus = trip?.text("status"),
            deliveredTrips = json.optInt("delivered_trips"),
            declaredFees = json.optInt("declared_fees"),
            complete = json.optJSONObject("compliance")?.optBoolean("complete", true) ?: true,
            missing = json.optJSONObject("compliance")?.optJSONArray("missing").texts(),
        )
    }

    suspend fun availability(on: Boolean) {
        post("/driver/availability?available=$on")
    }

    suspend fun offers(): List<Offer> = JSONArray(get("/driver/offers")).objects().map {
        Offer(it.text("id"), it.text("city"), it.text("scheduled_at"), it.optInt("fee"), it.text("expires_at"), it.decimal("distance_km"))
    }

    suspend fun accept(id: String) {
        post("/driver/offers/$id/accept")
    }

    suspend fun reject(id: String) {
        post("/driver/offers/$id/reject")
    }

    suspend fun trip(id: String): Trip = JSONObject(get("/driver/trips/$id")).let { json ->
        Trip(
            id = json.text("id"),
            status = json.text("status"),
            fee = json.optInt("fee"),
            scheduledAt = json.text("scheduled_at"),
            householdName = json.text("household_name"),
            pickupAddress = json.text("pickup_address"),
            pickupLatitude = json.decimal("pickup_latitude"),
            pickupLongitude = json.decimal("pickup_longitude"),
            address = json.text("address"),
            latitude = json.decimal("latitude"),
            longitude = json.decimal("longitude"),
            items = (json.optJSONArray("items") ?: JSONArray()).objects().map {
                TripItem(it.text("name"), it.optInt("quantity"), it.text("option_label"))
            },
        )
    }

    suspend fun advance(id: String, state: String, code: String) {
        post("/driver/trips/$id/transition?state=$state&code=" + URLEncoder.encode(code, "UTF-8"))
    }

    suspend fun issue(id: String, reason: String) {
        post("/driver/trips/$id/issue", JSONObject().put("reason", reason))
    }

    suspend fun location(latitude: Double, longitude: Double, accuracy: Float?) {
        val json = JSONObject().put("latitude", latitude).put("longitude", longitude)
        if (accuracy != null) json.put("accuracy", accuracy.toDouble())
        post("/driver/location", json)
    }

    suspend fun history(): List<PastTrip> = JSONArray(get("/orders")).objects().map {
        PastTrip(it.text("id"), it.text("household_name"), it.text("status"), it.optInt("delivery_fee"), it.text("scheduled_at"))
    }

    suspend fun notices(): List<Notice> = JSONArray(get("/notifications")).objects().map {
        Notice(it.text("message"), it.optBoolean("read"), it.text("created_at"))
    }

    suspend fun markRead() {
        post("/notifications/read")
    }

    suspend fun compliance(): Compliance = JSONObject(get("/compliance")).let { json ->
        val contract = json.optJSONObject("contract")
        Compliance(
            complete = json.optBoolean("complete"),
            missing = json.optJSONArray("missing").texts(),
            contract = contract?.let {
                ContractInfo(it.text("id"), it.optInt("version"), it.text("title"), it.text("body"), it.optBoolean("accepted"), it.text("accepted_at"))
            },
            documents = (json.optJSONArray("documents") ?: JSONArray()).objects().map {
                Requirement(
                    id = it.text("id"),
                    title = it.text("title"),
                    description = it.text("description"),
                    required = it.optBoolean("required"),
                    needsExpiry = it.optBoolean("needs_expiry"),
                    state = it.text("state"),
                    expiresOn = it.text("expires_on"),
                    note = it.text("note"),
                )
            },
        )
    }

    suspend fun acceptContract(contractId: String, fullName: String) {
        post("/compliance/contract", JSONObject().put("contract_id", contractId).put("full_name", fullName).put("agree", true))
    }

    /** Uploads a required document; [expiresOn] is an ISO date for documents that expire. */
    suspend fun uploadRequirement(requirementId: String, expiresOn: String?, file: Upload) {
        val query = "requirement_id=" + URLEncoder.encode(requirementId, "UTF-8") +
            if (expiresOn != null) "&expires_on=" + URLEncoder.encode(expiresOn, "UTF-8") else ""
        withContext(Dispatchers.IO) { send("POST", "/verification/documents?$query", upload = file) }
    }
}
