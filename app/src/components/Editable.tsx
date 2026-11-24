import { useEffect, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import TextArea from './TextArea';
import Icon from './Icon';
import type { SaveState } from '../lessons/useAutosave';

type EditState = { busy: boolean; failed: boolean };

/** Salvar com o mesmo comportamento em todos os textos: espera, mostra a falha e mantém a edição aberta. */
function useEditing(onSave: () => Promise<void>) {
  const [state, setState] = useState<EditState>({ busy: false, failed: false });
  /** true quando salvou. */
  const save = async (): Promise<boolean> => {
    setState({ busy: true, failed: false });
    try {
      await onSave();
      setState({ busy: false, failed: false });
      return true;
    } catch {
      setState({ busy: false, failed: true });
      return false;
    }
  };
  return { state, save };
}

/** Avisa quem está em volta enquanto houver mudança não salva. */
function useDirty(dirty: boolean, onDirty?: (dirty: boolean) => void) {
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
}

function EditBar({ editing, busy, failed, onEdit, onCancel, onSave }: {
  editing: boolean; busy: boolean; failed: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void;
}) {
  return (
    <div className="toolbar">
      <span className="saved danger-text" aria-live="polite">{failed ? 'Não salvou. Verifique a internet.' : ''}</span>
      {editing ? (
        <>
          <button className="ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="primary" onClick={onSave} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </>
      ) : (
        <button className="pill small" onClick={onEdit}>
          <Icon name="edit" size={16} />
          Editar texto
        </button>
      )}
    </div>
  );
}

/** Texto em Markdown que pode ser corrigido à mão. */
export function EditableMarkdown({ text, components, onSave, onDirty }: {
  text: string;
  components?: Components;
  onSave: (md: string) => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { state, save } = useEditing(() => onSave(draft ?? text));
  const editing = draft !== null;
  useDirty(editing && draft !== text, onDirty);
  return (
    <>
      <EditBar
        editing={editing}
        busy={state.busy}
        failed={state.failed}
        onEdit={() => setDraft(text)}
        onCancel={() => setDraft(null)}
        onSave={() => void save().then((ok) => ok && setDraft(null))}
      />
      {editing ? (
        <TextArea className="md-editor" aria-label="Editar texto" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      ) : (
        <div className="reading"><Markdown components={components}>{text}</Markdown></div>
      )}
    </>
  );
}

export type EditableItem = { key: number; label: string; text: string };

/**
 * Transcrição: em modo de edição, tocar numa frase abre só ela para corrigir.
 * Uma caixa de texto por vez, para não pesar no iPhone numa aula longa.
 */
export function EditableList({ items, view, onSave, onDirty }: {
  items: EditableItem[];
  view: ReactNode;
  onSave: (changed: Array<{ key: number; text: string }>) => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Map<number, string> | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const changes = items
    .filter((i) => drafts?.has(i.key) && drafts.get(i.key)!.trim() !== i.text)
    .map((i) => ({ key: i.key, text: drafts!.get(i.key)!.trim() }));
  const { state, save } = useEditing(() => onSave(changes));
  const editing = drafts !== null;
  useDirty(changes.length > 0, onDirty);
  const close = () => {
    setDrafts(null);
    setActive(null);
  };
  return (
    <>
      <EditBar
        editing={editing}
        busy={state.busy}
        failed={state.failed}
        onEdit={() => setDrafts(new Map())}
        onCancel={close}
        onSave={() => void save().then((ok) => ok && close())}
      />
      {editing ? (
        <>
          <p className="muted hint" aria-live="polite">
            {changes.length
              ? `${changes.length} ${changes.length === 1 ? 'trecho alterado' : 'trechos alterados'}. Toque em Salvar quando terminar.`
              : 'Toque numa frase para corrigir.'}
          </p>
          <ol className="transcript">
            {items.map((i) => {
              const text = drafts.get(i.key) ?? i.text;
              return (
                <li key={i.key}>
                  {active === i.key ? (
                    <div className="segment-edit">
                      <span className="t">{i.label}</span>
                      <TextArea
                        aria-label={`Trecho ${i.label}`}
                        value={text}
                        onChange={(e) => setDrafts(new Map(drafts).set(i.key, e.target.value))}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <button className="segment" data-changed={text.trim() !== i.text} onClick={() => setActive(i.key)}>
                      <span className="t">{i.label}</span>
                      <span>{text}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        view
      )}
    </>
  );
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Salvando…',
  saved: 'Salvo',
  error: 'Sem internet. Tento salvar de novo sozinho.',
};

/** Anotações livres. Quem usa cuida de salvar (veja useAutosave). */
export function NotesEditor({ value, onChange, state }: { value: string; onChange: (v: string) => void; state: SaveState }) {
  return (
    <div className="notes">
      <div className="toolbar">
        <span className={`saved${state === 'error' ? ' danger-text' : ''}`} aria-live="polite">{SAVE_LABEL[state]}</span>
      </div>
      <TextArea
        aria-label="Anotações"
        placeholder="Escreva aqui o que quiser lembrar desta aula: dúvidas, o que vai cair na prova, páginas do livro…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
