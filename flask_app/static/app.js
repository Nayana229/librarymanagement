const state = {
  activeTab: 'overview',
  dashboard: null,
  students: [],
  books: [],
  transactions: [],
};

const TAB_META = {
  overview: ['Library Overview', 'Real-time metrics across Student, Book, and Borrow_Transaction tables'],
  circulation: ['Borrow & Return Desk', 'Issue available books to students or mark loans returned'],
  books: ['Book Catalog', 'Manage library titles, authors, and live loan availability'],
  students: ['Student Directory', 'Manage registered USNs, departments, and borrowing history'],
  history: ['Borrowing History', 'Searchable SQL-joined ledger across all library loans'],
};

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.code = data && data.code;
    throw err;
  }
  return data;
}

function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.className = 'toast hidden';
  }, 4000);
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function openModal(title, builder) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  clearNode(body);
  builder(body);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
  });
  const [title, subtitle] = TAB_META[tab] || TAB_META.overview;
  document.getElementById('view-title').textContent = title;
  document.getElementById('view-subtitle').textContent = subtitle;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-backdrop').classList.add('hidden');
}

function renderOverview() {
  const dash = state.dashboard;
  if (!dash) return;
  const m = dash.metrics;
  document.getElementById('kpi-students').textContent = m.total_students;
  document.getElementById('kpi-students-meta').textContent = `${dash.departments.length} departments`;
  document.getElementById('kpi-books').textContent = m.total_books;
  document.getElementById('kpi-books-meta').textContent = `${m.available_books} available for loan`;
  document.getElementById('kpi-borrowed').textContent = m.borrowed_books;
  document.getElementById('kpi-returned').textContent = m.returned_books;
  document.getElementById('kpi-returned-meta').textContent = `${m.total_transactions} total transactions`;

  const tbody = document.getElementById('recent-tx-body');
  clearNode(tbody);
  dash.recent_transactions.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'mono', `#${tx.transaction_id}`));

    const tdStudent = document.createElement('td');
    tdStudent.appendChild(el('div', '', tx.student_name));
    tdStudent.appendChild(el('div', 'subline mono', `${tx.usn}${tx.department ? ` · ${tx.department}` : ''}`));
    tr.appendChild(tdStudent);

    const tdBook = document.createElement('td');
    tdBook.appendChild(el('div', '', tx.book_name));
    tdBook.appendChild(el('div', 'subline', `#${tx.book_id}${tx.author ? ` · ${tx.author}` : ''}`));
    tr.appendChild(tdBook);

    tr.appendChild(el('td', 'tabular-nums', formatDate(tx.borrow_date)));
    tr.appendChild(el('td', tx.return_status ? 'status-returned' : 'status-borrowed', tx.return_status ? 'Returned' : 'Borrowed'));

    const tdAct = el('td', 'text-right');
    if (!tx.return_status) {
      const btn = el('button', 'btn btn-secondary btn-sm', 'Return');
      btn.type = 'button';
      btn.addEventListener('click', () => handleReturn(tx.transaction_id));
      tdAct.appendChild(btn);
    } else {
      tdAct.textContent = '—';
    }
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });

  const deptList = document.getElementById('dept-list');
  clearNode(deptList);
  dash.departments.forEach((d) => {
    const row = el('div', 'dept-row');
    const top = el('div', 'dept-top');
    top.appendChild(el('span', '', d.department));
    top.appendChild(el('span', 'mono', `${d.total_borrows} loans`));
    const sub = el('div', 'dept-sub');
    sub.appendChild(el('span', '', `${d.student_count} students`));
    sub.appendChild(el('span', '', d.active_borrows > 0 ? `${d.active_borrows} active` : 'No active loans'));
    row.appendChild(top);
    row.appendChild(sub);
    deptList.appendChild(row);
  });
}

