import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('mostra o nome do app', () => {
    render(<App />);
    expect(screen.getByText('Gravador de Aulas')).toBeInTheDocument();
  });
});
