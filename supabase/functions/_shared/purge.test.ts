import { assertEquals } from 'jsr:@std/assert@1';
import { purgeExpired, type PurgeDeps } from './purge.ts';

const make = (failRemoveFor?: string) => {
  const calls: string[] = [];
  const deps: PurgeDeps = {
    listExpired: () => Promise.resolve([{ id: 'a' }, { id: 'b' }]),
    listPaths: (id) => Promise.resolve([`u/${id}/0.m4a`, `u/${id}/1.m4a`]),
    removeFiles: (paths) => {
      if (failRemoveFor && paths[0].includes(`/${failRemoveFor}/`)) return Promise.reject(new Error('x'));
      calls.push(`rm ${paths.join(',')}`);
      return Promise.resolve();
    },
    deleteChunkRows: (id) => { calls.push(`rows ${id}`); return Promise.resolve(); },
    markDeleted: (id) => { calls.push(`mark ${id}`); return Promise.resolve(); },
  };
  return { deps, calls };
};

Deno.test('apaga arquivos, linhas e marca a aula, mantendo o texto', async () => {
  const { deps, calls } = make();
  assertEquals(await purgeExpired(deps), { purged: 2, failed: 0 });
  assertEquals(calls, ['rm u/a/0.m4a,u/a/1.m4a', 'rows a', 'mark a', 'rm u/b/0.m4a,u/b/1.m4a', 'rows b', 'mark b']);
});

Deno.test('falha numa aula não marca como apagada e segue para a próxima', async () => {
  const { deps, calls } = make('a');
  assertEquals(await purgeExpired(deps), { purged: 1, failed: 1 });
  assertEquals(calls.includes('mark a'), false);
  assertEquals(calls.includes('mark b'), true);
});
