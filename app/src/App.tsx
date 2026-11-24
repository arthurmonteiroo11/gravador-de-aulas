import { useEffect, useState } from 'react';
import { useSession } from './lib/useSession';
import { startUploadLoop } from './storage/uploader';
import LoginScreen from './screens/LoginScreen';
import LessonsScreen, { type OpenFocus } from './screens/LessonsScreen';
import RecordScreen from './screens/RecordScreen';
import LessonScreen from './screens/LessonScreen';
import StudyScreen from './screens/StudyScreen';
import ImportScreen from './screens/ImportScreen';
import ReviewScreen from './screens/ReviewScreen';
import PrintScreen from './screens/PrintScreen';
import FoldersScreen from './screens/FoldersScreen';
import AskScreen from './screens/AskScreen';

type View =
  | { name: 'list' }
  | { name: 'record' }
  | { name: 'lesson'; id: string; focus?: OpenFocus; from?: string; back?: View }
  | { name: 'study'; id: string }
  | { name: 'import' }
  | { name: 'folders' }
  | { name: 'review'; lessonId?: string; lessonIds?: string[]; title: string; back: View }
  | { name: 'ask'; lessonIds: string[]; title: string; back: View }
  | { name: 'print'; id: string; back: View };

function SignedIn({ userId }: { userId: string }) {
  const [view, setView] = useState<View>({ name: 'list' });
  const [subjects, setSubjects] = useState<string[]>([]);
  useEffect(() => startUploadLoop(userId), [userId]);
  // Cada tela começa do topo, como uma página nova.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const list = () => setView({ name: 'list' });

  if (view.name === 'record') {
    return <RecordScreen subjects={subjects} onDone={list} onCancel={list} />;
  }
  if (view.name === 'import') {
    return <ImportScreen folders={subjects} onDone={(id) => setView({ name: 'lesson', id })} onCancel={list} />;
  }
  if (view.name === 'folders') {
    return <FoldersScreen onBack={list} onChanged={setSubjects} />;
  }
  if (view.name === 'review') {
    return (
      <ReviewScreen
        key={view.lessonId ?? view.lessonIds?.join(',') ?? 'todas'}
        lessonId={view.lessonId}
        lessonIds={view.lessonIds}
        title={view.title}
        onBack={() => setView(view.back)}
      />
    );
  }
  if (view.name === 'ask') {
    const here = view;
    return (
      <AskScreen
        key={view.lessonIds.join(',')}
        lessonIds={view.lessonIds}
        title={view.title}
        onBack={() => setView(view.back)}
        onOpenSource={(id, startS) => setView({ name: 'lesson', id, focus: { tab: 'transcript', startS }, back: here })}
      />
    );
  }
  if (view.name === 'print') {
    return <PrintScreen lessonId={view.id} onBack={() => setView(view.back)} />;
  }
  if (view.name === 'lesson') {
    // Aberta a partir de um resumo combinado, voltar leva de novo a ele.
    const from = view.from;
    const here = view;
    return (
      <LessonScreen
        key={view.id}
        lessonId={view.id}
        focus={view.focus}
        folders={subjects}
        onBack={() => setView(here.back ?? (from ? { name: 'study', id: from } : { name: 'list' }))}
        onReview={(lessonId, title) => setView({ name: 'review', lessonId, title, back: here })}
        onPrint={(id) => setView({ name: 'print', id, back: here })}
        onAsk={(id, title) => setView({ name: 'ask', lessonIds: [id], title, back: here })}
        onDeleted={list}
      />
    );
  }
  if (view.name === 'study') {
    return <StudyScreen key={view.id} id={view.id} onBack={list} onOpenLesson={(id) => setView({ name: 'lesson', id, from: view.id })} />;
  }
  return (
    <LessonsScreen
      onRecord={() => setView({ name: 'record' })}
      onOpen={(id, focus) => setView({ name: 'lesson', id, focus })}
      onSubjects={setSubjects}
      onOpenStudy={(id) => setView({ name: 'study', id })}
      onImport={() => setView({ name: 'import' })}
      onReview={() => setView({ name: 'review', title: 'Revisar', back: { name: 'list' } })}
      onFolders={() => setView({ name: 'folders' })}
      onExamCards={(subject, lessonIds) => setView({ name: 'review', lessonIds, title: subject, back: { name: 'list' } })}
      onAsk={(lessonIds, title) => setView({ name: 'ask', lessonIds, title, back: { name: 'list' } })}
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
