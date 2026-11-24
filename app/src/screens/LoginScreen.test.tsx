import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
  verifyOtp: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithOtp, verifyOtp } } }));

import LoginScreen from './LoginScreen';

const askCode = async (email = 'a@b.com') => {
  render(<LoginScreen />);
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
};

describe('LoginScreen', () => {
  it('envia o código sem criar conta nova e pede o código', async () => {
    await askCode();
    expect(await screen.findByLabelText('Código do e-mail')).toBeInTheDocument();
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'a@b.com', options: { shouldCreateUser: false } });
  });

  it('entra com o código digitado no próprio app', async () => {
    await askCode();
    fireEvent.change(await screen.findByLabelText('Código do e-mail'), { target: { value: ' 123 456 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await vi.waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', token: '123456', type: 'email' }),
    );
  });

  it('avisa quando o código está errado ou vencido', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } });
    await askCode();
    fireEvent.change(await screen.findByLabelText('Código do e-mail'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/Código errado ou vencido/)).toBeInTheDocument();
  });

  it('mostra erro quando o e-mail não foi convidado', async () => {
    signInWithOtp.mockResolvedValueOnce({ error: { message: 'Signups not allowed for otp' } });
    await askCode('x@y.com');
    expect(await screen.findByText(/não foi convidado/)).toBeInTheDocument();
  });
});
