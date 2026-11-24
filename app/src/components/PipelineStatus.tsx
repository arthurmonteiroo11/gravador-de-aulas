type Props = {
  onDevice: number;
  onServer: number;
  expected: number | null | undefined;
  uploadError: string | null;
  processingError: string | null;
  onSendNow?: () => void;
  sending?: boolean;
};

/** Mostra em que ponto a aula está parada: no aparelho, no envio ou no processamento. */
export default function PipelineStatus({ onDevice, onServer, expected, uploadError, processingError, onSendNow, sending }: Props) {
  return (
    <div className="muted" style={{ fontSize: 14 }}>
      <p>No aparelho, esperando envio: {onDevice}</p>
      <p>No servidor: {onServer} de {expected ?? '?'}</p>
      {expected === 0 && onDevice === 0 && <p className="notice">A gravação terminou sem nenhuma parte com áudio.</p>}
      {uploadError && <p className="notice">Erro no envio: {uploadError}</p>}
      {processingError && <p className="notice">Erro no processamento: {processingError}</p>}
      {onDevice > 0 && onSendNow && (
        <p>
          <button onClick={onSendNow} disabled={sending}>{sending ? 'Enviando…' : 'Enviar agora'}</button>
        </p>
      )}
    </div>
  );
}
