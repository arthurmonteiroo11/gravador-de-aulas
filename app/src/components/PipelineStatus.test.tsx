import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PipelineStatus from './PipelineStatus';

describe('PipelineStatus', () => {
  it('mostra onde estão as partes e os últimos erros', () => {
    render(<PipelineStatus onDevice={2} onServer={1} expected={3} uploadError="403 new row violates" processingError={null} />);
    expect(screen.getByText('No aparelho, esperando envio: 2')).toBeInTheDocument();
    expect(screen.getByText('No servidor: 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Erro no envio: 403 new row violates')).toBeInTheDocument();
    expect(screen.queryByText(/Erro no processamento/)).toBeNull();
  });

  it('avisa quando a gravação não gerou nenhuma parte', () => {
    render(<PipelineStatus onDevice={0} onServer={0} expected={0} uploadError={null} processingError={null} />);
    expect(screen.getByText(/nenhuma parte com áudio/)).toBeInTheDocument();
  });
});
