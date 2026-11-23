import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { JoinedTransaction } from '../types';
import { downloadTransactionsCsv, formatBorrowDateTime } from '../utils/format';
import { Modal } from './Modal';

interface HistoryViewProps {
  transactions: JoinedTransaction[];
  loading: boolean;
  returningId: number | null;
  onReturnBook: (transactionId: number) => Promise<void>;
  onDeleteTransaction: (transactionId: number) => Promise<void>;
}

export function HistoryView({
  transactions,
  loading,
  returningId,
  onReturnBook,
  onDeleteTransaction,
}: HistoryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'borrowed' | 'returned'>('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [deletingTx, setDeletingTx] = useState<JoinedTransaction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) {
      if (tx.department && tx.department.trim()) {
        set.add(tx.department.trim());
      }
    }
    return Array.from(set).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (statusFilter === 'borrowed' && tx.return_status) return false;
      if (statusFilter === 'returned' && !tx.return_status) return false;
      if (deptFilter !== 'all' && (tx.department || 'Unassigned') !== deptFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(tx.transaction_id).includes(q) ||
        tx.usn.toLowerCase().includes(q) ||
        tx.student_name.toLowerCase().includes(q) ||
        (tx.department || '').toLowerCase().includes(q) ||
        String(tx.book_id).includes(q) ||
        tx.book_name.toLowerCase().includes(q) ||
        (tx.author || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, query, statusFilter, deptFilter]);

  const handleConfirmDelete = async () => {
    if (!deletingTx) return;
    setSubmitting(true);
    try {
      await onDeleteTransaction(deletingTx.transaction_id);
      setDeletingTx(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search TX #, USN, student, book, or author..."
              aria-label="Search borrowing history"
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <div
            role="group"
            aria-label="Filter transactions by return status"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {(['all', 'borrowed', 'returned'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter transactions by department"
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
          >
            <option value="all">All Departments</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadTransactionsCsv(filtered)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Joined Ledger Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Borrowing History Ledger
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Joined across Borrow_Transaction, Student, and Book tables
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Showing {filtered.length} of {transactions.length} records
          </span>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Loading borrowing history...
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              No borrowing records match your current search or filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">TX ID</th>
                  <th className="px-4 py-3">Student (USN · Dept)</th>
                  <th className="px-4 py-3">Book (ID · Author)</th>
                  <th className="px-4 py-3">Borrow Timestamp</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((tx) => (
                  <tr
                    key={tx.transaction_id}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-medium text-slate-500 tabular-nums">
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
                      {formatBorrowDateTime(tx.borrow_date)}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {tx.return_status ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Returned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Borrowed
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {!tx.return_status && (
                          <button
                            type="button"
                            disabled={returningId === tx.transaction_id}
                            onClick={() => onReturnBook(tx.transaction_id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {returningId === tx.transaction_id
                              ? 'Saving...'
                              : 'Return'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeletingTx(tx)}
                          aria-label={`Delete transaction ${tx.transaction_id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(deletingTx)}
        onClose={() => setDeletingTx(null)}
        title={`Delete Transaction #${deletingTx?.transaction_id ?? ''}`}
        subtitle={
          deletingTx
            ? `${deletingTx.student_name} (${deletingTx.usn}) · ${deletingTx.book_name}`
            : undefined
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Are you sure you want to delete this record from the{' '}
            <span className="font-mono text-xs">borrow_transaction</span> table? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDeletingTx(null)}
              className="min-h-10 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmDelete}
              className="min-h-10 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? 'Deleting...' : 'Delete Record'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
