import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { signInWithPassword } = vi.hoisted(() => ({
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithPassword } } }));

import LoginScreen from './LoginScreen';

const login = (email: string, password: string) => {
  render(<LoginScreen />);
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
};

describe('LoginScreen', () => {
  it('entra com e-mail e senha dentro do app', async () => {
    login(' a@b.com ', 'segredo123');
    await vi.waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'segredo123' }),
    );
  });

  it('avisa quando o e-mail ou a senha estão errados', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    login('a@b.com', 'errada');
    expect(await screen.findByText(/E-mail ou senha errados/)).toBeInTheDocument();
  });

  it('avisa quando não consegue falar com o servidor', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    login('a@b.com', 'x');
    expect(await screen.findByText(/Não foi possível entrar/)).toBeInTheDocument();
  });
});
