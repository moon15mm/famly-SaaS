# Proguard / R8 rules for Min Buyutna Release

# Keep Compose
-keepclassmembers class * extends androidx.compose.ui.Modifier { *; }

# Keep data models serialized by Moshi / JSON
-keepclassmembers class sa.minbuyutna.app.** {
    public <fields>;
}

# AndroidX Core & Lifecycle
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Allow obfuscation/optimization of standard classes
