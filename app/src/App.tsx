import { useEffect, useState } from 'react';
import { useSession } from './lib/useSession';
import { startUploadLoop } from './storage/uploader';
import LoginScreen from './screens/LoginScreen';
import LessonsScreen, { type OpenFocus } from './screens/LessonsScreen';
import RecordScreen from './screens/RecordScreen';
import LessonScreen from './screens/LessonScreen';

type View = { name: 'list' } | { name: 'record' } | { name: 'lesson'; id: string; focus?: OpenFocus };

function SignedIn({ userId }: { userId: string }) {
  const [view, setView] = useState<View>({ name: 'list' });
  const [subjects, setSubjects] = useState<string[]>([]);
  useEffect(() => startUploadLoop(userId), [userId]);
  // Cada tela começa do topo, como uma página nova.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  if (view.name === 'record') {
    return <RecordScreen subjects={subjects} onDone={() => setView({ name: 'list' })} onCancel={() => setView({ name: 'list' })} />;
  }
  if (view.name === 'lesson') {
    return <LessonScreen key={view.id} lessonId={view.id} focus={view.focus} onBack={() => setView({ name: 'list' })} />;
  }
  return (
    <LessonsScreen
      onRecord={() => setView({ name: 'record' })}
      onOpen={(id, focus) => setView({ name: 'lesson', id, focus })}
      onSubjects={setSubjects}
    />
  );
}

export default function App() {
  const state = useSession();
  return (
    <main className="app">
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
