# ADR-008 — Framework HTTP do Control Plane

## Decisão

Usar Fastify como base HTTP do monólito modular TypeScript.

## Status

Aceito na FOUNDATION-001.

## Contexto

O skeleton precisa de HTTP testável, baixo overhead, TypeScript e validação explícita, sem a estrutura abrangente de NestJS. Node HTTP nativo reduziria uma dependência, mas exigiria infraestrutura própria para lifecycle, injeção de requests em teste e evolução segura de rotas.

## Consequências

- Fastify é uma borda de entrega; domínio e contratos não dependem dele.
- Logging automático de request foi desativado nesta fase para evitar payloads brutos; logging estruturado mínimo é explícito.
- Não existe autenticação, persistência ou transporte Agent no servidor atual.

## Condições para revisar

Incompatibilidade relevante com transporte escolhido, custo operacional medido, vulnerabilidade sem mitigação ou requisitos que outra base atenda de forma substancialmente melhor.
