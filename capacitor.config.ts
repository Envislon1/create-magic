import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.f671bae2951b478b9a3af980feddb1bf',
  appName: 'Mind Buddy',
  // Tiny static shell — the real UI is served from `server.url` below.
  // Keep this as mobile-shell for preview-based Android builds; do not use dist/client here.
  webDir: 'mobile-shell',
  server: {
    // Loads the live Lovable preview so the Android app stays in sync with web edits.
    // For an offline/production APK, remove `server` and run a static build into `dist/`.
    url: 'https://f671bae2-951b-478b-9a3a-f980feddb1bf.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#10b981',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