function renderCirculation() {
  const stuSel = document.getElementById('borrow-student');
  const prevStu = stuSel.value;
  clearNode(stuSel);
  stuSel.appendChild(el('option', '', 'Choose a student...'));
  stuSel.firstChild.value = '';
  state.students.forEach((s) => {
    const opt = el('option', '', `${s.usn} — ${s.name}${s.department ? ` (${s.department})` : ''}`);
    opt.value = s.usn;
    stuSel.appendChild(opt);
  });
  if (prevStu) stuSel.value = prevStu;

  const bookSel = document.getElementById('borrow-book');
  const prevBook = bookSel.value;
  clearNode(bookSel);
  bookSel.appendChild(el('option', '', 'Choose an available book...'));
  bookSel.firstChild.value = '';
  state.books.filter((b) => !b.is_borrowed).forEach((b) => {
    const opt = el('option', '', `#${b.book_id} — ${b.book_name}${b.author ? ` (${b.author})` : ''}`);
    opt.value = String(b.book_id);
    bookSel.appendChild(opt);
  });
  if (prevBook) bookSel.value = prevBook;

  const q = document.getElementById('active-loan-search').value.trim().toLowerCase();
  const active = state.transactions.filter((tx) => !tx.return_status && (
    !q ||
    tx.usn.toLowerCase().includes(q) ||
    tx.student_name.toLowerCase().includes(q) ||
    tx.book_name.toLowerCase().includes(q) ||
    String(tx.book_id).includes(q)
  ));
  document.getElementById('active-loans-count').textContent = `${active.length} active loans`;

  const tbody = document.getElementById('active-loans-body');
  clearNode(tbody);
  active.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'mono', `#${tx.transaction_id}`));
    const tdStu = document.createElement('td');
    tdStu.appendChild(el('div', '', tx.student_name));
    tdStu.appendChild(el('div', 'subline mono', tx.usn));
    tr.appendChild(tdStu);
    const tdBk = document.createElement('td');
    tdBk.appendChild(el('div', '', tx.book_name));
    tdBk.appendChild(el('div', 'subline', `#${tx.book_id}`));
    tr.appendChild(tdBk);
    tr.appendChild(el('td', 'tabular-nums', formatDate(tx.borrow_date)));
    const tdAct = el('td', 'text-right');
    const btn = el('button', 'btn btn-primary btn-sm', 'Mark Returned');
    btn.type = 'button';
    btn.addEventListener('click', () => handleReturn(tx.transaction_id));
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

function renderBooks() {
  const q = document.getElementById('book-search').value.trim().toLowerCase();
  const status = document.getElementById('book-status-filter').value;
  const rows = state.books.filter((b) => {
    if (status === 'available' && b.is_borrowed) return false;
    if (status === 'borrowed' && !b.is_borrowed) return false;
    if (!q) return true;
    return (
      String(b.book_id).includes(q) ||
      b.book_name.toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q) ||
      (b.borrowed_by_name || '').toLowerCase().includes(q)
    );
  });

  const tbody = document.getElementById('books-body');
  clearNode(tbody);
  rows.forEach((b) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'mono', `#${b.book_id}`));
    tr.appendChild(el('td', '', b.book_name));
    tr.appendChild(el('td', '', b.author || '—'));

    const tdAvail = document.createElement('td');
    if (b.is_borrowed) {
      tdAvail.appendChild(el('div', 'status-borrowed', 'Borrowed'));
      tdAvail.appendChild(el('div', 'subline', `${b.borrowed_by_name} · ${b.borrowed_by_usn}`));
    } else {
      tdAvail.appendChild(el('span', 'status-returned', 'Available'));
    }
    tr.appendChild(tdAvail);

    tr.appendChild(el('td', 'text-right mono', b.total_borrows));

    const tdAct = el('td', 'text-right');
    const editBtn = el('button', 'btn btn-secondary btn-sm', 'Edit');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openBookModal(b));
    const delBtn = el('button', 'btn btn-secondary btn-sm', 'Delete');
    delBtn.type = 'button';
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', () => deleteBook(b.book_id));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

