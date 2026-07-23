// Canonical app host used by generated links and metadata while the custom
// domain is reserved for redirect-only flows.
export const MIND_BUDDY_APP_URL = "https://project--daac2a82-3355-4dd7-93da-22ad41b4e882.lovable.app";
export const MIND_BUDDY_REDIRECT_URL = "https://mindbuddy.ai";

export function authRedirectUrl(path = "/") {
  // Prefer the live production domain so confirmation emails always send
  // users to the canonical URL. Fall back to window.location.origin in local dev.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host.endsWith(".lovable.app") || host.endsWith(".lovableproject.com")) {
      return `${window.location.origin}${path}`;
    }
  }
  return `${MIND_BUDDY_REDIRECT_URL}${path}`;
}
