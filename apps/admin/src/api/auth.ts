import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser sign-in against Supabase Auth, shared by client workbench and admin portal.
 * Configuration is fetched dynamically from GET /api/config.
 */
let supabase: SupabaseClient | null = null;
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function isOwnApiUrl(raw: string, apiOrigin: string): boolean {
  try {
    const u = new URL(raw, window.location.href);
    return (
      u.pathname.startsWith("/api/") &&
      (u.origin === apiOrigin || u.origin === window.location.origin)
    );
  } catch {
    return false;
  }
}

export function installAuthFetch(getApiUrl: (path: string) => string = (p) => p): void {
  const w = window as unknown as { __authFetchInstalled?: boolean };
  if (w.__authFetchInstalled) return;
  w.__authFetchInstalled = true;
  const apiOrigin = new URL(getApiUrl("/"), window.location.href).origin;
  const original = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!isOwnApiUrl(url, apiOrigin)) return original(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (accessToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${accessToken}`);
    }
    return original(input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "same-origin",
    });
  };
}

/** Call once before first render. Resolves when current session is known. */
export async function initAuth(
  getApiUrl: (path: string) => string = (p) => p,
): Promise<{ requireLogin: boolean; authenticated: boolean }> {
  installAuthFetch(getApiUrl);
  if (supabase) {
    return {
      requireLogin: true,
      authenticated: Boolean(accessToken),
    };
  }

  const res = await fetch(getApiUrl("/api/config"));
  if (!res.ok) {
    throw new Error("Could not load sign-in configuration from /api/config");
  }
  const cfg = (await res.json()) as {
    supabaseUrl?: string;
    supabasePublishableKey?: string;
    requireLogin?: boolean;
  };

  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
    return {
      requireLogin: Boolean(cfg.requireLogin),
      authenticated: false,
    };
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    accessToken = session?.access_token ?? null;
    listeners.forEach((fn) => fn());
  });

  const { data } = await supabase.auth.getSession();
  accessToken = data.session?.access_token ?? null;

  return {
    requireLogin: Boolean(cfg.requireLogin),
    authenticated: Boolean(accessToken),
  };
}

export function getCachedAccessToken(): string | null {
  return accessToken;
}

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function client(): SupabaseClient {
  if (!supabase) throw new Error("initAuth() has not completed");
  return supabase;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
  accessToken = null;
}