function renderStudents() {
  const deptSel = document.getElementById('student-dept-filter');
  const currentDept = deptSel.value || 'all';
  const depts = Array.from(new Set(state.students.map((s) => s.department).filter(Boolean))).sort();
  clearNode(deptSel);
  const allOpt = el('option', '', 'All Departments');
  allOpt.value = 'all';
  deptSel.appendChild(allOpt);
  depts.forEach((d) => {
    const opt = el('option', '', d);
    opt.value = d;
    deptSel.appendChild(opt);
  });
  deptSel.value = currentDept;

  const q = document.getElementById('student-search').value.trim().toLowerCase();
  const rows = state.students.filter((s) => {
    if (currentDept !== 'all' && (s.department || 'Unassigned') !== currentDept) return false;
    if (!q) return true;
    return s.usn.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.department || '').toLowerCase().includes(q);
  });

  const tbody = document.getElementById('students-body');
  clearNode(tbody);
  rows.forEach((s) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'mono', s.usn));
    tr.appendChild(el('td', '', s.name));
    tr.appendChild(el('td', '', s.department || 'Unassigned'));
    tr.appendChild(el('td', 'text-right mono', s.active_borrows));
    tr.appendChild(el('td', 'text-right mono', s.returned_count));
    tr.appendChild(el('td', 'text-right mono', s.total_borrows));

    const tdAct = el('td', 'text-right');
    const histBtn = el('button', 'btn btn-secondary btn-sm', 'History');
    histBtn.type = 'button';
    histBtn.addEventListener('click', () => openStudentHistoryModal(s));
    const editBtn = el('button', 'btn btn-secondary btn-sm', 'Edit');
    editBtn.type = 'button';
    editBtn.style.marginLeft = '6px';
    editBtn.addEventListener('click', () => openStudentModal(s));
    const delBtn = el('button', 'btn btn-secondary btn-sm', 'Delete');
    delBtn.type = 'button';
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', () => deleteStudent(s.usn));
    tdAct.appendChild(histBtn);
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

