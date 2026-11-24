import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons } from '../lessons/api';
import { cleanName, createFolder, deleteFolder, listSubjects, MAX_TERMS_CHARS, mergeFolders, renameFolder, saveTerms, termCount, type Subject } from '../lessons/folders';
import { subjectTone } from '../lessons/subjectTone';
import Icon from '../components/Icon';
import Sheet from '../components/Sheet';

type Props = { onBack: () => void; onChanged?: (folders: string[]) => void };

/** Pastas de matérias: criar, renomear, excluir e dar os termos da matéria. As aulas acompanham a pasta. */
export default function FoldersScreen({ onBack, onChanged }: Props) {
  const [saved, setSaved] = useState<Subject[]>([]);
  const [termsOf, setTermsOf] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [f, l] = await Promise.all([listSubjects(), listLessons()]);
    setSaved(f);
    setLessons(l);
    onChanged?.(mergeFolders(f.map((x) => x.name), l));
  };

  useEffect(() => {
    load().catch(() => setError('Não deu para abrir as pastas. Verifique a internet.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const folders = mergeFolders(saved.map((x) => x.name), lessons ?? []);
  const terms = (f: string) => saved.find((x) => x.name === f)?.terms ?? '';
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
                    <button className="terms-link" onClick={() => setTermsOf(f)} disabled={busy}>
                      <Icon name="tag" size={14} />
                      {termCount(terms(f)) ? `${termCount(terms(f))} ${termCount(terms(f)) === 1 ? 'termo' : 'termos'}` : 'Termos da matéria'}
                    </button>
                  </span>
                  <span className="folder-buttons">
                    <button className="icon-button" aria-label={`Renomear ${f}`} onClick={() => setRenaming({ from: f, to: f })} disabled={busy}>
                      <Icon name="edit" size={18} />
                    </button>
                    <button className="icon-button danger-text" aria-label={`Excluir a pasta ${f}`} onClick={() => setConfirming(f)} disabled={busy}>
                      <Icon name="trash" size={18} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {folders.length > 0 && (
          <p className="muted hint">
            Para excluir uma pasta, toque na lixeira ao lado dela. As aulas não são apagadas: ficam sem matéria.{loose ? ` Hoje ${loose === 1 ? '1 aula está' : `${loose} aulas estão`} sem matéria.` : ''}
          </p>
        )}
      </div>
      {confirming && (
        <Sheet title={`Excluir a pasta ${confirming}?`} titleId="delete-folder-title" onClose={() => setConfirming(null)}>
          <p className="muted hint sheet-lead">
            {count(confirming) === 0
              ? 'A pasta está vazia. Os termos dela também saem.'
              : `${count(confirming) === 1 ? 'A aula desta pasta continua' : `As ${count(confirming)} aulas desta pasta continuam`} no app, só ficam sem matéria. Os termos da pasta saem. Para apagar aulas, use Selecionar na lista.`}
          </p>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="actions">
            <button className="ghost" onClick={() => setConfirming(null)} disabled={busy}>Cancelar</button>
            <button
              className="danger grow"
              onClick={() => { const f = confirming; void run(async () => { await deleteFolder(f); setConfirming(null); }); }}
              disabled={busy}
            >
              {busy ? 'Excluindo…' : 'Excluir pasta'}
            </button>
          </div>
        </Sheet>
      )}
      {termsOf && (
        <TermsSheet
          folder={termsOf}
          initial={terms(termsOf)}
          onClose={() => setTermsOf(null)}
          onSaved={() => {
            setTermsOf(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/** Lista de termos da pasta: o Gemini usa esta grafia ao transcrever e reescrever as próximas aulas. */
function TermsSheet({ folder, initial, onClose, onSaved }: { folder: string; initial: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveTerms(folder, text);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Termos de ${folder}`} titleId="terms-title" onClose={onClose}>
      <p className="muted hint sheet-lead">
        Nomes, fórmulas e palavras técnicas que o professor usa. A transcrição e a reescrita das próximas aulas desta pasta passam a usar esta grafia.
      </p>
      <label htmlFor="terms-text">Um por linha ou separados por vírgula</label>
      <textarea
        id="terms-text"
        className="terms-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_TERMS_CHARS}
        rows={6}
        placeholder={'Ex.: regra de L’Hôpital, Bhaskara, limite lateral, derivada parcial'}
      />
      <p className="muted hint">{termCount(text)} {termCount(text) === 1 ? 'termo' : 'termos'}</p>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="actions">
        <button className="ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="primary grow" onClick={() => void save()} disabled={busy}>{busy ? 'Salvando…' : 'Salvar termos'}</button>
      </div>
    </Sheet>
  );
}
