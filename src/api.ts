import type {
  BookRecord,
  DashboardResponse,
  JoinedTransaction,
  StudentRecord,
} from './types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  const text = await res.text();
  let data: unknown = null;
  let parseFailed = false;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      parseFailed = true;
      data = null;
    }
  }

  if (!res.ok) {
    const errObj = (data && typeof data === 'object' ? data : {}) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(
      errObj.error || `Request failed (${res.status})`,
      res.status,
      errObj.code
    );
  }

  if (parseFailed || data === null) {
    throw new ApiError(
      'Server returned an unexpected response. Try refreshing the page.',
      res.status
    );
  }

  return data as T;
}

export const api = {
  getHealth: () =>
    request<{ ok: boolean; configured: boolean; error?: string }>('/api/health'),

  getDashboard: () => request<DashboardResponse>('/api/dashboard'),

  getStudents: (params?: { q?: string; department?: string }) => {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    if (params?.department && params.department !== 'all') {
      search.set('department', params.department);
    }
    const qs = search.toString();
    return request<StudentRecord[]>(`/api/students${qs ? `?${qs}` : ''}`);
  },

  getStudentHistory: (usn: string) =>
    request<{
      student: { usn: string; name: string; department: string | null };
      transactions: JoinedTransaction[];
    }>(`/api/students/${encodeURIComponent(usn)}/history`),

  createStudent: (payload: { usn: string; name: string; department: string }) =>
    request<StudentRecord>('/api/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateStudent: (usn: string, payload: { name: string; department: string }) =>
    request<{ usn: string; name: string; department: string | null }>(
      `/api/students/${encodeURIComponent(usn)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteStudent: (usn: string) =>
    request<{ deleted: boolean; usn: string }>(
      `/api/students/${encodeURIComponent(usn)}`,
      { method: 'DELETE' }
    ),

  getBooks: (params?: { q?: string; status?: 'all' | 'available' | 'borrowed' }) => {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    if (params?.status && params.status !== 'all') {
      search.set('status', params.status);
    }
    const qs = search.toString();
    return request<BookRecord[]>(`/api/books${qs ? `?${qs}` : ''}`);
  },

  createBook: (payload: { book_id?: number; book_name: string; author: string }) =>
    request<BookRecord>('/api/books', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBook: (bookId: number, payload: { book_name: string; author: string }) =>
    request<{ book_id: number; book_name: string; author: string | null }>(
      `/api/books/${bookId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteBook: (bookId: number) =>
    request<{ deleted: boolean; book_id: number }>(`/api/books/${bookId}`, {
      method: 'DELETE',
    }),

  getTransactions: (params?: {
    q?: string;
    status?: 'all' | 'borrowed' | 'returned';
    department?: string;
  }) => {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    if (params?.status && params.status !== 'all') {
      search.set('status', params.status);
    }
    if (params?.department && params.department !== 'all') {
      search.set('department', params.department);
    }
    const qs = search.toString();
    return request<JoinedTransaction[]>(
      `/api/transactions${qs ? `?${qs}` : ''}`
    );
  },

  borrowBook: (payload: { usn: string; book_id: number }) =>
    request<JoinedTransaction>('/api/transactions/borrow', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  returnBook: (transactionId: number) =>
    request<JoinedTransaction>(`/api/transactions/${transactionId}/return`, {
      method: 'PATCH',
    }),

  deleteTransaction: (transactionId: number) =>
    request<{ deleted: boolean; transaction_id: number }>(
      `/api/transactions/${transactionId}`,
      { method: 'DELETE' }
    ),
};
