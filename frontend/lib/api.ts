import type { Flashcard, Kit, Question, QuestionCategory } from "@aipk/pipeline";

// defaults to the local backend so dev works with zero setup. next.js
// reads env files from this project's own folder, not the repo root, so
// set NEXT_PUBLIC_API_BASE_URL in frontend/.env.local to point somewhere else
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export type JobState = "pending" | "researching" | "generating" | "checking" | "ready" | "failed";

export interface JobStatus {
  status: JobState;
  progress: number;
  error: { code: string; message: string } | null;
}

export interface StoredKit extends Kit {
  _id: string;
  job: JobStatus;
}

export interface UserSummary {
  id: string;
  email: string;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const error = body?.error ?? { code: "UNKNOWN", message: "something went wrong" };
    throw new ApiError(res.status, error.code, error.message);
  }

  return body as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<UserSummary>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<UserSummary>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<UserSummary>("/api/auth/me"),

  listKits: () => request<StoredKit[]>("/api/kits"),
  createKit: (input: { jd: string; companyUrl: string; days: number }) =>
    request<StoredKit>("/api/kits", { method: "POST", body: JSON.stringify(input) }),
  getKit: (id: string) => request<StoredKit>(`/api/kits/${id}`),
  getProgress: (id: string) => request<JobStatus>(`/api/kits/${id}/progress`),
  regenerateSection: (id: string, section: string) =>
    request<StoredKit>(`/api/kits/${id}/regenerate/${section}`, { method: "POST" }),

  createQuestion: (
    id: string,
    input: { category: QuestionCategory; prompt: string; answer_outline?: string; difficulty: 1 | 2 | 3; requirement_ids?: string[] },
  ) => request<StoredKit>(`/api/kits/${id}/questions`, { method: "POST", body: JSON.stringify(input) }),
  updateQuestion: (id: string, questionId: string, changes: Partial<Pick<Question, "prompt" | "answer_outline" | "category" | "difficulty">>) =>
    request<StoredKit>(`/api/kits/${id}/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(changes) }),
  deleteQuestion: (id: string, questionId: string) =>
    request<StoredKit>(`/api/kits/${id}/questions/${questionId}`, { method: "DELETE" }),
  reorderQuestions: (id: string, category: QuestionCategory, orderedIds: string[]) =>
    request<StoredKit>(`/api/kits/${id}/questions/order`, { method: "PATCH", body: JSON.stringify({ category, orderedIds }) }),
  toggleQuestionPin: (id: string, questionId: string) =>
    request<StoredKit>(`/api/kits/${id}/questions/${questionId}/pin`, { method: "PATCH" }),

  createFlashcard: (id: string, input: { front: string; back: string; requirement_ids?: string[] }) =>
    request<StoredKit>(`/api/kits/${id}/flashcards`, { method: "POST", body: JSON.stringify(input) }),
  updateFlashcard: (id: string, cardId: string, changes: Partial<Pick<Flashcard, "front" | "back">>) =>
    request<StoredKit>(`/api/kits/${id}/flashcards/${cardId}`, { method: "PATCH", body: JSON.stringify(changes) }),
  deleteFlashcard: (id: string, cardId: string) =>
    request<StoredKit>(`/api/kits/${id}/flashcards/${cardId}`, { method: "DELETE" }),
  reorderFlashcards: (id: string, orderedIds: string[]) =>
    request<StoredKit>(`/api/kits/${id}/flashcards/order`, { method: "PATCH", body: JSON.stringify({ orderedIds }) }),
  toggleFlashcardPin: (id: string, cardId: string) =>
    request<StoredKit>(`/api/kits/${id}/flashcards/${cardId}/pin`, { method: "PATCH" }),
  updateFlashcardPractice: (id: string, cardId: string, input: { confidence?: 1 | 2 | 3 | null; seen?: boolean }) =>
    request<StoredKit>(`/api/kits/${id}/flashcards/${cardId}/practice`, { method: "PATCH", body: JSON.stringify(input) }),

  updateCompanyBrief: (id: string, changes: { summary?: string; what_they_do?: string }) =>
    request<StoredKit>(`/api/kits/${id}/company-brief`, { method: "PATCH", body: JSON.stringify(changes) }),
};
