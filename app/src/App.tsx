import { useEffect, useState } from 'react';
import { useSession } from './lib/useSession';
import { startUploadLoop } from './storage/uploader';
import LoginScreen from './screens/LoginScreen';
import LessonsScreen from './screens/LessonsScreen';
import RecordScreen from './screens/RecordScreen';

type View = { name: 'list' } | { name: 'record' } | { name: 'lesson'; id: string };

function SignedIn({ userId }: { userId: string }) {
  const [view, setView] = useState<View>({ name: 'list' });
  useEffect(() => startUploadLoop(userId), [userId]);

  if (view.name === 'record') {
    return <RecordScreen onDone={() => setView({ name: 'list' })} onCancel={() => setView({ name: 'list' })} />;
  }
  return <LessonsScreen onRecord={() => setView({ name: 'record' })} onOpen={(id) => setView({ name: 'lesson', id })} />;
}

export default function App() {
  const state = useSession();
  return (
    <main className="app">
      <h1>Gravador de Aulas</h1>
      {state.loading ? (
        <p className="muted">Carregando…</p>
      ) : state.session ? (
        <SignedIn userId={state.session.user.id} />
      ) : (
        <LoginScreen />
      )}
    </main>
  );
}
