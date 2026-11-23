export interface DashboardMetrics {
  total_students: number;
  total_books: number;
  borrowed_books: number;
  returned_books: number;
  available_books: number;
  total_transactions: number;
}

export interface DepartmentStat {
  department: string;
  student_count: number;
  total_borrows: number;
  active_borrows: number;
}

export interface JoinedTransaction {
  transaction_id: number;
  usn: string;
  student_name: string;
  department: string | null;
  book_id: number;
  book_name: string;
  author: string | null;
  borrow_date: string;
  return_status: boolean;
}

export interface StudentRecord {
  usn: string;
  name: string;
  department: string | null;
  active_borrows: number;
  returned_count: number;
  total_borrows: number;
}

export interface BookRecord {
  book_id: number;
  book_name: string;
  author: string | null;
  is_borrowed: boolean;
  active_transaction_id: number | null;
  borrowed_by_usn: string | null;
  borrowed_by_name: string | null;
  active_borrow_date: string | null;
  total_borrows: number;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  departments: DepartmentStat[];
  recent_transactions: JoinedTransaction[];
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}
