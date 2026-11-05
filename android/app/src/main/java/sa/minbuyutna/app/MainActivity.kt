package sa.minbuyutna.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

/**
 * 100% Native entry point for Min Buyutna Android Application.
 * Powered by Jetpack Compose Material 3 & Arabic RTL Architecture.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NativeMinBuyutnaTheme {
                MinBuyutnaApp()
            }
        }
    }
}
