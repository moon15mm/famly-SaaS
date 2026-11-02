# The app uses no reflection-based serialization; org.json and Compose ship their own rules.
# Keep line numbers for readable crash reports in Play Console, but hide the original file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
# Strip verbose logging from release builds.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
