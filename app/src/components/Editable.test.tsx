import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditableList, EditableMarkdown } from './Editable';

describe('EditableMarkdown', () => {
  it('edita e salva o texto', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableMarkdown text="Texto antigo" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Editar texto'), { target: { value: 'Texto novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Texto novo'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy());
  });

  it('continua editando quando não salva', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    render(<EditableMarkdown text="Oi" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Não salvou/);
    expect(screen.getByLabelText('Editar texto')).toBeTruthy();
  });
});

describe('EditableList', () => {
  it('salva só os trechos alterados', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const items = [{ key: 1, label: '00:00', text: 'um' }, { key: 2, label: '00:05', text: 'dois' }];
    render(<EditableList items={items} view={<p>lista</p>} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.queryByLabelText('Trecho 00:05')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /dois/ }));
    fireEvent.change(screen.getByLabelText('Trecho 00:05'), { target: { value: 'dois corrigido ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{ key: 2, text: 'dois corrigido' }]));
  });

  it('avisa quando há alteração não salva', () => {
    const onDirty = vi.fn();
    render(<EditableList items={[{ key: 1, label: '00:00', text: 'um' }]} view={<p>lista</p>} onSave={vi.fn()} onDirty={onDirty} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: /um/ }));
    fireEvent.change(screen.getByLabelText('Trecho 00:00'), { target: { value: 'uno' } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });
});
