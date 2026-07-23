// Helpers to trigger native Android tray notifications via the service worker.
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}

export async function showSosNotification(body: string, id?: string) {
  if (!(await ensureNotificationPermission())) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "SHOW_SOS_NOTIFICATION", body, id });
}

export async function showNotification(title: string, body: string, tag?: string) {
  if (!(await ensureNotificationPermission())) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "SHOW_NOTIFICATION", title, body, tag });
}

export async function showMedicationNotification(body: string, tag?: string) {
  if (!(await ensureNotificationPermission())) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "SHOW_MEDICATION_NOTIFICATION", body, tag });
}


export async function showChatNotification(title: string, body: string, id?: string) {
  if (!(await ensureNotificationPermission())) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "SHOW_CHAT_NOTIFICATION", title, body, id });
}

export function openNotificationSettings() {
  if (typeof window === "undefined") return;

  const isAndroid = /android/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = "intent://settings#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;end";
    return;
  }

  window.open(
    "https://support.google.com/chrome/answer/3220216",
    "_blank",
    "noopener,noreferrer",
  );
}