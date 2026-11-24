import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const describeError = (message: string) =>
  /signup|not allowed|not found/i.test(message)
    ? 'Este e-mail não foi convidado. Peça um convite ao Arthur.'
    : 'Não foi possível enviar o link. Tente de novo.';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setState(error ? { kind: 'error', message: describeError(error.message) } : { kind: 'sent' });
  };

  if (state.kind === 'sent') {
    return <p>Confira seu e-mail e toque no link para entrar.</p>;
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">E-mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {state.kind === 'error' && <p className="notice">{state.message}</p>}
      <p>
        <button className="primary" type="submit" disabled={state.kind === 'sending'}>Enviar link</button>
      </p>
    </form>
  );
}
