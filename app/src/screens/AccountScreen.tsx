import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cancelInvite, createInvite, INVITE_DAYS, formatCode, inviteLink, inviteOpen, listInvites, shareInvite, type Invite } from '../lib/invites';
import { audioEstimateMb, exportBackup, importBackup, listBackupLessons, type ImportResult } from '../backup/backup';
import { shareFile } from '../media/exportAudio';
import Icon from '../components/Icon';

type Props = { email: string; onBack: () => void };

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
const daysLeft = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** Conta: convidar outra pessoa, fazer e restaurar backup, sair. */
export default function AccountScreen({ email, onBack }: Props) {
  return (
    <section className="enter account">
      <button className="back" onClick={onBack}><Icon name="back" size={18} />Aulas</button>
      <h1 className="title">Conta</h1>
      <p className="subtitle">{email}</p>
      <InviteCard />
      <BackupCard />
      <div className="actions account-out">
        <button className="ghost" onClick={() => void supabase.auth.signOut()}>Sair da conta</button>
      </div>
    </section>
  );
}

function InviteCard() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    listInvites().then(setInvites);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(async () => {
    const inv = await createInvite();
    setFresh(inv);
    setInvites((list) => [inv, ...list]);
  });

  const share = (code: string) => run(async () => {
    const how = await shareInvite(code);
    if (how === 'copied') setNote({ ok: true, text: 'Convite copiado. Cole na conversa com a pessoa.' });
  });

  const cancel = (code: string) => run(async () => {
    await cancelInvite(code);
    setInvites((list) => list.filter((i) => i.code !== code));
    if (fresh?.code === code) setFresh(null);
  });

  const open = invites.filter((i) => inviteOpen(i) && i.code !== fresh?.code);
  const used = invites.filter((i) => i.used_at);

  return (
    <section className="panel" aria-labelledby="invite-title">
      <span className="panel-icon"><Icon name="person" size={20} /></span>
      <div className="panel-text">
        <strong id="invite-title">Convidar alguém</strong>
        <small>A pessoa abre o link e cria a própria conta, com o e-mail e a senha dela. Cada um vê só as próprias aulas. O convite vale {INVITE_DAYS} dias e serve uma vez.</small>
      </div>

      {fresh && (
        <div className="invite-fresh">
          <span className="invite-code" aria-label={`Código ${formatCode(fresh.code)}`}>{formatCode(fresh.code)}</span>
          <span className="invite-link">{inviteLink(fresh.code)}</span>
          <span className="panel-buttons">
            <button className="primary small-button" onClick={() => void share(fresh.code)} disabled={busy}>Enviar convite</button>
            <button className="ghost" onClick={() => void cancel(fresh.code)} disabled={busy}>Cancelar</button>
          </span>
        </div>
      )}
      {!fresh && (
        <span className="panel-buttons">
          <button className="primary small-button" onClick={() => void create()} disabled={busy}>{busy ? 'Criando…' : 'Criar convite'}</button>
        </span>
      )}

      {(open.length > 0 || used.length > 0) && (
        <ul className="invite-list">
          {open.map((i) => (
            <li key={i.code}>
              <span>{formatCode(i.code)} <small>vence em {daysLeft(i.expires_at)} {daysLeft(i.expires_at) === 1 ? 'dia' : 'dias'}</small></span>
              <span className="panel-buttons">
                <button className="pill" onClick={() => void share(i.code)} disabled={busy}>Enviar</button>
                <button className="ghost" onClick={() => void cancel(i.code)} disabled={busy}>Cancelar</button>
              </span>
            </li>
          ))}
          {used.map((i) => (
            <li key={i.code}>
              <span>{formatCode(i.code)} <small>usado em {dayMonth(i.used_at!)}</small></span>
              <Icon name="check" size={18} />
            </li>
          ))}
        </ul>
      )}
      {note && <small className={`panel-note ${note.ok ? 'panel-ok' : 'panel-error'}`} role="status">{note.text}</small>}
    </section>
  );
}

function BackupCard() {
  const [withAudio, setWithAudio] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = progress !== null;

  useEffect(() => {
    listBackupLessons().then((l) => setEstimate(audioEstimateMb(l))).catch(() => setEstimate(null));
  }, []);

  const run = async (action: () => Promise<string>) => {
    setNote(null);
    setProgress({ done: 0, total: 1, label: 'Começando' });
    try {
      setNote({ ok: true, text: await action() });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message || 'Não deu certo. Verifique a internet e tente de novo.' });
    } finally {
      setProgress(null);
    }
  };

  const save = () => run(async () => {
    const file = await exportBackup(withAudio, (done, total, label) => setProgress({ done, total, label }));
    await shareFile(file);
    return `Backup pronto (${Math.max(1, Math.round(file.size / 1_000_000))} MB). Guarde em Arquivos ou no iCloud Drive.`;
  });

  const restore = (file: File) => run(async () => {
    const r: ImportResult = await importBackup(file, (done, total, label) => setProgress({ done, total, label }));
    const parts = [
      r.added ? `${r.added} ${r.added === 1 ? 'aula restaurada' : 'aulas restauradas'}` : 'Nenhuma aula nova',
      r.skipped ? `${r.skipped} já ${r.skipped === 1 ? 'estava' : 'estavam'} aqui` : '',
      r.failed.length ? `não deu para restaurar: ${r.failed.join(', ')}` : '',
    ].filter(Boolean);
    if (r.failed.length) throw new Error(`${parts.join('; ')}. Tente de novo: as que já entraram não duplicam.`);
    return `${parts.join('; ')}.`;
  });

  return (
    <section className="panel" aria-labelledby="backup-title">
      <span className="panel-icon"><Icon name="archive" size={20} /></span>
      <div className="panel-text">
        <strong id="backup-title">Backup</strong>
        <small>Um arquivo com todas as aulas, textos, anotações, flashcards, resumos e pastas. Restaurar não apaga nada nem duplica o que já está aqui.</small>
      </div>
      <label className="panel-check">
        <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} disabled={busy} />
        <span>
          Incluir o áudio{estimate ? ` (cerca de ${estimate} MB)` : ''}
          <small>O servidor apaga o áudio depois de 30 dias; no backup ele fica.</small>
        </span>
      </label>
      {progress && (
        <div className="panel-progress" role="status">
          <progress max={progress.total} value={progress.done} />
          <small>{progress.label}</small>
        </div>
      )}
      <span className="panel-buttons">
        <button className="primary small-button" onClick={() => void save()} disabled={busy}>Fazer backup</button>
        <button className="pill" onClick={() => fileInput.current?.click()} disabled={busy}>Restaurar</button>
      </span>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void restore(file);
        }}
      />
      {note && <small className={`panel-note ${note.ok ? 'panel-ok' : 'panel-error'}`} role="status">{note.text}</small>}
    </section>
  );
}
