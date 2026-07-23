# Build the Android app (Capacitor)

This project ships with a Capacitor config so you can wrap the Mind Buddy webapp as a
native Android app. The setup uses **hot-reload from the Lovable preview** by
default, so any change you publish on Lovable shows up in the app immediately.

## One-time setup (on your laptop)

Requirements: Node 18+, Android Studio (with an emulator or a USB device in
developer mode), and Java 17.

```bash
# 1. Clone your project from GitHub (use the "Export to GitHub" button in Lovable)
git clone <your-repo-url>
cd <your-repo>

# 2. Install deps
npm install   # or: bun install

# 3. Add the Android native project (only the first time)
npx cap add android

# 4. Sync the tiny mobile shell into the native project
npm run android:sync
```

## Run on a device / emulator

```bash
npm run android:run
```

…or open the project in Android Studio and press ▶️:

```bash
npm run android:open
```

## After every Lovable change

Because `capacitor.config.ts` points `server.url` at the Lovable preview, you
**don't need to rebuild the app** for content changes — just reload it.
You only need to re-run these when you change native config / plugins:

```bash
npm run android:sync
```

## If Capacitor still looks for `dist/client`

That means your local checkout still has the old config. Pull the latest files,
then run:

```powershell
npm install
Remove-Item -Recurse -Force android
npx cap add android
npm run android:sync
npm run android:run
```

Make sure `capacitor.config.ts` contains `webDir: 'mobile-shell'` before running
the commands above.

## Ship a standalone APK (no live reload)

When you're ready to publish to the Play Store, remove the `server` block in
`capacitor.config.ts` so the app bundles the built assets:

```ts
const config: CapacitorConfig = {
  appId: 'app.lovable.f671bae2951b478b9a3af980feddb1bf',
  appName: 'Mind Buddy',
  webDir: 'dist/client',
  // no `server` block -> uses the bundled web build
};
```

Then:

```bash
npm run build
npx cap sync android
npx cap open android   # then Build > Generate Signed Bundle / APK
```

> Note: the web app currently uses TanStack Start SSR. For a fully offline APK
> you'll want to switch the build to a static SPA output (or keep `server.url`
> pointed at your published Lovable URL — that path works today).

## Permissions already wired

The Capacitor config enables:
- **Local Notifications** — for medication / SOS alerts in the tray
- **Push Notifications** — for caregiver alerts
- **Status Bar / Keyboard / Haptics / Preferences / App** — standard UX plugins

For a deeper walk-through, see Lovable's mobile guide:
<https://lovable.dev/blogs/TODO>
