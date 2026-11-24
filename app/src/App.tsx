import { useEffect, useState } from 'react';
import { useSession } from './lib/useSession';
import { startUploadLoop } from './storage/uploader';
import LoginScreen from './screens/LoginScreen';
import LessonsScreen, { type OpenFocus } from './screens/LessonsScreen';
import RecordScreen from './screens/RecordScreen';
import LessonScreen from './screens/LessonScreen';
import StudyScreen from './screens/StudyScreen';

type View =
  | { name: 'list' }
  | { name: 'record' }
  | { name: 'lesson'; id: string; focus?: OpenFocus; from?: string }
  | { name: 'study'; id: string };

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
    // Aberta a partir de um resumo combinado, voltar leva de novo a ele.
    const from = view.from;
    return <LessonScreen key={view.id} lessonId={view.id} focus={view.focus} onBack={() => setView(from ? { name: 'study', id: from } : { name: 'list' })} />;
  }
  if (view.name === 'study') {
    return <StudyScreen key={view.id} id={view.id} onBack={() => setView({ name: 'list' })} onOpenLesson={(id) => setView({ name: 'lesson', id, from: view.id })} />;
  }
  return (
    <LessonsScreen
      onRecord={() => setView({ name: 'record' })}
      onOpen={(id, focus) => setView({ name: 'lesson', id, focus })}
      onSubjects={setSubjects}
      onOpenStudy={(id) => setView({ name: 'study', id })}
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
