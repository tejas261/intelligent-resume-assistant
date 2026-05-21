import { Session } from "@/types";

const sessions = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function createSession(session: Session): void {
  sessions.set(session.id, session);
}

export function updateSession(id: string, updates: Partial<Session>): void {
  const existing = sessions.get(id);
  if (existing) {
    sessions.set(id, { ...existing, ...updates });
  }
}
