import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { MIN_PASSWORD, normalizeCode, signUpWithInvite } from '../lib/invites';

// O app da tela inicial não divide a sessão com o Safari, então o login é por senha, sem depender de e-mail.
// Contas novas entram por convite: quem já usa o app cria o convite em Conta, e a pessoa escolhe e-mail e senha.
type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string };

const describeError = (message: string) =>
  /invalid login credentials/i.test(message)
    ? 'E-mail ou senha errados.'
    : `Não foi possível entrar. Verifique a internet e tente de novo. (${message})`;

export default function LoginScreen({ inviteCode = null }: { inviteCode?: string | null }) {
  const [mode, setMode] = useState<'login' | 'invite'>(inviteCode ? 'invite' : 'login');
  const [code, setCode] = useState(inviteCode ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inviting = mode === 'invite';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inviting) {
      const clean = normalizeCode(code);
      if (!clean) return setState({ kind: 'error', message: 'Confira o código do convite: são 10 letras e números.' });
      if (password.length < MIN_PASSWORD) return setState({ kind: 'error', message: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` });
      setState({ kind: 'busy' });
      try {
        await signUpWithInvite(clean, email, password);
        setState({ kind: 'idle' });
      } catch (err) {
        setState({ kind: 'error', message: (err as Error).message });
      }
      return;
    }
    setState({ kind: 'busy' });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // Sem erro, a sessão muda e o App troca de tela sozinho.
    setState(error ? { kind: 'error', message: describeError(error.message) } : { kind: 'idle' });
  };

  const switchTo = (next: 'login' | 'invite') => {
    setMode(next);
    setState({ kind: 'idle' });
  };

  return (
    <form onSubmit={submit} className="enter" style={{ paddingTop: '12vh' }}>
      <h1 className="title" style={{ fontSize: '3rem' }}>{inviting ? 'Criar conta' : 'Aulas'}</h1>
      <p className="subtitle">
        {inviting
          ? 'Você recebeu um convite. Escolha seu e-mail e uma senha: só você vai saber a senha.'
          : 'Grave a aula e estude pelo texto depois.'}
      </p>
      <div>
        {inviting && (
          <>
            <label htmlFor="code">Código do convite</label>
            <input
              id="code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XX"
            />
          </>
        )}
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete={inviting ? 'username' : 'email'} required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete={inviting ? 'new-password' : 'current-password'}
          minLength={inviting ? MIN_PASSWORD : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {inviting && <p className="muted hint">Pelo menos {MIN_PASSWORD} caracteres.</p>}
      </div>
      <div>
        {state.kind === 'error' && <p className="notice" role="alert">{state.message}</p>}
        <div className="actions">
          <button className="primary grow" type="submit" disabled={state.kind === 'busy'}>
            {inviting ? (state.kind === 'busy' ? 'Criando…' : 'Criar conta e entrar') : 'Entrar'}
          </button>
        </div>
        <div className="actions login-switch">
          <button type="button" className="ghost" onClick={() => switchTo(inviting ? 'login' : 'invite')}>
            {inviting ? 'Já tenho conta' : 'Tenho um convite'}
          </button>
        </div>
      </div>
    </form>
  );
}
