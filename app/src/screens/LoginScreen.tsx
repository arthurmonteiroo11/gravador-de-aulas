import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// O app da tela inicial não divide a sessão com o Safari, então o login é por senha, sem depender de e-mail.
// As contas são criadas pelo Arthur no painel do Supabase (Authentication → Users → Add user).
type State = { kind: 'idle' } | { kind: 'signing-in' } | { kind: 'error'; message: string };

const describeError = (message: string) =>
  /invalid login credentials/i.test(message)
    ? 'E-mail ou senha errados.'
    : `Não foi possível entrar. Verifique a internet e tente de novo. (${message})`;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'signing-in' });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // Sem erro, a sessão muda e o App troca de tela sozinho.
    setState(error ? { kind: 'error', message: describeError(error.message) } : { kind: 'idle' });
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">E-mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Senha</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {state.kind === 'error' && <p className="notice">{state.message}</p>}
      <p>
        <button className="primary" type="submit" disabled={state.kind === 'signing-in'}>Entrar</button>
      </p>
    </form>
  );
}
