import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type SessionState = { loading: true } | { loading: false; session: Session | null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true });
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ loading: false, session: data.session }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ loading: false, session }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}
