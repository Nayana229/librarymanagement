import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  BookOpen,
  CheckCircle2,
  History,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { ApiError, api } from './api';
import { BooksView } from './components/BooksView';
import { CirculationView } from './components/CirculationView';
import { HistoryView } from './components/HistoryView';
import { Modal } from './components/Modal';
import { OverviewView } from './components/OverviewView';
import { StudentsView } from './components/StudentsView';
import type {
  BookRecord,
  DashboardResponse,
  JoinedTransaction,
  StudentRecord,
} from './types';

type NavTab = 'overview' | 'circulation' | 'books' | 'students' | 'history';

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'circulation', label: 'Borrow & Return', icon: ArrowRightLeft },
  { id: 'books', label: 'Book Catalog', icon: BookOpen },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'history', label: 'Borrow History', icon: History },
];

const VIEW_META: Record<NavTab, { title: string; subtitle: string }> = {
  overview: {
    title: 'Library Overview',
    subtitle: 'Real-time metrics across Student, Book, and Borrow_Transaction tables',
  },
  circulation: {
    title: 'Borrow & Return Desk',
    subtitle: 'Issue available books to students or mark checked-out books as returned',
  },
  books: {
    title: 'Book Catalog',
    subtitle: 'Manage library titles, authors, and live loan availability',
  },
  students: {
    title: 'Student Directory',
    subtitle: 'Manage registered USNs, departments, and per-student borrowing history',
  },
  history: {
    title: 'Borrowing History',
    subtitle: 'Searchable SQL-joined ledger of all past and active library loans',
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [transactions, setTransactions] = useState<JoinedTransaction[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<number | null>(null);

  // Quick Issue Book modal state
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [modalUsn, setModalUsn] = useState('');
  const [modalBookId, setModalBookId] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadAllData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);

    try {
      const [dashRes, studentsRes, booksRes, txRes] = await Promise.all([
        api.getDashboard(),
        api.getStudents(),
        api.getBooks(),
        api.getTransactions(),
      ]);
      setDashboard(dashRes && typeof dashRes === 'object' ? dashRes : null);
      setStudents(Array.isArray(studentsRes) ? studentsRes : []);
      setBooks(Array.isArray(booksRes) ? booksRes : []);
      setTransactions(Array.isArray(txRes) ? txRes : []);
      setDbUnconfigured(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DB_NOT_CONFIGURED') {
        setDbUnconfigured(true);
      } else {
        setLoadError((err as Error).message || 'Unable to connect to database.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const availableBooks = useMemo(
    () => (Array.isArray(books) ? books.filter((b) => !b.is_borrowed) : []),
    [books]
  );

  const openQuickBorrowModal = (preselectedBookId?: number) => {
    setModalUsn('');
    setModalBookId(preselectedBookId ? String(preselectedBookId) : '');
    setModalError(null);
    setBorrowModalOpen(true);
  };

  const handleBorrowBook = async (payload: { usn: string; book_id: number }) => {
    const created = await api.borrowBook(payload);
    showToast(
      'success',
      `Issued "${created.book_name}" to ${created.student_name} (${created.usn}).`
    );
    await loadAllData(true);
  };

  const handleQuickBorrowSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!modalUsn) {
      setModalError('Select a student to issue the book to.');
      return;
    }
    const parsedBookId = Number(modalBookId);
    if (!Number.isInteger(parsedBookId) || parsedBookId <= 0) {
      setModalError('Select an available book.');
      return;
    }

    setModalSubmitting(true);
    try {
      await handleBorrowBook({ usn: modalUsn, book_id: parsedBookId });
      setBorrowModalOpen(false);
    } catch (err) {
      setModalError((err as Error).message || 'Failed to issue book.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleReturnBook = async (transactionId: number) => {
    setReturningId(transactionId);
    try {
      const updated = await api.returnBook(transactionId);
      showToast(
        'success',
        `Marked "${updated.book_name}" returned by ${updated.student_name}.`
      );
      await loadAllData(true);
    } catch (err) {
      showToast('error', (err as Error).message || 'Failed to return book.');
    } finally {
      setReturningId(null);
    }
  };

  const handleDeleteTransaction = async (transactionId: number) => {
    try {
      await api.deleteTransaction(transactionId);
      showToast('success', `Deleted transaction #${transactionId}.`);
      await loadAllData(true);
    } catch (err) {
      showToast('error', (err as Error).message || 'Failed to delete transaction.');
      throw err;
    }
  };

  const handleCreateStudent = async (payload: {
    usn: string;
    name: string;
    department: string;
  }) => {
    const created = await api.createStudent(payload);
    showToast('success', `Registered student ${created.name} (${created.usn}).`);
    await loadAllData(true);
  };

  const handleUpdateStudent = async (
    usn: string,
    payload: { name: string; department: string }
  ) => {
    const updated = await api.updateStudent(usn, payload);
    showToast('success', `Updated student ${updated.name} (${updated.usn}).`);
    await loadAllData(true);
  };

  const handleDeleteStudent = async (usn: string) => {
    await api.deleteStudent(usn);
    showToast('success', `Removed student ${usn} from directory.`);
    await loadAllData(true);
  };

  const handleCreateBook = async (payload: {
    book_id?: number;
    book_name: string;
    author: string;
  }) => {
    const created = await api.createBook(payload);
    showToast('success', `Added "${created.book_name}" (#${created.book_id}).`);
    await loadAllData(true);
  };

  const handleUpdateBook = async (
    bookId: number,
    payload: { book_name: string; author: string }
  ) => {
    const updated = await api.updateBook(bookId, payload);
    showToast('success', `Updated "${updated.book_name}" (#${updated.book_id}).`);
    await loadAllData(true);
  };

  const handleDeleteBook = async (bookId: number) => {
    await api.deleteBook(bookId);
    showToast('success', `Removed book #${bookId} from catalog.`);
    await loadAllData(true);
  };

  const selectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Workspace Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              selectTab('overview');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Campus Library
          </a>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Library sections" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-blue-800' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
          <p className="font-medium text-slate-700">Circulation Ledger</p>
          <p className="mt-1 tabular-nums">
            {books.length} books · {students.length} students
          </p>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                {VIEW_META[activeTab].title}
              </h1>
              <p className="hidden truncate text-xs text-slate-500 md:block">
                {VIEW_META[activeTab].subtitle}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadAllData(true)}
              disabled={refreshing}
              aria-label="Refresh library data"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              disabled={dbUnconfigured}
              onClick={() => openQuickBorrowModal()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 sm:text-sm"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Issue Book
            </button>
          </div>
        </header>

        {/* Main Workspace Viewport */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">
          {/* Toast Notification */}
          {toast && (
            <div
              role="status"
              className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
                toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {toast.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
                )}
                <span>{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Dismiss notification"
                className="rounded p-1 hover:bg-black/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Database Configuration / Connection Banner */}
          {dbUnconfigured ? (
            <section
              role="alert"
              className="rounded-xl border border-amber-200 bg-white p-6 sm:p-8"
            >
              <div className="max-w-2xl">
                <h2 className="text-lg font-semibold text-slate-900">
                  Connect Your PostgreSQL Database
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  To protect your database password, connection strings are read from server-side environment secrets rather than stored in source files.
                </p>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                  <li>
                    Open <strong>Settings → Secrets</strong> in AI Studio.
                  </li>
                  <li>
                    Add a secret named{' '}
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                      DATABASE_URL
                    </code>{' '}
                    with your Aiven PostgreSQL connection URL.
                  </li>
                  <li>
                    Restart or refresh the preview to load your live{' '}
                    <code className="font-mono text-xs">Student</code>,{' '}
                    <code className="font-mono text-xs">Book</code>, and{' '}
                    <code className="font-mono text-xs">Borrow_Transaction</code>{' '}
                    tables.
                  </li>
                </ol>
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => void loadAllData(true)}
                    disabled={refreshing}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                    />
                    {refreshing ? 'Checking Connection...' : 'Check Connection'}
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              {loadError && (
                <div
                  role="alert"
                  className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
                    <span>{loadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAllData(true)}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    Retry Connection
                  </button>
                </div>
              )}

              {activeTab === 'overview' && (
                <OverviewView
                  data={dashboard}
                  loading={loading}
                  returningId={returningId}
                  onReturnBook={handleReturnBook}
                  onNavigate={(tab) => setActiveTab(tab)}
                  onOpenBorrowModal={() => openQuickBorrowModal()}
                />
              )}

              {activeTab === 'circulation' && (
                <CirculationView
                  students={students}
                  books={books}
                  transactions={transactions}
                  loading={loading}
                  returningId={returningId}
                  onBorrowBook={handleBorrowBook}
                  onReturnBook={handleReturnBook}
                />
              )}

              {activeTab === 'books' && (
                <BooksView
                  books={books}
                  loading={loading}
                  onCreateBook={handleCreateBook}
                  onUpdateBook={handleUpdateBook}
                  onDeleteBook={handleDeleteBook}
                  onQuickBorrow={(bookId) => openQuickBorrowModal(bookId)}
                />
              )}

              {activeTab === 'students' && (
                <StudentsView
                  students={students}
                  loading={loading}
                  returningId={returningId}
                  onCreateStudent={handleCreateStudent}
                  onUpdateStudent={handleUpdateStudent}
                  onDeleteStudent={handleDeleteStudent}
                  onReturnBook={handleReturnBook}
                />
              )}

              {activeTab === 'history' && (
                <HistoryView
                  transactions={transactions}
                  loading={loading}
                  returningId={returningId}
                  onReturnBook={handleReturnBook}
                  onDeleteTransaction={handleDeleteTransaction}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Global Issue Book Modal */}
      <Modal
        open={borrowModalOpen}
        onClose={() => setBorrowModalOpen(false)}
        title="Issue Book to Student"
        subtitle="Creates a new active loan in Borrow_Transaction."
      >
        <form onSubmit={handleQuickBorrowSubmit} className="space-y-4">
          {modalError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {modalError}
            </div>
          )}

          <div>
            <label
              htmlFor="modal-borrow-usn"
              className="block text-xs font-medium text-slate-700"
            >
              Student
            </label>
            <select
              id="modal-borrow-usn"
              value={modalUsn}
              onChange={(e) => setModalUsn(e.target.value)}
              className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            >
              <option value="">Choose a student...</option>
              {students.map((s) => (
                <option key={s.usn} value={s.usn}>
                  {s.usn} — {s.name}
                  {s.department ? ` (${s.department})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="modal-borrow-book"
                className="block text-xs font-medium text-slate-700"
              >
                Available Book
              </label>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {availableBooks.length} available
              </span>
            </div>
            <select
              id="modal-borrow-book"
              value={modalBookId}
              onChange={(e) => setModalBookId(e.target.value)}
              className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            >
              <option value="">Choose an available book...</option>
              {availableBooks.map((b) => (
                <option key={b.book_id} value={b.book_id}>
                  #{b.book_id} — {b.book_name}
                  {b.author ? ` (${b.author})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setBorrowModalOpen(false)}
              className="min-h-10 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={modalSubmitting || availableBooks.length === 0}
              className="min-h-10 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 disabled:opacity-50 whitespace-nowrap"
            >
              {modalSubmitting ? 'Issuing...' : 'Issue Book'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
