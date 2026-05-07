export const PROD_OVERRIDE = true // Set to true to force production settings even in development environment

const IS_DEV = process.env.APP_VARIANT === "development"

export default {
  name: IS_DEV && !PROD_OVERRIDE ? "random-minder (Dev)" : "random-minder",
  slug: "mindfull-minder",
  platforms: ["ios", "android"],
  version: "1.0.0",
  orientation: "portrait",
  icon: IS_DEV ? "./assets/images/icon.dev.png" : "./assets/images/icon.png",
  scheme: "randomminder",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier:
      IS_DEV && !PROD_OVERRIDE ? "com.randomminder.dev" : "com.randomminder",
    infoPlist: {
      UIBackgroundModes: ["fetch"],
      NSUserNotificationsUsageDescription:
        "Mindfull Minder sends gentle reminders throughout your day to help you check in with yourself, build habits, and reflect on your wellbeing.",
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: IS_DEV
        ? "./assets/images/android-icon-foreground.dev.png"
        : "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package:
      IS_DEV && !PROD_OVERRIDE ? "com.randomminder.dev" : "com.randomminder",
    permissions: [
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.WAKE_LOCK",
      "android.permission.POST_NOTIFICATIONS",
    ],
  },
  plugins: [
    "expo-router",
    "expo-background-fetch",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    "expo-web-browser",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "deaf59fa-fe50-41fa-bb04-becca07324cb",
    },
  },
  owner: "kncbricks",
}
