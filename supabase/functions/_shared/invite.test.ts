import { assertEquals } from 'jsr:@std/assert@1';
import { normalizeCode, ownsPath, parseSignup, redeem, type RedeemDeps } from './invite.ts';

Deno.test('código: aceita minúsculas, espaços e traço; recusa letras confusas', () => {
  assertEquals(normalizeCode('k7qm-4xpa 2b'), 'K7QM4XPA2B');
  assertEquals(normalizeCode('K7QM4XPA2O'), null); // O e 0 ficam de fora
  assertEquals(normalizeCode('CURTO'), null);
  assertEquals(normalizeCode(42), null);
});

Deno.test('cadastro: confere e-mail e senha antes de gastar o convite', () => {
  assertEquals(parseSignup({ code: 'K7QM4XPA2B', email: 'x', password: '12345678' }), 'Digite um e-mail válido.');
  assertEquals(typeof parseSignup({ code: 'K7QM4XPA2B', email: 'a@b.co', password: '123' }), 'string');
  assertEquals(parseSignup({ code: 'K7QM4XPA2B', email: ' A@B.co ', password: '12345678' }), { code: 'K7QM4XPA2B', email: 'a@b.co', password: '12345678' });
});

function fakeDeps(opts: { valid?: boolean; createError?: string } = {}) {
  const log: string[] = [];
  let used = false;
  const deps: RedeemDeps = {
    claim: async () => {
      if (used || opts.valid === false) return null;
      used = true;
      log.push('claim');
      return 'arthur';
    },
    release: async () => {
      used = false;
      log.push('release');
    },
    createUser: async () => (opts.createError ? { error: opts.createError } : { id: 'nova' }),
    addMember: async (id, by) => void log.push(`member ${id} por ${by}`),
    markUsedBy: async (_c, id) => void log.push(`usado por ${id}`),
  };
  return { deps, log };
}

const input = { code: 'K7QM4XPA2B', email: 'a@b.co', password: '12345678' };

Deno.test('convite válido: cria a conta, vira membro e não serve de novo', async () => {
  const { deps, log } = fakeDeps();
  assertEquals(await redeem(input, deps), { ok: true });
  assertEquals(log, ['claim', 'member nova por arthur', 'usado por nova']);
  assertEquals((await redeem(input, deps)).ok, false);
});

Deno.test('e-mail já usado: devolve o convite para tentar de novo', async () => {
  const { deps, log } = fakeDeps({ createError: 'A user with this email address has already been registered' });
  const r = await redeem(input, deps);
  assertEquals(r.ok === false && r.status, 409);
  assertEquals(log, ['claim', 'release']);
  assertEquals((await redeem(input, fakeDeps().deps)).ok, true);
});

Deno.test('convite vencido ou cancelado: não cria conta', async () => {
  const { deps, log } = fakeDeps({ valid: false });
  const r = await redeem(input, deps);
  assertEquals(r.ok === false && r.status, 404);
  assertEquals(log, []);
});

Deno.test('áudio: só caminhos na pasta da própria aula', () => {
  assertEquals(ownsPath('u1/l1/0.m4a', 'u1', 'l1'), true);
  assertEquals(ownsPath('u2/l9/0.m4a', 'u1', 'l1'), false);
  assertEquals(ownsPath('u1/l2/0.m4a', 'u1', 'l1'), false);
  assertEquals(ownsPath('u1/l1/../../u2/x.m4a', 'u1', 'l1'), false);
});
