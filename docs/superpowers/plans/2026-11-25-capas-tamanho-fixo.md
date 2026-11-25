# Capas com tamanho fixo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a caixa da capa da aula nunca muda de tamanho e mostra um ▶ estático enquanto a capa não chega.

**Architecture:** `CapaAula` vira a caixa (`<span>` com o tamanho vindo do `className`), com o ícone ao fundo e a `<img>` absoluta por cima. O modo `ocultar="display"` continua como era (só a `<img>`), para o fundo desfocado do curso e os cartões da Library, que já têm placeholder próprio.

**Tech Stack:** React 18, Tailwind 3, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-25-capas-tamanho-fixo-design.md`

## Global Constraints

- Sem testes automatizados no projeto (AGENTS.md): verificação por `pnpm build:servidor` (tipos) e checagem manual.
- Sem animação no placeholder (design.md: restrição deliberada).
- Comentários em português explicando o porquê.
- Ao fim: `pnpm build`, commit único direto na `main` e push.

## Review Focus

- Lista com 400+ aulas sem capa: os timers de 60 s são um por item montado; desmontar limpa o timer.
- Capa não 16:9 (miniatura quadrada do Telegram): `object-cover` dentro da caixa, sem mudar o tamanho.
- Troca de `src` (a lateral do player reaproveita o componente): volta a tentar do zero.
- Tema claro (`.escuro` existe no app): o fundo/ícone usam as mesmas classes neutras que o resto já usa.

---

### Task 1: `CapaAula` como caixa fixa + novas tentativas

**Files:**
- Modify: `web/src/components/CapaAula.tsx`
- Modify: `web/src/components/LessonGrid.tsx:63`, `web/src/components/PlaylistSidebar.tsx:140`, `web/src/pages/Course.tsx:221`, `web/src/pages/Course.tsx:612-615`

**Interfaces:**
- Produces: `CapaAula({ src, className, alt, loading, ocultar })`, a mesma assinatura. No modo padrão (`ocultar` ausente ou `'visibility'`), `className` é o tamanho da caixa; no modo `'display'`, continua sendo o da `<img>`.

- [ ] **Step 1:** Em `CapaAula.tsx`, `ESPERAS = [2_000, 5_000, 15_000, 45_000]` e depois disso a cada `60_000` enquanto montado (sem limite). O `onError` agenda `ESPERAS[tentativa] ?? 60_000`.
- [ ] **Step 2:** No modo padrão, devolver `<span className={\`relative block overflow-hidden bg-neutral-800 ${className}\`}>` com `<Play className="absolute left-1/2 top-1/2 h-1/3 w-1/3 -translate-x-1/2 -translate-y-1/2 text-neutral-600" aria-hidden />` e a `<img className="absolute inset-0 h-full w-full object-cover">`, escondida (visibility) enquanto falha. No modo `'display'`, a `<img>` de hoje.
- [ ] **Step 3:** Usos: LessonGrid e Course:612 → `className="absolute inset-0"`; PlaylistSidebar → `"aspect-video w-24 rounded"`; Course:221 → `"aspect-video w-16 shrink-0 rounded"`.
- [ ] **Step 4:** `pnpm build:servidor`, que deve terminar sem erro de tipo.
- [ ] **Step 5:** `pnpm build` e conferir o instalador em `desktop/src-tauri/target/release/bundle`. Commit (spec + plano + código + versão) e push na `main`.
