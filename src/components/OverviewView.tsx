import { ArrowRight, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import type { DashboardResponse } from '../types';
import { formatBorrowDate } from '../utils/format';

interface OverviewViewProps {
  data: DashboardResponse | null;
  loading: boolean;
  returningId: number | null;
  onReturnBook: (transactionId: number) => void;
  onNavigate: (tab: 'circulation' | 'books' | 'students' | 'history') => void;
  onOpenBorrowModal: () => void;
}

export function OverviewView({
  data,
  loading,
  returningId,
  onReturnBook,
  onNavigate,
  onOpenBorrowModal,
}: OverviewViewProps) {
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white p-5"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white lg:col-span-8" />
          <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white lg:col-span-4" />
        </div>
      </div>
    );
  }

  const metrics = data?.metrics || {
    total_students: 0,
    total_books: 0,
    borrowed_books: 0,
    returned_books: 0,
    available_books: 0,
    total_transactions: 0,
  };
  const departments = data?.departments || [];
  const recent = data?.recent_transactions || [];

  const kpis = [
    {
      label: 'Total Students',
      value: metrics.total_students,
      meta: `${departments.length} academic departments`,
      actionLabel: 'Manage directory',
      onClick: () => onNavigate('students'),
    },
    {
      label: 'Total Books',
      value: metrics.total_books,
      meta: `${metrics.available_books} available for loan`,
      actionLabel: 'Browse catalog',
      onClick: () => onNavigate('books'),
    },
    {
      label: 'Borrowed Books',
      value: metrics.borrowed_books,
      meta: 'Currently checked out',
      actionLabel: 'Process returns',
      onClick: () => onNavigate('circulation'),
      accentClass: 'text-amber-700',
    },
    {
      label: 'Returned Books',
      value: metrics.returned_books,
      meta: `${metrics.total_transactions} total transactions`,
      actionLabel: 'View full ledger',
      onClick: () => onNavigate('history'),
      accentClass: 'text-emerald-700',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 4-column KPI strip */}
      <section aria-label="Library metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <div
            key={item.label}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
          >
            <div>
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <p
                className={`mt-2 font-display text-3xl font-bold tracking-tight tabular-nums ${
                  item.accentClass || 'text-slate-900'
                }`}
              >
                {item.value}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
              <span className="truncate text-slate-500 tabular-nums">{item.meta}</span>
              <button
                type="button"
                onClick={item.onClick}
                className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-800 transition-colors hover:text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 whitespace-nowrap"
              >
                {item.actionLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Main 2-column workspace split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Recent Joined Circulation */}
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Recent Circulation Activity
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Live SQL join across Student, Book, and Borrow_Transaction records
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              All History
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recent.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                No borrow transactions recorded yet.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Issue a book to a registered student to begin tracking circulation.
              </p>
              <button
                type="button"
                onClick={onOpenBorrowModal}
                className="mt-4 inline-flex items-center rounded-lg bg-blue-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap shrink-0"
              >
                Issue First Book
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">TX</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Book</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((tx) => (
                    <tr
                      key={tx.transaction_id}
                      className="transition-colors hover:bg-slate-50/80"
                    >
                      <td className="px-5 py-3 font-mono text-xs text-slate-500 tabular-nums">
                        #{tx.transaction_id}
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatBorrowDate(tx.borrow_date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
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
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {!tx.return_status ? (
                          <button
                            type="button"
                            disabled={returningId === tx.transaction_id}
                            onClick={() => onReturnBook(tx.transaction_id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {returningId === tx.transaction_id ? 'Saving...' : 'Return'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right: Department Breakdown + Quick Actions */}
        <aside className="flex flex-col gap-6 lg:col-span-4">
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Department Breakdown
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Students and loans grouped by department
              </p>
            </div>
            {departments.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-slate-500">
                No department records found.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {departments.map((dept) => {
                  const pct =
                    metrics.total_transactions > 0
                      ? Math.round((dept.total_borrows / metrics.total_transactions) * 100)
                      : 0;
                  return (
                    <div key={dept.department} className="px-5 py-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {dept.department}
                        </span>
                        <span className="font-mono text-xs text-slate-600 tabular-nums">
                          {dept.total_borrows} loans
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                        <span>{dept.student_count} students</span>
                        <span>
                          {dept.active_borrows > 0
                            ? `${dept.active_borrows} active`
                            : 'No active loans'}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-800 transition-all"
                          style={{ width: `${Math.max(pct, dept.total_borrows > 0 ? 6 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Circulation Desk
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Issue available titles to students or settle active loans in one click.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onOpenBorrowModal}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap"
              >
                Issue Book to Student
              </button>
              <button
                type="button"
                onClick={() => onNavigate('circulation')}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
              >
                Manage Active Returns ({metrics.borrowed_books})
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
