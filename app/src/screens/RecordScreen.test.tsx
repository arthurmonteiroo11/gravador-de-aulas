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
