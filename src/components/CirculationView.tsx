import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Clock, RotateCcw, Search } from 'lucide-react';
import type { BookRecord, JoinedTransaction, StudentRecord } from '../types';
import { formatBorrowDateTime } from '../utils/format';

interface CirculationViewProps {
  students: StudentRecord[];
  books: BookRecord[];
  transactions: JoinedTransaction[];
  loading: boolean;
  returningId: number | null;
  onBorrowBook: (payload: { usn: string; book_id: number }) => Promise<void>;
  onReturnBook: (transactionId: number) => Promise<void>;
}

export function CirculationView({
  students,
  books,
  transactions,
  loading,
  returningId,
  onBorrowBook,
  onReturnBook,
}: CirculationViewProps) {
  const [selectedUsn, setSelectedUsn] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState('');

  const availableBooks = useMemo(
    () => books.filter((b) => !b.is_borrowed),
    [books]
  );

  const activeLoans = useMemo(() => {
    const q = activeQuery.trim().toLowerCase();
    return transactions
      .filter((t) => !t.return_status)
      .filter((t) => {
        if (!q) return true;
        return (
          t.usn.toLowerCase().includes(q) ||
          t.student_name.toLowerCase().includes(q) ||
          (t.department || '').toLowerCase().includes(q) ||
          t.book_name.toLowerCase().includes(q) ||
          String(t.book_id).includes(q) ||
          String(t.transaction_id).includes(q)
        );
      });
  }, [transactions, activeQuery]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedUsn) {
      setFormError('Please select a student.');
      return;
    }
    const parsedBookId = Number(selectedBookId);
    if (!Number.isInteger(parsedBookId) || parsedBookId <= 0) {
      setFormError('Please select an available book.');
      return;
    }

    setSubmitting(true);
    try {
      await onBorrowBook({ usn: selectedUsn, book_id: parsedBookId });
      setSelectedBookId('');
    } catch (err) {
      setFormError((err as Error).message || 'Unable to issue book.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Issue Book Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Issue a Book
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Creates a new record in Borrow_Transaction with return_status = false
            </p>
          </div>
          <ArrowRightLeft className="h-4 w-4 text-slate-400" />
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
            >
              {formError}
            </div>
          )}

          <div>
            <label
              htmlFor="borrow-student-select"
              className="block text-xs font-medium text-slate-700"
            >
              Select Student (USN)
            </label>
            <select
              id="borrow-student-select"
              value={selectedUsn}
              onChange={(e) => setSelectedUsn(e.target.value)}
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
                htmlFor="borrow-book-select"
                className="block text-xs font-medium text-slate-700"
              >
                Select Available Book
              </label>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {availableBooks.length} of {books.length} available
              </span>
            </div>
            <select
              id="borrow-book-select"
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
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
            {availableBooks.length === 0 && books.length > 0 && (
              <p className="mt-1.5 text-xs text-amber-700">
                All books in the catalog are currently checked out. Return a book on the right to make it available.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || availableBooks.length === 0 || students.length === 0}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {submitting ? 'Issuing Book...' : 'Confirm Book Issue'}
          </button>
        </form>
      </section>

      {/* Right: Active Checked-Out Books */}
      <section className="rounded-xl border border-slate-200 bg-white lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Active Checked-Out Books
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {activeLoans.length} unreturned transactions
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={activeQuery}
              onChange={(e) => setActiveQuery(e.target.value)}
              placeholder="Filter active loans..."
              aria-label="Filter active loans"
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Loading active loans...</div>
        ) : activeLoans.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-slate-700">
              {activeQuery
                ? 'No active loans match your search.'
                : 'No books are currently checked out.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeQuery
                ? 'Try clearing your search filter.'
                : 'Every book in the catalog is returned and available.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">TX</th>
                  <th className="px-4 py-3">Borrower</th>
                  <th className="px-4 py-3">Book Title</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-5 py-3 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeLoans.map((tx) => (
                  <tr
                    key={tx.transaction_id}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-500 tabular-nums">
                      #{tx.transaction_id}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">
                        {tx.student_name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono tabular-nums">{tx.usn}</span>
                        {tx.department && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{tx.department}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">
                        {tx.book_name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono tabular-nums">#{tx.book_id}</span>
                        {tx.author && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{tx.author}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Clock className="h-3.5 w-3.5" />
                        {formatBorrowDateTime(tx.borrow_date)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={returningId === tx.transaction_id}
                        onClick={() => onReturnBook(tx.transaction_id)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {returningId === tx.transaction_id
                          ? 'Returning...'
                          : 'Mark Returned'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
