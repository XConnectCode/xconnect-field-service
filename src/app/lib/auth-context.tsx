import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { supabase } from './supabase';

const API_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// When VITE_ENABLE_DEFAULT_ADMIN === 'true', the app auto-logs in a
// "default-admin" user on first load if no session exists. This is intended
// for local development/demo only; pilot and production builds should leave
// it unset so users land on /login.
const DEFAULT_ADMIN_ENABLED =
  import.meta.env.VITE_ENABLE_DEFAULT_ADMIN === 'true';

// Marker set on explicit sign-out so a subsequent reload doesn't silently
// re-create the default-admin session in dev builds.
const SIGNED_OUT_FLAG = 'signed_out';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'sqm';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  accessToken: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Derive our app User shape from a Supabase auth session. Google users may not
// have role/name set, so fall back to email-derived defaults. Default role is
// 'sqm' (least-privilege) — admins are promoted via Supabase user metadata.
function userFromSession(session: Session): User {
  const su = session.user;
  const meta = (su.user_metadata ?? {}) as Record<string, unknown>;
  const appMeta = (su.app_metadata ?? {}) as Record<string, unknown>;
  const role = (appMeta.role ?? meta.role) === 'admin' ? 'admin' : 'sqm';
  const name =
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (su.email ? su.email.split('@')[0] : 'User');
  return {
    id: su.id,
    email: su.email ?? '',
    name,
    role,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    initializeSession();

    // Bridge Supabase auth sessions (e.g., from Google OAuth redirects) into
    // our app's user/accessToken state. supabase-js parses the URL hash on
    // load and emits SIGNED_IN here.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const u = userFromSession(session);
        setUser(u);
        setAccessToken(session.access_token);
        localStorage.setItem('access_token', session.access_token);
        localStorage.setItem('user', JSON.stringify(u));
        localStorage.removeItem(SIGNED_OUT_FLAG);
      } else if (event === 'TOKEN_REFRESHED' && session) {
        setAccessToken(session.access_token);
        localStorage.setItem('access_token', session.access_token);
      } else if (event === 'SIGNED_OUT') {
        // Sign-out is driven through our signOut() below; nothing extra here.
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeSession = async () => {
    try {
      const storedToken = localStorage.getItem('access_token');
      const storedUser = localStorage.getItem('user');
      const signedOut = localStorage.getItem(SIGNED_OUT_FLAG) === 'true';

      // Clear invalid JWT tokens left over from previous sessions
      if (storedToken && storedToken.startsWith('eyJ') && storedToken.length > 100) {
        // A real Supabase OAuth session JWT also starts with 'eyJ'. Only
        // discard the stored token when there is no live Supabase session
        // backing it (legacy email/password tokens from before OAuth landed).
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          const u = userFromSession(sessionData.session);
          setAccessToken(sessionData.session.access_token);
          setUser(u);
          localStorage.setItem('access_token', sessionData.session.access_token);
          localStorage.setItem('user', JSON.stringify(u));
          return;
        }
        console.log('Clearing invalid JWT token from previous session');
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
      } else if (storedToken && storedUser) {
        setAccessToken(storedToken);
        setUser(JSON.parse(storedUser));
        return;
      }

      // No valid stored session. Only auto-login as default-admin when the
      // dev/demo flag is on AND the user has not explicitly signed out.
      if (DEFAULT_ADMIN_ENABLED && !signedOut) {
        const defaultUser: User = {
          id: 'default-admin',
          email: 'admin@fieldservice.local',
          name: 'Admin User',
          role: 'admin',
        };
        const defaultToken = 'no-auth-required';

        setUser(defaultUser);
        setAccessToken(defaultToken);
        localStorage.setItem('access_token', defaultToken);
        localStorage.setItem('user', JSON.stringify(defaultUser));
      }
    } catch (error) {
      console.error('Session initialization error:', error);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Supabase Edge gateway requires a JWT before the request reaches
          // the function. Without this, the gateway returns 401
          // UNAUTHORIZED_NO_AUTH_HEADER and the app shows "Failed to sign in".
          // NOTE: only Authorization is sent (no apikey) because the edge
          // function's CORS allowHeaders is [Content-Type, Authorization];
          // adding apikey would fail the browser preflight ("Failed to fetch").
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to sign in');
      }

      const data = await response.json();

      const user: User = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        role: data.user.user_metadata?.role || 'sqm',
      };

      // Establish a REAL Supabase session on the shared client so that
      // direct storage/database calls (e.g. uploading incident report PDFs)
      // run as the `authenticated` role and satisfy RLS policies. Without
      // this, the client keeps using the anon key and storage INSERTs fail
      // with "new row violates row-level security policy".
      if (data.access_token && data.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (sessionError) {
          console.warn('Failed to set Supabase session:', sessionError.message);
        }
      }

      setUser(user);
      setAccessToken(data.access_token);

      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.removeItem(SIGNED_OUT_FLAG);
    } catch (error: any) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    // Redirect back to /login so the auth context's onAuthStateChange listener
    // picks up the session and routes the user onward.
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (error) {
      console.error('Google sign in error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    // Clear any Supabase OAuth session as well so a Google-signed-in user is
    // fully logged out (not just our local cache).
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn('Supabase signOut warning:', error);
    }
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    localStorage.setItem(SIGNED_OUT_FLAG, 'true');
    // Hard redirect ensures any in-memory state, react-router caches, and
    // role-gated routes are reset cleanly.
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithGoogle, signOut, accessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
