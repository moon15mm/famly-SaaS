package sa.minbuyutna.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp

// --- Signature Palette ---
val PrimaryBurgundy = Color(0xFF663440)
val PrimaryBurgundyDark = Color(0xFF512630)
val AccentGold = Color(0xFFB88E58)
val AccentMint = Color(0xFF10B981)
val AccentMintDark = Color(0xFF059669)
val WarmSandBackground = Color(0xFFFCFAF7)
val CardBackground = Color(0xFFFFFFFF)
val TextDark = Color(0xFF1F2937)
val TextMuted = Color(0xFF6B7280)
val BorderSubtle = Color(0xFFE5E7EB)
val ErrorSoft = Color(0xFFEF4444)

// --- Arabic Font Family (Tajawal) ---
val TajawalFamily = FontFamily(
    Font(R.font.tajawal_regular, FontWeight.Normal),
    Font(R.font.tajawal_bold, FontWeight.Bold)
)

val NativeTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        color = TextDark
    ),
    headlineMedium = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        color = TextDark
    ),
    headlineSmall = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 17.sp,
        color = TextDark
    ),
    titleLarge = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        color = TextDark
    ),
    titleMedium = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        color = TextDark
    ),
    bodyLarge = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = TextDark
    ),
    bodyMedium = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        color = TextDark
    ),
    bodySmall = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        color = TextMuted
    ),
    labelLarge = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        color = Color.White
    ),
    labelMedium = TextStyle(
        fontFamily = TajawalFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        color = TextMuted
    )
)

private val LightColorScheme = lightColorScheme(
    primary = PrimaryBurgundy,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF7EFF1),
    onPrimaryContainer = PrimaryBurgundyDark,
    secondary = AccentGold,
    onSecondary = Color.White,
    tertiary = AccentMint,
    onTertiary = Color.White,
    background = WarmSandBackground,
    onBackground = TextDark,
    surface = CardBackground,
    onSurface = TextDark,
    surfaceVariant = Color(0xFFF9FAFB),
    onSurfaceVariant = TextMuted,
    outline = BorderSubtle
)

@Composable
fun NativeMinBuyutnaTheme(
    content: @Composable () -> Unit
) {
    // Always enforce Arabic RTL Direction by default across the entire app
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(
            colorScheme = LightColorScheme,
            typography = NativeTypography,
            content = content
        )
    }
}
