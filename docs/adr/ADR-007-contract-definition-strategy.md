# ADR-007 — Estratégia de definição de contratos

## Decisão

JSON Schema 2020-12 é a fonte de verdade independente de linguagem para mensagens Agent ↔ Control Plane. TypeScript usa AJV; C# consome os mesmos arquivos por um validador mínimo nesta etapa. Fixtures canônicas e round-trip automatizado detectam divergência.

## Status

Aceito na FOUNDATION-001.

## Contexto

TypeScript e C# precisam validar a mesma semântica sem tornar modelos de uma linguagem autoridade da outra. Os primeiros contratos são pequenos e não justificam Protobuf, code generation ou registry externo.

## Consequências

- Schemas versionados ficam em `packages/contracts/schemas`.
- Tipos de conveniência podem existir nos consumidores, mas não substituem validação runtime.
- Mudança compatível em `1.0` é aditiva e opcional; quebra exige nova versão de protocolo.
- O validador C# cobre somente `$schema`, `$id`, `title`, `type`, `required`, `properties`, `additionalProperties`, `const`, `enum`, `format`, `minLength`, `minItems`, `uniqueItems` e `items`; rejeita qualquer outra keyword.
- A substituição é obrigatória antes de introduzir `$ref`, `oneOf`/`allOf`/`anyOf`, condicionais, formatos customizados ou outra keyword fora desse subconjunto. Nesse gate, biblioteca madura é preferível a ampliar o interpretador manual.
- AJV é usado por implementar draft 2020-12 de modo maduro; `ajv-formats` fornece UUID/date-time sem schema framework adicional.

## Alternativas

Tipos TypeScript ou records C# como fonte foram rejeitados por acoplamento. OpenAPI é adequado ao HTTP, mas não é necessário para mensagens ainda sem transporte. Protobuf adicionaria toolchain e formato binário antes de necessidade comprovada.

## Condições para revisar

Schemas complexos, code generation confiável nos dois runtimes, necessidade de formato binário/performance ou incapacidade de manter cobertura integral do validador C#.
