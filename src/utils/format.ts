import type { JoinedTransaction } from '../types';

export function formatBorrowDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatBorrowDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const sanitized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export function downloadTransactionsCsv(rows: JoinedTransaction[]): void {
  const headers = [
    'Transaction ID',
    'Student USN',
    'Student Name',
    'Department',
    'Book ID',
    'Book Title',
    'Author',
    'Borrow Date',
    'Return Status',
  ];

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      [
        row.transaction_id,
        row.usn,
        row.student_name,
        row.department || '',
        row.book_id,
        row.book_name,
        row.author || '',
        row.borrow_date,
        row.return_status ? 'Returned' : 'Borrowed',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];

  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `library-borrowing-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
