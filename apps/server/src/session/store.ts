import type { PublicSession, Session } from "./session.js";

export interface SessionStore {
  save(session: Session): void;
  get(id: string): Session | undefined;
  list(): readonly Session[];
  clear(): void;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  public save(session: Session): void { this.sessions.set(session.id, session); }
  public get(id: string): Session | undefined { return this.sessions.get(id); }
  public list(): readonly Session[] { return [...this.sessions.values()]; }
  public clear(): void { this.sessions.clear(); }
}

export function sanitizeSession(session: Session): PublicSession {
  const { resumeToken: _resumeToken, processedMessageIds: _ids, messageOrder: _order, ...safe } = session;
  return safe;
}
