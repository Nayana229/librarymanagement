import { useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Clock,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import type { JoinedTransaction, StudentRecord } from '../types';
import { formatBorrowDateTime } from '../utils/format';
import { Modal } from './Modal';

interface StudentsViewProps {
  students: StudentRecord[];
  loading: boolean;
  returningId: number | null;
  onCreateStudent: (payload: {
    usn: string;
    name: string;
    department: string;
  }) => Promise<void>;
  onUpdateStudent: (
    usn: string,
    payload: { name: string; department: string }
  ) => Promise<void>;
  onDeleteStudent: (usn: string) => Promise<void>;
  onReturnBook: (transactionId: number) => Promise<void>;
}

export function StudentsView({
  students,
  loading,
  returningId,
  onCreateStudent,
  onUpdateStudent,
  onDeleteStudent,
  onReturnBook,
}: StudentsViewProps) {
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  const [addOpen, setAddOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [deletingStudent, setDeletingStudent] = useState<StudentRecord | null>(null);

  const [historyStudent, setHistoryStudent] = useState<StudentRecord | null>(null);
  const [historyRows, setHistoryRows] = useState<JoinedTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [formUsn, setFormUsn] = useState('');
  const [formName, setFormName] = useState('');
  const [formDepartment, setFormDepartment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (s.department && s.department.trim()) {
        set.add(s.department.trim());
      }
    }
    return Array.from(set).sort();
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (deptFilter !== 'all' && (s.department || 'Unassigned') !== deptFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.usn.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q)
      );
    });
  }, [students, query, deptFilter]);

  const openAddModal = () => {
    setFormUsn('');
    setFormName('');
    setFormDepartment('');
    setFormError(null);
    setAddOpen(true);
  };

  const openEditModal = (student: StudentRecord) => {
    setFormUsn(student.usn);
    setFormName(student.name);
    setFormDepartment(student.department || '');
    setFormError(null);
    setEditingStudent(student);
  };

  const openHistoryModal = async (student: StudentRecord) => {
    setHistoryStudent(student);
    setHistoryRows([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const res = await api.getStudentHistory(student.usn);
      setHistoryRows(res.transactions);
    } catch (err) {
      setHistoryError((err as Error).message || 'Failed to load student history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleHistoryReturn = async (transactionId: number) => {
    await onReturnBook(transactionId);
    if (historyStudent) {
      try {
        const res = await api.getStudentHistory(historyStudent.usn);
        setHistoryRows(res.transactions);
      } catch {
        // Ignore secondary refresh error; global error already handled
      }
    }
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formUsn.trim()) {
      setFormError('Student USN is required.');
      return;
    }
    if (!formName.trim()) {
      setFormError('Student name is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateStudent({
        usn: formUsn.trim().toUpperCase(),
        name: formName.trim(),
        department: formDepartment.trim(),
      });
      setAddOpen(false);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to register student.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setFormError(null);
    if (!formName.trim()) {
      setFormError('Student name is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onUpdateStudent(editingStudent.usn, {
        name: formName.trim(),
        department: formDepartment.trim(),
      });
      setEditingStudent(null);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to update student.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingStudent) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onDeleteStudent(deletingStudent.usn);
      setDeletingStudent(null);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to delete student.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by USN, name, or department..."
              aria-label="Search students"
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
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
          onClick={openAddModal}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Register Student
        </button>
      </div>

      {/* Students Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Student Directory
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Showing {filteredStudents.length} of {students.length} students
          </span>
        </div>

        {loading && students.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Loading students...</div>
        ) : filteredStudents.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              {students.length === 0
                ? 'No students registered yet.'
                : 'No students match your current search or filter.'}
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              Register Student
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">USN</th>
                  <th className="px-4 py-3">Student Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3 text-right">Active Loans</th>
                  <th className="px-4 py-3 text-right">Returned</th>
                  <th className="px-4 py-3 text-right">Total Loans</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((student) => (
                  <tr
                    key={student.usn}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
                      {student.usn}
                    </td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">
                      {student.name}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {student.department || 'Unassigned'}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-right font-mono text-xs tabular-nums ${
                        student.active_borrows > 0
                          ? 'font-semibold text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {student.active_borrows}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-emerald-700 tabular-nums">
                      {student.returned_count}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {student.total_borrows}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openHistoryModal(student)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
                        >
                          <History className="h-3.5 w-3.5" />
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(student)}
                          aria-label={`Edit ${student.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormError(null);
                            setDeletingStudent(student);
                          }}
                          aria-label={`Delete ${student.name}`}
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

      {/* Register Student Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Register Student"
        subtitle="Add a student record to the PostgreSQL Student table."
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <div>
            <label
              htmlFor="add-student-usn"
              className="block text-xs font-medium text-slate-700"
            >
              University Seat Number (USN)
            </label>
            <input
              id="add-student-usn"
              type="text"
              required
              value={formUsn}
              onChange={(e) => setFormUsn(e.target.value)}
              placeholder="e.g. 1EP23CS015"
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="add-student-name"
              className="block text-xs font-medium text-slate-700"
            >
              Full Name
            </label>
            <input
              id="add-student-name"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Divya Rao"
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="add-student-dept"
              className="block text-xs font-medium text-slate-700"
            >
              Department
            </label>
            <input
              id="add-student-dept"
              type="text"
              value={formDepartment}
              onChange={(e) => setFormDepartment(e.target.value)}
              placeholder="e.g. CSE, AIML, ECE, ME, Civil"
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="min-h-10 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-10 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? 'Registering...' : 'Save Student'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Student Modal */}
      <Modal
        open={Boolean(editingStudent)}
        onClose={() => setEditingStudent(null)}
        title={`Edit Student — ${editingStudent?.usn ?? ''}`}
        subtitle="Update student name or academic department."
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <div>
            <label
              htmlFor="edit-student-name"
              className="block text-xs font-medium text-slate-700"
            >
              Full Name
            </label>
            <input
              id="edit-student-name"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="edit-student-dept"
              className="block text-xs font-medium text-slate-700"
            >
              Department
            </label>
            <input
              id="edit-student-dept"
              type="text"
              value={formDepartment}
              onChange={(e) => setFormDepartment(e.target.value)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setEditingStudent(null)}
              className="min-h-10 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-10 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? 'Updating...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Student Modal */}
      <Modal
        open={Boolean(deletingStudent)}
        onClose={() => setDeletingStudent(null)}
        title="Delete Student"
        subtitle={`${deletingStudent?.name ?? ''} · ${deletingStudent?.usn ?? ''}`}
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <p className="text-sm text-slate-600">
            Are you sure you want to remove{' '}
            <strong className="font-semibold text-slate-900">
              {deletingStudent?.name}
            </strong>{' '}
            from the student directory? Students with existing borrow transaction history cannot be deleted.
          </p>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDeletingStudent(null)}
              className="min-h-10 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleDeleteConfirm}
              className="min-h-10 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? 'Deleting...' : 'Delete Student'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Student Borrowing History Modal */}
      <Modal
        open={Boolean(historyStudent)}
        onClose={() => setHistoryStudent(null)}
        title={historyStudent ? `${historyStudent.name} — Borrowing History` : 'Borrowing History'}
        subtitle={
          historyStudent
            ? `${historyStudent.usn} · ${historyStudent.department || 'Unassigned'}`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {historyLoading ? (
          <p className="py-6 text-sm text-slate-500">Loading borrowing records...</p>
        ) : historyError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
            {historyError}
          </div>
        ) : historyRows.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">
            This student has not borrowed any books yet.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-2.5">TX</th>
                  <th className="px-4 py-2.5">Book</th>
                  <th className="px-4 py-2.5">Borrowed</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyRows.map((tx) => (
                  <tr key={tx.transaction_id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">
                      #{tx.transaction_id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {tx.book_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        #{tx.book_id}
                        {tx.author ? ` · ${tx.author}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatBorrowDateTime(tx.borrow_date)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tx.return_status ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Returned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Borrowed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {!tx.return_status ? (
                        <button
                          type="button"
                          disabled={returningId === tx.transaction_id}
                          onClick={() => handleHistoryReturn(tx.transaction_id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Return
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
      </Modal>
    </div>
  );
}
