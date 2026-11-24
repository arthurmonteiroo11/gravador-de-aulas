# Como publicar e testar a V1

Siga na ordem. Nenhuma chave vai para o GitHub: este repositório é público.

## 1. Banco de dados (Supabase)

1. Dê merge da branch `v1` na `main`. A integração do Supabase com o GitHub aplica as migrações de `supabase/migrations/`.
   - Se a integração não aplicar, rode no SQL Editor os quatro arquivos de `supabase/migrations/`, em ordem.
2. **Authentication → Sign In / Providers → Email:** desligue "Allow new users to sign up".
3. **Authentication → Users → Add user → Create new user:** coloque e-mail e senha e marque "Auto Confirm User". Faça o mesmo para a segunda pessoa.
4. **Authentication → URL Configuration:** em *Site URL* e *Redirect URLs*, coloque o endereço da Vercel (passo 3).

## 2. Funções e segredos

1. **Edge Functions → Secrets:** crie
   - `GEMINI_API_KEY` = sua chave do Google AI Studio
   - `CRON_SECRET` = uma senha longa qualquer (invente)
2. Publique as funções `process-lesson` e `purge-audio` (pasta `supabase/functions/`). Pela CLI:
   `supabase functions deploy process-lesson` e `supabase functions deploy purge-audio`.
   O `supabase/config.toml` já desliga a checagem automática de JWT; as funções fazem a própria checagem.
3. **Project Settings → Vault:** crie dois segredos
   - `project_url` = `https://SEU-PROJETO.supabase.co`
   - `cron_secret` = o mesmo valor de `CRON_SECRET`

## 3. App (Vercel)

1. **Add New → Project →** importe `gravador-de-aulas`.
2. *Root Directory*: `app`. O resto a Vercel detecta (Vite).
3. *Environment Variables*:
   - `VITE_SUPABASE_URL` = URL do projeto Supabase
   - `VITE_SUPABASE_ANON_KEY` = chave pública (anon/publishable) do Supabase
4. Deploy.

## 4. Instalar no iPhone

1. Abra o endereço da Vercel no **Safari**.
2. Compartilhar → **Adicionar à Tela de Início**.
3. Abra pelo ícone e entre com o e-mail e a senha criados no passo 3 do Supabase.

## 5. Roteiro de teste

Anote o que deu certo e o que não deu.

- [ ] Se aparecer o aviso de tela acesa, ajuste Ajustes > Tela e Brilho > Bloqueio Automático para Nunca durante a aula.
- [ ] Gravar 5 min com a tela acesa. A transcrição sai contínua, com tempos certos.
- [ ] Bloquear a tela no minuto 2, voltar e tocar em **Continuar**: segue na mesma aula, nada anterior perdido.
- [ ] Trocar de app e voltar: o mesmo.
- [ ] Receber uma ligação (ou chamar a Siri) no meio: a gravação pausa e continua com um toque.
- [ ] Ativar o modo avião no meio: as partes sobem quando a internet volta.
- [ ] Fechar o app durante o "Transcrevendo": a aula fica pronta sozinha (pode levar alguns minutos).
- [ ] Filtro de voz ligado e desligado: os dois gravam.
- [ ] Na transcrição, tocar num trecho toca o áudio daquele ponto.

**Primeiro teste importante:** se a aula ficar em "Erro" logo no primeiro bloco, o Gemini pode não ter aceitado o formato de áudio do iPhone. Me avise com a mensagem de erro.
