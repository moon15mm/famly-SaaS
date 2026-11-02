package sa.minbuyutna.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The platform origin chosen in the app, shared with the web screens. */
object Platform {
    @JvmStatic
    fun origin(context: Context): String {
        // Store builds ignore any saved host: they only ever talk to the platform they were built for.
        val saved = if (BuildConfig.CUSTOM_ORIGIN) {
            context.getSharedPreferences("platform", Context.MODE_PRIVATE).getString("origin", null)
        } else {
            null
        }
        return try {
            EndpointPolicy.normalize(saved ?: BuildConfig.PLATFORM_URL, BuildConfig.DEBUG)
        } catch (error: IllegalArgumentException) {
            EndpointPolicy.normalize(BuildConfig.PLATFORM_URL, BuildConfig.DEBUG)
        }
    }
}

/** The driver's session token, encrypted with an Android Keystore key and bound to one platform origin. */
class DriverSession(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("driver-session", Context.MODE_PRIVATE)

    fun token(origin: String): String? =
        if (prefs.getString("origin", null) == origin) prefs.getString("token", null)?.let(::decrypt) else null

    fun name(): String = prefs.getString("name", null).orEmpty()

    fun save(origin: String, token: String, name: String) {
        prefs.edit().putString("origin", origin).putString("token", encrypt(token)).putString("name", name).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val ALIAS = "min-buyutna-driver-session"

        fun key(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            return generator.generateKey()
        }

        fun encrypt(value: String): String {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
        }

        fun decrypt(value: String): String? = try {
            val (iv, data) = value.split(":", limit = 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)))
        } catch (error: Exception) {
            null
        }
    }
}

/** Entry points for the Java WebView screen. */
object DriverLaunch {
    @JvmStatic
    fun hasSession(context: Context): Boolean = DriverSession(context).token(Platform.origin(context)) != null

    @JvmStatic
    fun sessionFromCookies(cookies: String?): String? = Driving.sessionCookie(cookies)

    /** Blocking; returns [role, name] for a valid session, or null. Call it off the main thread. */
    @JvmStatic
    fun account(origin: String, token: String): Array<String>? = try {
        val me = JSONObject(DriverApi(origin) { token }.send("GET", "/auth/me").text)
        arrayOf(me.optString("role"), me.optString("name"))
    } catch (error: Exception) {
        null
    }

    @JvmStatic
    fun remember(context: Context, origin: String, token: String, name: String) {
        DriverSession(context).save(origin, token, name)
    }

    @JvmStatic
    fun forget(context: Context) {
        DriverSession(context).clear()
    }
}
