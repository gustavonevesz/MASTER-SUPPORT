# ADR-015 — Local React operator console

Status: Aceito

## Contexto

CORE-001 precisa de uma interface Web read-only para uma equipe pequena. SSR, publicação, SEO e execução no edge não são requisitos. O Control Plane Fastify já é a única fronteira HTTP autorizada para o PostgreSQL.

## Decisão

Usar React com TypeScript e Vite como SPA em `apps/web`. O Browser consome somente DTOs explícitos de `GET /api/*`; não acessa PostgreSQL nem replica regras de domínio. O servidor de desenvolvimento e o preview aceitam apenas `127.0.0.1`, e o Control Plane recusa iniciar a console se seu bind não for exatamente esse endereço.

Next.js foi rejeitado nesta etapa porque SSR, server actions e uma segunda camada server-side aumentariam superfície e operação sem atender requisito atual. A escolha pode ser revista se uma necessidade concreta de SSR ou backend-for-frontend surgir.

## Consequências

A entrega permanece pequena, testável e reproduzível no monorepo. Não há deploy, autenticação corporativa, armazenamento no browser, WebSocket de browser ou mutação. Exposição fora de loopback depende de uma etapa futura com identidade e autorização de operador.