function renderHistory() {
  const q = document.getElementById('history-search').value.trim().toLowerCase();
  const status = document.getElementById('history-status-filter').value;
  const rows = state.transactions.filter((tx) => {
    if (status === 'borrowed' && tx.return_status) return false;
    if (status === 'returned' && !tx.return_status) return false;
    if (!q) return true;
    return (
      String(tx.transaction_id).includes(q) ||
      tx.usn.toLowerCase().includes(q) ||
      tx.student_name.toLowerCase().includes(q) ||
      tx.book_name.toLowerCase().includes(q) ||
      (tx.author || '').toLowerCase().includes(q)
    );
  });

  const tbody = document.getElementById('history-body');
  clearNode(tbody);
  rows.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'mono', `#${tx.transaction_id}`));
    const tdStu = document.createElement('td');
    tdStu.appendChild(el('div', '', tx.student_name));
    tdStu.appendChild(el('div', 'subline mono', `${tx.usn}${tx.department ? ` · ${tx.department}` : ''}`));
    tr.appendChild(tdStu);
    const tdBk = document.createElement('td');
    tdBk.appendChild(el('div', '', tx.book_name));
    tdBk.appendChild(el('div', 'subline', `#${tx.book_id}${tx.author ? ` · ${tx.author}` : ''}`));
    tr.appendChild(tdBk);
    tr.appendChild(el('td', 'tabular-nums', formatDate(tx.borrow_date)));
    tr.appendChild(el('td', tx.return_status ? 'status-returned' : 'status-borrowed', tx.return_status ? 'Returned' : 'Borrowed'));

    const tdAct = el('td', 'text-right');
    if (!tx.return_status) {
      const retBtn = el('button', 'btn btn-secondary btn-sm', 'Return');
      retBtn.type = 'button';
      retBtn.addEventListener('click', () => handleReturn(tx.transaction_id));
      tdAct.appendChild(retBtn);
    }
    const delBtn = el('button', 'btn btn-secondary btn-sm', 'Delete');
    delBtn.type = 'button';
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', () => deleteTransaction(tx.transaction_id));
    tdAct.appendChild(delBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

function renderAll() {
  document.getElementById('sidebar-counts').textContent = `${state.books.length} books · ${state.students.length} students`;
  renderOverview();
  renderCirculation();
  renderBooks();
  renderStudents();
  renderHistory();
}

async function loadAllData() {
  try {
    const [dashboard, students, books, transactions] = await Promise.all([
      apiRequest('/api/dashboard'),
      apiRequest('/api/students'),
      apiRequest('/api/books'),
      apiRequest('/api/transactions'),
    ]);
    document.getElementById('config-banner').classList.add('hidden');
    state.dashboard = dashboard;
    state.students = students;
    state.books = books;
    state.transactions = transactions;
    renderAll();
  } catch (err) {
    if (err.code === 'DB_NOT_CONFIGURED') {
      document.getElementById('config-banner').classList.remove('hidden');
    } else {
      showToast(err.message, 'error');
    }
  }
}

async function handleReturn(txId) {
  try {
    const updated = await apiRequest(`/api/transactions/${txId}/return`, { method: 'PATCH' });
    showToast(`Marked "${updated.book_name}" returned.`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteBook(bookId) {
  try {
    await apiRequest(`/api/books/${bookId}`, { method: 'DELETE' });
    showToast(`Removed book #${bookId}.`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteStudent(usn) {
  try {
    await apiRequest(`/api/students/${encodeURIComponent(usn)}`, { method: 'DELETE' });
    showToast(`Removed student ${usn}.`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTransaction(txId) {
  try {
    await apiRequest(`/api/transactions/${txId}`, { method: 'DELETE' });
    showToast(`Deleted transaction #${txId}.`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openBookModal(book = null) {
  openModal(book ? `Edit Book #${book.book_id}` : 'Add New Book', (body) => {
    const form = el('form', 'form-stack');
    if (!book) {
      const fId = el('div', 'field');
      fId.appendChild(el('label', '', 'Book ID (optional)'));
      const inId = el('input', 'input');
      inId.type = 'number';
      inId.name = 'book_id';
      fId.appendChild(inId);
      form.appendChild(fId);
    }
    const fTitle = el('div', 'field');
    fTitle.appendChild(el('label', '', 'Book Title'));
    const inTitle = el('input', 'input');
    inTitle.required = true;
    inTitle.name = 'book_name';
    inTitle.value = book ? book.book_name : '';
    fTitle.appendChild(inTitle);
    form.appendChild(fTitle);

    const fAuthor = el('div', 'field');
    fAuthor.appendChild(el('label', '', 'Author'));
    const inAuthor = el('input', 'input');
    inAuthor.name = 'author';
    inAuthor.value = book && book.author ? book.author : '';
    fAuthor.appendChild(inAuthor);
    form.appendChild(fAuthor);

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const save = el('button', 'btn btn-primary', 'Save Book');
    save.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (book) {
          await apiRequest(`/api/books/${book.book_id}`, {
            method: 'PUT',
            body: JSON.stringify({ book_name: inTitle.value, author: inAuthor.value }),
          });
          showToast('Book updated.');
        } else {
          const payload = { book_name: inTitle.value, author: inAuthor.value };
          const idInput = form.querySelector('[name="book_id"]');
          if (idInput && idInput.value.trim()) payload.book_id = Number(idInput.value);
          await apiRequest('/api/books', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Book added.');
        }
        closeModal();
        await loadAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    body.appendChild(form);
  });
}

function openStudentModal(student = null) {
  openModal(student ? `Edit Student — ${student.usn}` : 'Register Student', (body) => {
    const form = el('form', 'form-stack');
    if (!student) {
      const fUsn = el('div', 'field');
      fUsn.appendChild(el('label', '', 'USN'));
      const inUsn = el('input', 'input');
      inUsn.required = true;
      inUsn.name = 'usn';
      fUsn.appendChild(inUsn);
      form.appendChild(fUsn);
    }
    const fName = el('div', 'field');
    fName.appendChild(el('label', '', 'Full Name'));
    const inName = el('input', 'input');
    inName.required = true;
    inName.value = student ? student.name : '';
    fName.appendChild(inName);
    form.appendChild(fName);

    const fDept = el('div', 'field');
    fDept.appendChild(el('label', '', 'Department'));
    const inDept = el('input', 'input');
    inDept.value = student && student.department ? student.department : '';
    fDept.appendChild(inDept);
    form.appendChild(fDept);

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const save = el('button', 'btn btn-primary', 'Save Student');
    save.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (student) {
          await apiRequest(`/api/students/${encodeURIComponent(student.usn)}`, {
            method: 'PUT',
            body: JSON.stringify({ name: inName.value, department: inDept.value }),
          });
          showToast('Student updated.');
        } else {
          const usnInput = form.querySelector('[name="usn"]');
          await apiRequest('/api/students', {
            method: 'POST',
            body: JSON.stringify({ usn: usnInput.value, name: inName.value, department: inDept.value }),
          });
          showToast('Student registered.');
        }
        closeModal();
        await loadAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    body.appendChild(form);
  });
}

async function openStudentHistoryModal(student) {
  openModal(`${student.name} (${student.usn}) — History`, (body) => {
    body.appendChild(el('p', 'subline', 'Loading borrowing history...'));
  });
  try {
    const res = await apiRequest(`/api/students/${encodeURIComponent(student.usn)}/history`);
    const body = document.getElementById('modal-body');
    clearNode(body);
    if (res.transactions.length === 0) {
      body.appendChild(el('p', 'subline', 'No books borrowed by this student yet.'));
      return;
    }
    const list = el('div', 'dept-list');
    res.transactions.forEach((tx) => {
      const row = el('div', 'dept-row');
      const top = el('div', 'dept-top');
      top.appendChild(el('span', '', `#${tx.book_id} · ${tx.book_name}`));
      top.appendChild(el('span', tx.return_status ? 'status-returned' : 'status-borrowed', tx.return_status ? 'Returned' : 'Borrowed'));
      row.appendChild(top);
      row.appendChild(el('div', 'subline', `TX #${tx.transaction_id} · ${formatDate(tx.borrow_date)}`));
      list.appendChild(row);
    });
    body.appendChild(list);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('open-menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mobile-backdrop').classList.remove('hidden');
});
document.getElementById('close-menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-backdrop').classList.add('hidden');
});
document.getElementById('mobile-backdrop').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-backdrop').classList.add('hidden');
});

document.getElementById('refresh-btn').addEventListener('click', loadAllData);
document.getElementById('open-issue-modal-btn').addEventListener('click', () => switchTab('circulation'));
document.getElementById('add-book-btn').addEventListener('click', () => openBookModal(null));
document.getElementById('add-student-btn').addEventListener('click', () => openStudentModal(null));
document.getElementById('modal-close-btn').addEventListener('click', closeModal);

document.getElementById('borrow-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usn = document.getElementById('borrow-student').value;
  const bookId = Number(document.getElementById('borrow-book').value);
  try {
    const created = await apiRequest('/api/transactions/borrow', {
      method: 'POST',
      body: JSON.stringify({ usn, book_id: bookId }),
    });
    showToast(`Issued "${created.book_name}" to ${created.student_name}.`);
    await loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('active-loan-search').addEventListener('input', renderCirculation);
document.getElementById('book-search').addEventListener('input', renderBooks);
document.getElementById('book-status-filter').addEventListener('change', renderBooks);
document.getElementById('student-search').addEventListener('input', renderStudents);
document.getElementById('student-dept-filter').addEventListener('change', renderStudents);
document.getElementById('history-search').addEventListener('input', renderHistory);
document.getElementById('history-status-filter').addEventListener('change', renderHistory);

loadAllData();
