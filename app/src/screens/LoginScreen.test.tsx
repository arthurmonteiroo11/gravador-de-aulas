import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { signInWithOtp } = vi.hoisted(() => ({ signInWithOtp: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithOtp } } }));

import LoginScreen from './LoginScreen';

describe('LoginScreen', () => {
  it('envia o link sem criar conta nova e confirma', async () => {
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByText(/Confira seu e-mail/)).toBeInTheDocument();
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
  });

  it('mostra erro quando o e-mail não foi convidado', async () => {
    signInWithOtp.mockResolvedValueOnce({ error: { message: 'Signups not allowed for otp' } });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'x@y.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByText(/não foi convidado/)).toBeInTheDocument();
  });
});
