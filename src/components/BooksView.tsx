import { useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { BookRecord } from '../types';
import { Modal } from './Modal';

interface BooksViewProps {
  books: BookRecord[];
  loading: boolean;
  onCreateBook: (payload: {
    book_id?: number;
    book_name: string;
    author: string;
  }) => Promise<void>;
  onUpdateBook: (
    bookId: number,
    payload: { book_name: string; author: string }
  ) => Promise<void>;
  onDeleteBook: (bookId: number) => Promise<void>;
  onQuickBorrow: (bookId: number) => void;
}

export function BooksView({
  books,
  loading,
  onCreateBook,
  onUpdateBook,
  onDeleteBook,
  onQuickBorrow,
}: BooksViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'borrowed'>('all');

  const [addOpen, setAddOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null);
  const [deletingBook, setDeletingBook] = useState<BookRecord | null>(null);

  const [formBookId, setFormBookId] = useState('');
  const [formBookName, setFormBookName] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const suggestedNextId = useMemo(() => {
    if (books.length === 0) return 101;
    return Math.max(...books.map((b) => b.book_id)) + 1;
  }, [books]);

  const filteredBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((b) => {
      if (statusFilter === 'available' && b.is_borrowed) return false;
      if (statusFilter === 'borrowed' && !b.is_borrowed) return false;
      if (!q) return true;
      return (
        String(b.book_id).includes(q) ||
        b.book_name.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.borrowed_by_name || '').toLowerCase().includes(q) ||
        (b.borrowed_by_usn || '').toLowerCase().includes(q)
      );
    });
  }, [books, query, statusFilter]);

  const openAddModal = () => {
    setFormBookId('');
    setFormBookName('');
    setFormAuthor('');
    setFormError(null);
    setAddOpen(true);
  };

  const openEditModal = (book: BookRecord) => {
    setFormBookId(String(book.book_id));
    setFormBookName(book.book_name);
    setFormAuthor(book.author || '');
    setFormError(null);
    setEditingBook(book);
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formBookName.trim()) {
      setFormError('Book title is required.');
      return;
    }

    const payload: { book_id?: number; book_name: string; author: string } = {
      book_name: formBookName.trim(),
      author: formAuthor.trim(),
    };
    if (formBookId.trim() !== '') {
      const parsed = Number(formBookId.trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setFormError('Book ID must be a positive integer.');
        return;
      }
      payload.book_id = parsed;
    }

    setSubmitting(true);
    try {
      await onCreateBook(payload);
      setAddOpen(false);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to add book.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingBook) return;
    setFormError(null);
    if (!formBookName.trim()) {
      setFormError('Book title is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onUpdateBook(editingBook.book_id, {
        book_name: formBookName.trim(),
        author: formAuthor.trim(),
      });
      setEditingBook(null);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to update book.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingBook) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onDeleteBook(deletingBook.book_id);
      setDeletingBook(null);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to delete book.');
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
              placeholder="Search by ID, title, author, or borrower..."
              aria-label="Search books"
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <div
            role="group"
            aria-label="Filter books by availability"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {(['all', 'available', 'borrowed'] as const).map((tab) => (
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
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Book
        </button>
      </div>

      {/* Books Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Book Catalog
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Showing {filteredBooks.length} of {books.length} books
          </span>
        </div>

        {loading && books.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Loading book catalog...</div>
        ) : filteredBooks.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              {books.length === 0
                ? 'No books in the library catalog yet.'
                : 'No books match your current search or filter.'}
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-900 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Book
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Book ID</th>
                  <th className="px-4 py-3">Book Title</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Availability Status</th>
                  <th className="px-4 py-3 text-right">Total Loans</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBooks.map((book) => (
                  <tr
                    key={book.book_id}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3.5 font-mono text-xs font-medium text-slate-600 tabular-nums">
                      #{book.book_id}
                    </td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">
                      {book.book_name}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {book.author || '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      {book.is_borrowed ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            Borrowed
                          </span>
                          {book.borrowed_by_name && (
                            <span className="mt-0.5 text-xs text-slate-500">
                              {book.borrowed_by_name} ·{' '}
                              <span className="font-mono tabular-nums">
                                {book.borrowed_by_usn}
                              </span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {book.total_borrows}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {!book.is_borrowed && (
                          <button
                            type="button"
                            onClick={() => onQuickBorrow(book.book_id)}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-blue-800 transition-colors hover:border-blue-200 hover:bg-blue-50 whitespace-nowrap shrink-0"
                          >
                            Borrow
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(book)}
                          aria-label={`Edit ${book.book_name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormError(null);
                            setDeletingBook(book);
                          }}
                          aria-label={`Delete ${book.book_name}`}
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

      {/* Add Book Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add New Book"
        subtitle="Insert a new title into the PostgreSQL Book table."
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <div>
            <label
              htmlFor="add-book-id"
              className="block text-xs font-medium text-slate-700"
            >
              Book ID (optional — defaults to #{suggestedNextId})
            </label>
            <input
              id="add-book-id"
              type="number"
              min={1}
              value={formBookId}
              onChange={(e) => setFormBookId(e.target.value)}
              placeholder={String(suggestedNextId)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="add-book-name"
              className="block text-xs font-medium text-slate-700"
            >
              Book Title
            </label>
            <input
              id="add-book-name"
              type="text"
              required
              value={formBookName}
              onChange={(e) => setFormBookName(e.target.value)}
              placeholder="e.g. Clean Architecture"
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="add-book-author"
              className="block text-xs font-medium text-slate-700"
            >
              Author
            </label>
            <input
              id="add-book-author"
              type="text"
              value={formAuthor}
              onChange={(e) => setFormAuthor(e.target.value)}
              placeholder="e.g. Robert C. Martin"
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
              {submitting ? 'Saving...' : 'Save Book'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Book Modal */}
      <Modal
        open={Boolean(editingBook)}
        onClose={() => setEditingBook(null)}
        title={`Edit Book #${editingBook?.book_id ?? ''}`}
        subtitle="Update title or author details."
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <div>
            <label
              htmlFor="edit-book-name"
              className="block text-xs font-medium text-slate-700"
            >
              Book Title
            </label>
            <input
              id="edit-book-name"
              type="text"
              required
              value={formBookName}
              onChange={(e) => setFormBookName(e.target.value)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div>
            <label
              htmlFor="edit-book-author"
              className="block text-xs font-medium text-slate-700"
            >
              Author
            </label>
            <input
              id="edit-book-author"
              type="text"
              value={formAuthor}
              onChange={(e) => setFormAuthor(e.target.value)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setEditingBook(null)}
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

      {/* Delete Book Modal */}
      <Modal
        open={Boolean(deletingBook)}
        onClose={() => setDeletingBook(null)}
        title="Delete Book"
        subtitle={`Book #${deletingBook?.book_id ?? ''} — ${deletingBook?.book_name ?? ''}`}
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <p className="text-sm text-slate-600">
            Are you sure you want to permanently remove{' '}
            <strong className="font-semibold text-slate-900">
              {deletingBook?.book_name}
            </strong>{' '}
            from the catalog? Books with existing borrow transaction records cannot be deleted to preserve audit history.
          </p>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDeletingBook(null)}
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
              {submitting ? 'Deleting...' : 'Delete Book'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
