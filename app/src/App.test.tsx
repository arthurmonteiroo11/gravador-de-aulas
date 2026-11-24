import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('abre carregando a sessão', () => {
    render(<App />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });
});
