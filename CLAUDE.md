# Fleet: regras de trabalho

## Dois computadores, duas branches

O projeto é trabalhado em dois computadores. Veja em qual você está pela variável `USERNAME` do Windows (`echo $USERNAME` no Git Bash, `$env:USERNAME` no PowerShell).

| Computador | Como reconhecer | Branch de trabalho |
|---|---|---|
| Notebook GWM | `USERNAME` = `61000368` | `notebookgwm` |
| Computador de casa | qualquer outro `USERNAME` | `main` |

Um push na `main` publica o site oficial (fleet-web-three.vercel.app) pela Vercel. Um push em outra branch não muda o site.

### No notebook GWM

- Antes de começar qualquer trabalho: `git fetch`. Se a `main` tiver commits que a `notebookgwm` não tem, junte-os na `notebookgwm` e faça o push. Se houver conflito, pare e mostre ao usuário o que conflitou, sem escolher um lado.
- Faça commit e push só na `notebookgwm`.
- Junte a `notebookgwm` na `main` só quando o usuário pedir.

### No computador de casa

- Antes de começar qualquer trabalho: `git pull` da `main`.
- Depois veja se a `notebookgwm` tem commits que não estão na `main` (`git fetch` e `git log --oneline main..origin/notebookgwm`). Se tiver, avise o usuário quais são. Não junte sem ele pedir: na `main` eles iriam direto para o site.
- Faça commit e push na `main`.

## Nos dois computadores

- Depois de cada mudança verificada (tipos e testes passando), faça commit e push na branch do computador sem perguntar.
- Mudança no banco de dados (migration, apagar dados) exige confirmação explícita do usuário.
