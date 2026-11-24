import { useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

type Step = { icon: ComponentProps<typeof Icon>['name']; title: string; text: string; tip?: string };

const STEPS: Step[] = [
  {
    icon: 'mic',
    title: 'Grave a aula',
    text: 'Toque em Gravar aula, deixe o app aberto e o celular perto do professor. Ao fim, toque em parar.',
    tip: 'Já tem o áudio ou o vídeo? Use a setinha ao lado para importar.',
  },
  {
    icon: 'doc',
    title: 'Espere o texto',
    text: 'Ao terminar, o app envia o áudio e o Gemini transcreve. Leva alguns minutos, e o andamento aparece na lista. Se o Gemini estiver ocupado, o app tenta de novo sozinho.',
  },
  {
    icon: 'edit',
    title: 'Estude pelas abas',
    text: 'Resumo traz os pontos principais. Reescrita é a aula organizada por tópicos. Na Transcrição, toque num trecho para ouvir aquele momento. Anotações são suas e salvam sozinhas.',
  },
  {
    icon: 'chat',
    title: 'Pergunte à aula',
    text: 'Em Perguntar, faça uma pergunta sobre a aula ou a pasta toda. A resposta mostra o trecho e o minuto de onde veio.',
  },
  {
    icon: 'cards',
    title: 'Revise com flashcards',
    text: 'Gere flashcards de cada aula e revise em Revisar. O que você erra volta mais cedo. Ative o lembrete das 8h para não esquecer.',
  },
  {
    icon: 'folder',
    title: 'Organize e junte',
    text: 'Toque em Editar pastas, no começo dos filtros, para criar uma pasta por matéria, renomear ou excluir pela lixeira. Escreva os termos da matéria para a transcrição acertar nomes difíceis.',
    tip: 'Em Selecionar, junte várias aulas num resumo só ou exclua as que não precisa.',
  },
];

const SEEN_KEY = 'tutorial-visto';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* sem armazenamento: aparece de novo na próxima vez, sem problema */
  }
}

/** Como usar: poucas telas, deslizando para o lado. Aparece no primeiro acesso e em Conta. */
export default function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const startX = useRef<number | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const close = () => {
    markSeen();
    onClose();
  };
  const go = (n: number) => setI(Math.max(0, Math.min(STEPS.length - 1, n)));

  return createPortal(
    <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div
        className="tutorial-card"
        onTouchStart={(e) => (startX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (startX.current === null) return;
          const dx = e.changedTouches[0].clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
        }}
      >
        <button className="tutorial-skip ghost" onClick={close}>{last ? 'Fechar' : 'Pular'}</button>
        <div className="tutorial-step" key={i}>
          <span className="tutorial-icon"><Icon name={step.icon} size={30} /></span>
          <p className="tutorial-count">{i + 1} de {STEPS.length}</p>
          <h2 id="tutorial-title">{step.title}</h2>
          <p className="tutorial-text">{step.text}</p>
          {step.tip && <p className="tutorial-tip">{step.tip}</p>}
        </div>
        <div className="tutorial-dots" role="tablist" aria-label="Passos">
          {STEPS.map((s, n) => (
            <button key={s.title} role="tab" aria-selected={n === i} aria-label={`Passo ${n + 1}: ${s.title}`} onClick={() => go(n)} />
          ))}
        </div>
        <div className="actions">
          {i > 0 && <button className="ghost" onClick={() => go(i - 1)}>Voltar</button>}
          <button className="primary grow" onClick={() => (last ? close() : go(i + 1))}>{last ? 'Começar' : 'Próximo'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
