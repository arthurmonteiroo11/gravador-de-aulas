import { useSession } from './lib/useSession';
import LoginScreen from './screens/LoginScreen';

export default function App() {
  const state = useSession();
  return (
    <main className="app">
      <h1>Gravador de Aulas</h1>
      {state.loading ? <p className="muted">Carregando…</p> : state.session ? <p>Conectado.</p> : <LoginScreen />}
    </main>
  );
}
