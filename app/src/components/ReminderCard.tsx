import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../lib/push';
import Icon from './Icon';

/** Lembrete diário às 8h quando há flashcards para hoje. */
export default function ReminderCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (!state || state === 'unsupported') return null;

  const run = async (action: () => Promise<void>, ok: string) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
      setState(await pushState());
      setNote({ ok: true, text: ok });
    } catch (err) {
      setState(await pushState().catch(() => state));
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reminder" aria-labelledby="reminder-title">
      <span className="reminder-icon"><Icon name="bell" size={20} /></span>
      <div className="reminder-text">
        <strong id="reminder-title">Lembrete às 8h</strong>
        <small>
          {state === 'on' && 'Ativado neste aparelho. Só avisa nos dias com flashcards para revisar.'}
          {state === 'off' && 'Um aviso de manhã nos dias com flashcards para revisar.'}
          {state === 'denied' && 'Os avisos estão bloqueados. Libere em Ajustes > Notificações > Aulas.'}
          {state === 'needs-install' && 'No iPhone, o aviso só funciona com o app na Tela de Início: Compartilhar > Adicionar à Tela de Início.'}
        </small>
        {note && <small className={note.ok ? 'reminder-ok' : 'reminder-error'} role="status">{note.text}</small>}
      </div>
      {state === 'off' && (
        <button className="primary small-button" onClick={() => void run(enablePush, 'Pronto. Toque em Testar para ver como fica.')} disabled={busy}>
          {busy ? 'Ativando…' : 'Ativar'}
        </button>
      )}
      {state === 'on' && (
        <span className="reminder-buttons">
          <button className="pill" onClick={() => void run(sendTestPush, 'Aviso enviado. Ele chega em alguns segundos.')} disabled={busy}>Testar</button>
          <button className="ghost" onClick={() => void run(disablePush, 'Lembrete desativado.')} disabled={busy}>Desativar</button>
        </span>
      )}
    </section>
  );
}
