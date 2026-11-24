import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons } from '../lessons/api';
import { cleanName, createFolder, deleteFolder, listFolders, mergeFolders, renameFolder } from '../lessons/folders';
import { subjectTone } from '../lessons/subjectTone';
import Icon from '../components/Icon';

type Props = { onBack: () => void; onChanged?: (folders: string[]) => void };

/** Pastas de matérias: criar, renomear e apagar. As aulas acompanham a pasta. */
export default function FoldersScreen({ onBack, onChanged }: Props) {
  const [saved, setSaved] = useState<string[]>([]);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [f, l] = await Promise.all([listFolders(), listLessons()]);
    setSaved(f);
    setLessons(l);
    onChanged?.(mergeFolders(f, l));
  };

  useEffect(() => {
    load().catch(() => setError('Não deu para abrir as pastas. Verifique a internet.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError((err as Error).message || 'Não deu certo. Verifique a internet.');
    } finally {
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = cleanName(newName);
    if (!name) return;
    void run(async () => {
      await createFolder(name);
      setNewName('');
    });
  };

  const folders = mergeFolders(saved, lessons ?? []);
  const count = (f: string) => (lessons ?? []).filter((l) => l.subject === f).length;
  const loose = (lessons ?? []).filter((l) => !l.subject).length;

  return (
    <section className="enter">
      <button className="back" onClick={onBack} aria-label="Voltar">
        <Icon name="back" size={20} />
        Aulas
      </button>
      <h1 className="title">Pastas</h1>

      <form className="new-folder" onSubmit={create}>
        <input aria-label="Nome da nova pasta" placeholder="Nova pasta, ex.: Física II" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
        <button className="primary" type="submit" disabled={busy || !cleanName(newName)} aria-label="Criar pasta">
          <Icon name="plus" size={20} />
        </button>
      </form>

      <div>
        {error && <p className="notice" role="alert">{error}</p>}
        {lessons === null && !error && <p className="muted">Carregando…</p>}
        {lessons && folders.length === 0 && (
          <div className="empty">
            <p className="title">Nenhuma pasta ainda</p>
            <p>Crie uma pasta para cada matéria. Depois é só escolher a pasta ao gravar, importar ou editar uma aula.</p>
          </div>
        )}
        <ul className="folder-list">
          {folders.map((f) => (
            <li key={f} className="folder-row" style={{ '--tone': subjectTone(f) } as CSSProperties}>
              {renaming?.from === f ? (
                <form
                  className="folder-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const to = renaming.to;
                    void run(async () => {
                      await renameFolder(f, to, folders);
                      setRenaming(null);
                    });
                  }}
                >
                  <input aria-label={`Novo nome para ${f}`} value={renaming.to} onChange={(e) => setRenaming({ from: f, to: e.target.value })} autoFocus maxLength={60} />
                  <button type="button" className="ghost" onClick={() => setRenaming(null)}>Cancelar</button>
                  <button type="submit" className="primary" disabled={busy || !cleanName(renaming.to)}>Salvar</button>
                </form>
              ) : (
                <>
                  <span className="folder-name">
                    <span className="dot" />
                    <strong>{f}</strong>
                    <small>{count(f) === 0 ? 'vazia' : `${count(f)} ${count(f) === 1 ? 'aula' : 'aulas'}`}</small>
                  </span>
                  <span className="folder-buttons">
                    <button className="icon-button" aria-label={`Renomear ${f}`} onClick={() => setRenaming({ from: f, to: f })} disabled={busy}>
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      className="icon-button danger-text"
                      data-confirm={confirming === f}
                      aria-label={confirming === f ? `Toque de novo para apagar ${f}` : `Apagar ${f}`}
                      onClick={() => (confirming === f ? void run(async () => { await deleteFolder(f); setConfirming(null); }) : setConfirming(f))}
                      disabled={busy}
                    >
                      {confirming === f ? 'Apagar?' : <Icon name="trash" size={18} />}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {folders.length > 0 && (
          <p className="muted hint">
            Apagar uma pasta não apaga as aulas: elas ficam sem matéria.{loose ? ` Hoje ${loose === 1 ? '1 aula está' : `${loose} aulas estão`} sem matéria.` : ''}
          </p>
        )}
      </div>
    </section>
  );
}
