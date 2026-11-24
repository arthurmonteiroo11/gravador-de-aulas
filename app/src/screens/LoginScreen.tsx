import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// O app da tela inicial não divide a sessão com o Safari, então o login é por código digitado aqui dentro.
type State =
  | { kind: 'email' }
  | { kind: 'sending' }
  | { kind: 'code' }
  | { kind: 'verifying' }
  | { kind: 'error'; step: 'email' | 'code'; message: string };

const describeSendError = (message: string) =>
  /signup|not allowed|not found/i.test(message)
    ? 'Este e-mail não foi convidado. Peça um convite ao Arthur.'
    : 'Não foi possível enviar o código. Tente de novo.';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState<State>({ kind: 'email' });

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    setState(error ? { kind: 'error', step: 'email', message: describeSendError(error.message) } : { kind: 'code' });
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'verifying' });
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\D/g, ''), type: 'email' });
    // Sem erro, a sessão muda e o App troca de tela sozinho.
    if (error) setState({ kind: 'error', step: 'code', message: 'Código errado ou vencido. Confira ou peça outro.' });
  };

  const onCodeStep = state.kind === 'code' || state.kind === 'verifying' || (state.kind === 'error' && state.step === 'code');

  if (onCodeStep) {
    return (
      <form onSubmit={verifyCode}>
        <p>Enviamos um código para {email.trim()}.</p>
        <label htmlFor="code">Código do e-mail</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {state.kind === 'error' && <p className="notice">{state.message}</p>}
        <p>
          <button className="primary" type="submit" disabled={state.kind === 'verifying'}>Entrar</button>{' '}
          <button type="button" onClick={() => { setCode(''); setState({ kind: 'email' }); }}>Pedir outro código</button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode}>
      <label htmlFor="email">E-mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {state.kind === 'error' && <p className="notice">{state.message}</p>}
      <p>
        <button className="primary" type="submit" disabled={state.kind === 'sending'}>Enviar código</button>
      </p>
    </form>
  );
}
