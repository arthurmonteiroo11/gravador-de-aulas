import { useState } from 'react';

const NEW = '__nova__';

/** Escolha da pasta de matéria: uma das existentes ou uma nova, digitada na hora. */
export default function SubjectPicker({ id, folders, value, onChange }: {
  id: string;
  folders: string[];
  value: string;
  onChange: (subject: string) => void;
}) {
  const known = !value || folders.includes(value);
  const [typing, setTyping] = useState(!known);
  return (
    <div className="subject-picker">
      <div className="select">
        <select
          id={id}
          value={typing ? NEW : value}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setTyping(true);
              onChange('');
            } else {
              setTyping(false);
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Sem matéria</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value={NEW}>Nova matéria…</option>
        </select>
      </div>
      {typing && (
        <input
          aria-label="Nome da nova matéria"
          placeholder="Ex.: Cálculo I"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          maxLength={60}
        />
      )}
    </div>
  );
}
