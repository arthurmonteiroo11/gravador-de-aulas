import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RecordScreen, { type RecordDeps } from './RecordScreen';

const fakeRecorder = () => ({
  state: 'idle' as string,
  recordedS: 0,
  chunkCount: 0,
  start: vi.fn(function (this: { state: string }) { this.state = 'recording'; }),
  pause: vi.fn(async function (this: { state: string }) { this.state = 'paused'; }),
  resume: vi.fn(function (this: { state: string }) { this.state = 'recording'; }),
  stop: vi.fn(async function (this: { state: string }) { this.state = 'stopped'; }),
});

const makeDeps = (over: Partial<RecordDeps> = {}) => {
  const rec = fakeRecorder();
  const deps: RecordDeps = {
    getVoiceStream: vi.fn().mockResolvedValue({} as MediaStream),
    releaseVoiceStream: vi.fn(),
    createLesson: vi.fn().mockResolvedValue({ id: 'l1' }),
    finishRecording: vi.fn().mockResolvedValue(undefined),
    keepScreenOn: vi.fn().mockResolvedValue(async () => undefined),
    createRecorder: vi.fn().mockReturnValue(rec),
    saveChunk: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { deps, rec };
};

const startRecording = async () => {
  fireEvent.change(screen.getByLabelText('Título da aula'), { target: { value: 'Cálculo' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gravar' })); });
};

describe('RecordScreen', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('microfone negado não cria aula', async () => {
    const err = Object.assign(new Error('negado'), { name: 'NotAllowedError' });
    const { deps } = makeDeps({ getVoiceStream: vi.fn().mockRejectedValue(err) });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    expect(screen.getByText(/Ajustes > Safari > Microfone/)).toBeInTheDocument();
    expect(deps.createLesson).not.toHaveBeenCalled();
  });

  it('mostra o erro real do servidor ao criar a aula', async () => {
    const { deps } = makeDeps({
      createLesson: vi.fn().mockRejectedValue({ message: 'permission denied for table lessons', code: '42501' }),
    });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    expect(screen.getByText(/permission denied for table lessons \(42501\)/)).toBeInTheDocument();
  });

  it('mostra o erro real quando o gravador não inicia', async () => {
    const { deps } = makeDeps({
      createRecorder: vi.fn(() => { throw Object.assign(new Error('mimeType not supported'), { name: 'NotSupportedError' }); }),
    });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    expect(screen.getByText(/Não foi possível iniciar a gravação: mimeType not supported/)).toBeInTheDocument();
  });

  it('aviso de 1h30 pausa e pergunta', async () => {
    const { deps, rec } = makeDeps();
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    rec.recordedS = 5400;
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByText('Já são 1h30. Encerrar a gravação?')).toBeInTheDocument();
    expect(rec.pause).toHaveBeenCalled();
  });

  it('continuar após pausa pede o microfone de novo e retoma', async () => {
    const { deps, rec } = makeDeps();
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    rec.state = 'paused'; // como se a tela tivesse bloqueado
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByText(/Gravação pausada/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); });
    expect(deps.getVoiceStream).toHaveBeenCalledTimes(2);
    expect(rec.resume).toHaveBeenCalled();
  });

  it('encerrar salva a duração e o número de partes', async () => {
    const onDone = vi.fn();
    const { deps, rec } = makeDeps();
    render(<RecordScreen deps={deps} onDone={onDone} onCancel={vi.fn()} />);
    await startRecording();
    rec.recordedS = 75;
    rec.chunkCount = 2;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Encerrar' })); });
    expect(rec.stop).toHaveBeenCalled();
    expect(deps.finishRecording).toHaveBeenCalledWith('l1', 75, 2);
    expect(onDone).toHaveBeenCalledWith('l1');
  });
});

describe('RecordScreen — avisos', () => {
  it('mostra como evitar o bloqueio quando a tela não pode ficar acesa', async () => {
    const { deps } = makeDeps({
      keepScreenOn: vi.fn(async (onUnavailable?: () => void) => { onUnavailable?.(); return async () => undefined; }),
    });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    expect(screen.getByText(/Bloqueio Automático, escolha Nunca/)).toBeInTheDocument();
  });

  it('avisa se uma parte não puder ser salva no aparelho', async () => {
    let emit: (c: unknown) => void = () => undefined;
    const rec = fakeRecorder();
    const { deps } = makeDeps({
      createRecorder: vi.fn((_s, onChunk) => { emit = onChunk as never; return rec; }),
      saveChunk: vi.fn().mockRejectedValue(new Error('QuotaExceeded')),
    });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    await act(async () => { emit({ idx: 0, blob: new Blob(['a']), startS: 0, durationS: 60 }); });
    expect(screen.getByText(/Não consegui salvar parte da gravação/)).toBeInTheDocument();
  });

  it('dois toques em Continuar abrem o microfone uma vez só', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { deps, rec } = makeDeps();
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    rec.state = 'paused';
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    let release: (s: MediaStream) => void = () => undefined;
    (deps.getVoiceStream as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((r) => (release = r)));
    const button = screen.getByRole('button', { name: 'Continuar' });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    await act(async () => { release({} as MediaStream); });
    expect(deps.getVoiceStream).toHaveBeenCalledTimes(2); // 1 no início + 1 ao continuar
    expect(rec.resume).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('encerrar espera a última parte ficar salva no aparelho', async () => {
    const { deps, rec } = makeDeps();
    let emit: (c: { idx: number; blob: Blob; startS: number; durationS: number }) => void = () => undefined;
    (deps.createRecorder as ReturnType<typeof vi.fn>).mockImplementation((_s: MediaStream, onChunk: typeof emit) => {
      emit = onChunk;
      return rec;
    });
    let saved: () => void = () => undefined;
    deps.saveChunk = vi.fn(() => new Promise<void>((r) => (saved = r)));
    rec.stop = vi.fn(async () => { rec.state = 'stopped'; emit({ idx: 0, blob: new Blob(['a']), startS: 0, durationS: 3 }); });
    render(<RecordScreen deps={deps} onDone={vi.fn()} onCancel={vi.fn()} />);
    await startRecording();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Encerrar' })); });
    expect(deps.finishRecording).not.toHaveBeenCalled();
    await act(async () => { saved(); });
    expect(deps.finishRecording).toHaveBeenCalled();
  });
});
