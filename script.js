const firebaseConfig = {
    apiKey: "AIzaSyDyWy1LpQesOhWCZhx1eB2xUJckuJyb7aU",
    authDomain: "gerenciador-de-sprint-pro.firebaseapp.com",
    projectId: "gerenciador-de-sprint-pro",
    storageBucket: "gerenciador-de-sprint-pro.firebasestorage.app",
    messagingSenderId: "899758954780",
    appId: "1:899758954780:web:932c8fd50b8ae6978742d9",
    measurementId: "G-NEKMK6Z2TB"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let dbListenerUnsubscribe = null;
let isDragging = false;
let syncTimeout = null;
let isSavingLocally = false;
let boardSortableInstance = null;

auth.onAuthStateChanged(user => {
    const loginScreen = document.getElementById('loginOverlay');
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        loadFromFirebase();
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
        if (dbListenerUnsubscribe) dbListenerUnsubscribe();
    }
});

async function loginFirebase() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const errObj = document.getElementById('loginError');
    if (!email || !pass) { errObj.innerText = "Preencha e-mail e senha."; errObj.style.display = 'block'; return; }
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        errObj.style.display = 'none';
    } catch (error) {
        errObj.innerText = "Erro: E-mail ou senha incorretos.";
        errObj.style.display = 'block';
    }
}

async function registerFirebase() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const errObj = document.getElementById('loginError');
    if (!email || !pass) { errObj.innerText = "Preencha e-mail e senha."; errObj.style.display = 'block'; return; }
    try {
        await auth.createUserWithEmailAndPassword(email, pass);
        errObj.style.display = 'none';
        await showSysAlert("Conta criada com sucesso! Ambiente pronto.");
    } catch (error) {
        errObj.innerText = "Erro: " + error.message;
        errObj.style.display = 'block';
    }
}

function logoutFirebase() {
    if (dbListenerUnsubscribe) dbListenerUnsubscribe();
    auth.signOut().then(() => window.location.reload());
}

let theme = localStorage.getItem('nexus_theme') || 'light';
let currentBg = localStorage.getItem('nexus_bg') || 'default';
let allBoardsData = {};
let boards = [];
let currentBoardId = null;
let boardTitle = '';
let columns = [];
let tasks = [];
let currentBoardMembers = [];

const defaultTags = [
    { name: "💻 Desenvolvimento", color: "#3b82f6" },
    { name: "🐛 Bug Fix", color: "#ef4444" },
    { name: "🧪 Teste", color: "#10b981" },
    { name: "📅 Reunião", color: "#8b5cf6" },
    { name: "🚀 Deploy", color: "#f59e0b" },
    { name: "🎨 Design", color: "#ec4899" }
];
let tags = [...defaultTags];

let currentTagFilter = 'all';
let filterMyTasksOnly = false;
let searchTerm = '';
let editingTaskId = null;
let currentTargetColumn = null;
let tempSubtasks = [];
let tempComments = [];
let tempHistory = [];
let isCalendarView = false;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

let tagsChartInstance = null;
let statusChartInstance = null;
let priorityChartInstance = null;
let assigneeChartInstance = null;

let modalSelectedAssignees = [];

function showSysModal(title, message, type = 'alert', placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('sysOverlay');
        const titleEl = document.getElementById('sysTitle');
        const msgEl = document.getElementById('sysMessage');
        const inputEl = document.getElementById('sysInput');
        const btnConfirm = document.getElementById('sysBtnConfirm');
        const btnCancel = document.getElementById('sysBtnCancel');

        titleEl.innerText = title;
        msgEl.innerText = message;
        inputEl.value = '';

        inputEl.style.display = type === 'prompt' ? 'block' : 'none';
        inputEl.placeholder = placeholder;

        btnCancel.style.display = 'flex';
        btnCancel.innerText = type === 'alert' ? 'Fechar' : 'Cancelar';

        btnConfirm.style.display = type === 'alert' ? 'none' : 'flex';
        btnConfirm.innerText = 'OK';
        btnConfirm.className = 'btn-primary';

        if (title.toLowerCase().includes('excluir') || title.toLowerCase().includes('limpar')) {
            btnConfirm.style.background = '#ef4444';
            btnConfirm.style.borderColor = '#ef4444';
        } else {
            btnConfirm.style.background = '';
            btnConfirm.style.borderColor = '';
        }

        overlay.classList.add('active');
        if (type === 'prompt') setTimeout(() => inputEl.focus(), 100);

        const close = (value) => {
            overlay.classList.remove('active');
            resolve(value);
        };

        btnConfirm.onclick = () => close(type === 'prompt' ? inputEl.value : true);
        btnCancel.onclick = () => close(type === 'prompt' ? null : false);
        inputEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btnConfirm.click(); } };
    });
}

async function showSysAlert(message) { return await showSysModal('Aviso', message, 'alert'); }
async function showSysConfirm(message, title = 'Confirmação') { return await showSysModal(title, message, 'confirm'); }
async function showSysPrompt(title, placeholder = '') { return await showSysModal(title, '', 'prompt', placeholder); }

async function loadFromFirebase() {
    if (!currentUser) return;
    try {
        if (dbListenerUnsubscribe) dbListenerUnsubscribe();

        dbListenerUnsubscribe = db.collection('boards').where('members', 'array-contains', currentUser.email)
            .onSnapshot(snapshot => {
                let newBoards = [];
                let newAllBoardsData = {};

                snapshot.forEach(doc => {
                    const data = doc.data();
                    let dbTags = data.tags || [];

                    let parsedTags = dbTags.map(t => {
                        let tagObj = typeof t === 'string' ? { name: t, color: '#3b82f6' } : { ...t };
                        if (tagObj.name.includes('Treino')) {
                            tagObj.name = '🧪 Teste';
                            tagObj.color = '#10b981';
                        }
                        return tagObj;
                    });

                    defaultTags.forEach(defTag => {
                        if (!parsedTags.find(pt => pt.name === defTag.name)) {
                            parsedTags.push({ ...defTag });
                        }
                    });

                    newBoards.push({ id: doc.id, title: data.title, owner: data.owner });
                    newAllBoardsData[doc.id] = {
                        tasks: data.tasks_string ? JSON.parse(data.tasks_string) : [],
                        columns: data.columns_string ? JSON.parse(data.columns_string) : [],
                        members: data.members || [currentUser.email],
                        tags: parsedTags,
                        owner: data.owner
                    };
                });

                boards = newBoards;

                if (boards.length === 0) {
                    if (!document.getElementById('sysOverlay').classList.contains('active') && !document.getElementById('templateOverlay').classList.contains('active')) {
                        openTemplateModal();
                    }
                    return;
                }

                renderBoardsList();

                if (!currentBoardId || !newAllBoardsData[currentBoardId]) {
                    allBoardsData = newAllBoardsData;
                    if (boards.length > 0) loadBoardData(boards[0].id);
                } else {
                    const activeData = newAllBoardsData[currentBoardId];
                    let needsRender = false;

                    if (!isSavingLocally && !isDragging) {
                        if (JSON.stringify(activeData.tasks) !== JSON.stringify(tasks)) { tasks = activeData.tasks; needsRender = true; }
                        if (JSON.stringify(activeData.columns) !== JSON.stringify(columns)) { columns = activeData.columns; needsRender = true; }
                        if (JSON.stringify(activeData.tags) !== JSON.stringify(tags)) { tags = activeData.tags; updateTagsDropdown(); needsRender = true; }
                    }

                    const boardObj = boards.find(b => b.id === currentBoardId);
                    if (boardObj && boardObj.title !== boardTitle) {
                        boardTitle = boardObj.title;
                        document.getElementById('boardTitle').innerText = boardTitle;
                    }

                    if (JSON.stringify(activeData.members) !== JSON.stringify(currentBoardMembers)) {
                        currentBoardMembers = activeData.members;
                        if (document.getElementById('shareOverlay').classList.contains('active')) renderMembersList();
                    }

                    const isOwner = activeData.owner === currentUser.email;
                    if (document.getElementById('btnShareBoard')) document.getElementById('btnShareBoard').style.display = isOwner ? 'block' : 'none';
                    if (document.getElementById('btnDeleteBoard')) document.getElementById('btnDeleteBoard').style.display = isOwner ? 'block' : 'none';

                    allBoardsData = newAllBoardsData;
                    if (needsRender) render();
                }
            }, error => {
                console.error("Erro Live DB:", error);
                showSysAlert("Conexão perdida. Recarregue a página.");
            });
    } catch (error) {
        console.error(error);
        showSysAlert("Erro ao baixar dados da nuvem.");
    }
}

function loadBoardData(boardId) {
    currentBoardId = boardId;
    const bData = allBoardsData[boardId];
    if (!bData) return;

    tasks = bData.tasks || [];
    columns = bData.columns || [{ id: 'todo', title: 'Pendências' }, { id: 'done', title: 'Concluído' }];

    tasks.forEach(t => {
        if (!t.assignees) {
            t.assignees = t.assignee ? [t.assignee] : [];
        }
    });

    tags = bData.tags || [...defaultTags];
    currentBoardMembers = bData.members || [currentUser.email];
    boardTitle = boards.find(b => b.id === boardId)?.title || 'Meu Quadro';
    document.getElementById('boardTitle').innerText = boardTitle;

    const isOwner = bData.owner === currentUser.email;
    if (document.getElementById('btnShareBoard')) document.getElementById('btnShareBoard').style.display = isOwner ? 'block' : 'none';
    if (document.getElementById('btnDeleteBoard')) document.getElementById('btnDeleteBoard').style.display = isOwner ? 'block' : 'none';

    renderBoardsList();
    updateTagsDropdown();
    render();
}

function syncToFirebase() {
    if (!currentUser || !currentBoardId) return;

    allBoardsData[currentBoardId].tasks = tasks;
    allBoardsData[currentBoardId].columns = columns;
    allBoardsData[currentBoardId].tags = tags;
    allBoardsData[currentBoardId].members = currentBoardMembers;

    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }

    isSavingLocally = true;

    syncTimeout = setTimeout(() => {
        db.collection('boards').doc(currentBoardId).set({
            title: boardTitle,
            tasks_string: JSON.stringify(tasks),
            columns_string: JSON.stringify(columns),
            tags: tags,
            members: currentBoardMembers,
            owner: allBoardsData[currentBoardId].owner || currentUser.email,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
            .then(() => {
                isSavingLocally = false;
                syncTimeout = null;
            })
            .catch(err => {
                console.error("Erro Firebase:", err);
                isSavingLocally = false;
                syncTimeout = null;
            });
    }, 600);
}

function openTemplateModal() { document.getElementById('templateOverlay').classList.add('active'); }
function closeTemplateModal() { document.getElementById('templateOverlay').classList.remove('active'); }

async function applyTemplate(type) {
    closeTemplateModal();
    const title = await showSysPrompt("Nome do novo quadro:");
    if (!title) {
        if (boards.length === 0) openTemplateModal();
        return;
    }

    let initCols = [];
    if (type === 'sprint') {
        initCols = [{ id: 'col-1', title: 'Backlog' }, { id: 'col-2', title: 'Em Dev' }, { id: 'col-3', title: 'Code Review' }, { id: 'col-4', title: 'Deploy / Concluído' }];
    } else if (type === 'evento') {
        initCols = [{ id: 'col-1', title: 'Planejamento' }, { id: 'col-2', title: 'Pendências' }, { id: 'col-3', title: 'Em Execução' }, { id: 'col-4', title: 'Finalizado' }];
    } else {
        initCols = [{ id: 'col-1', title: 'A Fazer' }, { id: 'col-2', title: 'Fazendo' }, { id: 'col-3', title: 'Concluído' }];
    }

    const newId = 'board-' + Date.now();
    const newBoardData = {
        title: title, owner: currentUser.email, members: [currentUser.email],
        tasks_string: "[]", columns_string: JSON.stringify(initCols), tags: [...defaultTags]
    };

    currentBoardId = newId;
    await db.collection('boards').doc(newId).set(newBoardData);
}

function switchBoard(boardId) {
    syncToFirebase();
    loadBoardData(boardId);
}

async function deleteCurrentBoard() {
    if (allBoardsData[currentBoardId].owner !== currentUser.email) {
        return showSysAlert("Apenas o criador do quadro pode excluí-lo.");
    }
    if (boards.length <= 1) {
        return showSysAlert("Você não pode excluir o único quadro restante.");
    }
    const confirmed = await showSysConfirm("Tem certeza? Isso apagará este quadro para TODOS os membros.", "Excluir Quadro");
    if (confirmed) {
        const idToDelete = currentBoardId;
        currentBoardId = boards.find(b => b.id !== idToDelete).id;
        await db.collection('boards').doc(idToDelete).delete();
    }
}

function saveTitle() {
    boardTitle = document.getElementById('boardTitle').innerText;
    const boardIndex = boards.findIndex(b => b.id === currentBoardId);
    if (boardIndex > -1) { boards[boardIndex].title = boardTitle; }
    renderBoardsList();
    syncToFirebase();
}

function applyFilters() {
    currentTagFilter = document.getElementById('filterTag').value;
    searchTerm = document.getElementById('searchInput').value.toLowerCase();
    render();
}

function toggleMyTasks() {
    filterMyTasksOnly = !filterMyTasksOnly;
    const btn = document.getElementById('btnMyTasks');
    btn.style.background = filterMyTasksOnly ? 'var(--accent)' : 'transparent';
    btn.style.color = filterMyTasksOnly ? 'white' : 'var(--text-sub)';
    render();
}

function render() {
    if (isCalendarView) { renderCalendar(); return; }
    document.getElementById('boardMain').style.display = 'flex';
    document.getElementById('calendarMain').style.display = 'none';

    const board = document.getElementById('boardMain');
    board.innerHTML = '';

    const filteredTasks = tasks.filter(t => {
        if (!t.assignees) t.assignees = t.assignee ? [t.assignee] : [];
        const tObj = typeof t.tag === 'string' ? { name: t.tag } : (t.tag || { name: '' });
        const matchTag = currentTagFilter === 'all' || tObj.name === currentTagFilter;
        const matchMyTasks = filterMyTasksOnly ? t.assignees.includes(currentUser.email) : true;
        const term = searchTerm ? searchTerm.toLowerCase() : '';
        const titleMatch = t.text.toLowerCase().includes(term);
        return matchTag && matchMyTasks && (term === '' || titleMatch);
    });

    columns.forEach(col => {
        const columnEl = document.createElement('div');
        columnEl.className = 'column';
        columnEl.id = col.id;
        const count = filteredTasks.filter(t => t.status === col.id).length;

        columnEl.innerHTML = `
            <div class="column-header">
                <div style="display:flex; align-items:center;">
                    <span contenteditable="true" class="column-title-edit" onblur="updateColumnTitle('${col.id}', this.innerText)">${col.title}</span>
                    <button class="btn-add-rounded" onclick="openModal(null, '${col.id}')" style="margin-left: 10px;" title="Adicionar nesta coluna">+</button>
                </div>
                <div style="display:flex; align-items:center;">
                    <span id="count-${col.id}" class="count-badge">${count}</span>
                    <button class="column-delete-btn" onclick="deleteColumn('${col.id}')" title="Excluir Coluna">✖</button>
                </div>
            </div>
            <div class="tasks-container" data-status="${col.id}"></div>
        `;
        board.appendChild(columnEl);
        const container = columnEl.querySelector('.tasks-container');

        filteredTasks.filter(t => t.status === col.id).forEach(t => {
            const isDoneCol = col.id === 'done' || col.title.toLowerCase().includes('conclu');
            const card = document.createElement('div');
            card.className = `card ${isDoneCol ? 'finalizado' : ''}`; card.id = t.id;

            card.onclick = (e) => {
                if (!e.target.classList.contains('card-cover')) {
                    openModal(t.id);
                }
            };

            let coverHtml = t.cover ? `<img src="${t.cover}" class="card-cover" onclick="openImageViewer(event, this.src)" title="Clique para ampliar">` : '';

            let dateHtml = '';
            if (t.startDate || t.endDate) {
                let sDate = formatDate(t.startDate);
                let eDate = formatDate(t.endDate);
                let displayDate = sDate && eDate ? `${sDate} - ${eDate}` : (sDate || eDate);
                const isOverdue = t.endDate && t.endDate < getTodayString() && !isDoneCol;
                dateHtml = `<div class="date-display ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠️' : '📅'} ${displayDate}</div>`;
            }

            const tagObj = tags.find(x => x.name === (t.tag?.name || t.tag)) || { name: t.tag?.name || t.tag, color: '#3b82f6' };

            let priorityBadge = `<div class="prio-badge prio-${t.priority || 'Média'}">${t.priority || 'Média'}</div>`;

            let avatarsHtml = '';
            if (t.assignees && t.assignees.length > 0) {
                avatarsHtml = '<div class="avatar-group">';
                t.assignees.forEach(assignee => {
                    let avatarName = assignee.split('@')[0];
                    avatarsHtml += `<div class="avatar" title="${assignee}">${avatarName.charAt(0).toUpperCase()}</div>`;
                });
                avatarsHtml += '</div>';
            }

            let progressHtml = '';
            if (t.subtasks && t.subtasks.length > 0) {
                const total = t.subtasks.length;
                const doneCount = t.subtasks.filter(s => s.done).length;
                const pct = Math.round((doneCount / total) * 100);
                progressHtml = `<div style="font-size: 10px; color: var(--text-sub); margin-top: 5px;">Checklist ${doneCount}/${total}</div><div class="prog-track" style="height:4px; margin-top:4px;"><div class="prog-fill" style="width: ${pct}%; background: var(--accent);"></div></div>`;
            }

            card.innerHTML = `
                ${coverHtml}
                <div class="tag-row"><div class="tag" style="background:${tagObj.color}">${tagObj.name}</div>${dateHtml}</div>
                <span class="card-text">${t.text}</span>
                ${progressHtml}
                <div class="card-footer">
                    ${priorityBadge}
                    ${avatarsHtml}
                </div>
            `;
            container.appendChild(card);
        });
    });

    updateMetrics(filteredTasks);
    setupCardDragAndDrop();
    setupColumnDragAndDrop();
}

function setupCardDragAndDrop() {
    document.querySelectorAll('.tasks-container').forEach(container => {
        new Sortable(container, {
            group: 'shared', animation: 150, ghostClass: 'sortable-ghost', delay: 100, delayOnTouchOnly: true,
            onStart: function () {
                isDragging = true;
            },
            onEnd: function (evt) {
                isDragging = false;
                const itemEl = evt.item;
                const newStatus = evt.to.getAttribute('data-status');
                const task = tasks.find(t => t.id === itemEl.id);

                if (task) {
                    const targetCol = columns.find(c => c.id === newStatus);

                    if (task.status !== newStatus) {
                        if (!task.history) task.history = [];
                        task.history.unshift({ date: new Date().toISOString(), user: currentUser.email, action: `Moveu para "${targetCol?.title}"` });
                    }

                    task.status = newStatus;
                    const isDoneTarget = targetCol?.title.toLowerCase().includes('conclu');
                    if (isDoneTarget) {
                        task.endDate = getTodayString();
                        fireConfetti();
                    }
                }

                const newOrderIds = Array.from(document.querySelectorAll('.card')).map(c => c.id);
                let newTasks = [];
                let map = new Map(tasks.map(t => [t.id, t]));

                newOrderIds.forEach(id => {
                    if (map.has(id)) {
                        newTasks.push(map.get(id));
                        map.delete(id);
                    }
                });

                tasks = [...newTasks, ...Array.from(map.values())];
                syncToFirebase();
                setTimeout(() => { render(); }, 50);
            }
        });
    });
}

function setupColumnDragAndDrop() {
    if (boardSortableInstance) {
        boardSortableInstance.destroy();
    }

    boardSortableInstance = new Sortable(document.getElementById('boardMain'), {
        handle: '.column-header', animation: 150, ghostClass: 'sortable-ghost-column', delay: 100, delayOnTouchOnly: true,
        onStart: function () {
            isDragging = true;
        },
        onEnd: function () {
            isDragging = false;
            let n = [];
            document.querySelectorAll('.column').forEach(e => {
                let c = columns.find(x => x.id === e.id);
                if (c) n.push(c);
            });
            columns = n;
            syncToFirebase();
            setTimeout(() => { render(); }, 50);
        }
    });
}

function save() {
    render();
    syncToFirebase();
}

function saveColumns() {
    render();
    syncToFirebase();
}

function openModal(taskId = null, initialStatus = null) {
    const modal = document.getElementById('modalOverlay');
    document.getElementById('modalTaskInput').value = '';
    document.getElementById('modalDescriptionInput').value = '';
    document.getElementById('modalDateStart').value = '';
    document.getElementById('modalDateEnd').value = '';
    document.getElementById('subtaskInput').value = '';
    document.getElementById('subtaskList').innerHTML = '';
    document.getElementById('commentInput').value = '';
    removeCover({ stopPropagation: () => { } });

    currentTargetColumn = initialStatus;

    if (taskId) {
        editingTaskId = taskId; const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        document.getElementById('modalTitle').innerText = "Detalhes da Tarefa";
        document.getElementById('modalSaveBtn').innerText = "Atualizar Tarefa";
        document.getElementById('modalDeleteBtn').style.display = 'block';

        document.getElementById('modalTaskInput').value = task.text;
        document.getElementById('modalDescriptionInput').value = task.description || '';
        document.getElementById('modalTagInput').value = task.tag?.name || task.tag || '';
        updateColorPicker();

        document.getElementById('modalPriorityInput').value = task.priority || 'Média';
        document.getElementById('modalDateStart').value = task.startDate || '';
        document.getElementById('modalDateEnd').value = task.endDate || '';

        modalSelectedAssignees = task.assignees ? [...task.assignees] : (task.assignee ? [task.assignee] : []);

        if (task.cover) setCoverImage(task.cover);
        tempSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
        tempComments = task.comments ? JSON.parse(JSON.stringify(task.comments)) : [];
        tempHistory = task.history || [];
    } else {
        editingTaskId = null;
        document.getElementById('modalTitle').innerText = "Nova Tarefa";
        document.getElementById('modalSaveBtn').innerText = "Criar Tarefa";
        document.getElementById('modalDeleteBtn').style.display = 'none';

        tempSubtasks = []; tempComments = []; tempHistory = [];
        document.getElementById('modalDateStart').value = getTodayString();
        modalSelectedAssignees = [];

        if (tags.length > 0) {
            document.getElementById('modalTagInput').selectedIndex = 0;
            updateColorPicker();
        }
    }

    renderAssigneeSelect();
    renderAssigneeChips();
    renderSubtasksList();
    renderCommentsList();
    renderHistory();
    switchDescTab('preview');
    switchBottomTab('comments');
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    editingTaskId = null;
    currentTargetColumn = null;
}

async function saveTaskBtnClick() {
    const text = document.getElementById('modalTaskInput').value.trim();
    if (!text) { await showSysAlert("O Título da tarefa é obrigatório."); return; }

    const tagSelectVal = document.getElementById('modalTagInput').value;
    const tagObj = tags.find(t => t.name === tagSelectVal) || { name: tagSelectVal, color: '#3b82f6' };

    const selectedAssignees = Array.from(document.querySelectorAll('#modalAssigneeContainer .assignee-chip')).map(chip => chip.dataset.email);

    let newTaskData = {
        text: text,
        description: document.getElementById('modalDescriptionInput').value,
        tag: tagObj,
        priority: document.getElementById('modalPriorityInput').value,
        assignees: modalSelectedAssignees,
        cover: document.getElementById('modalCoverInput').value,
        startDate: document.getElementById('modalDateStart').value,
        endDate: document.getElementById('modalDateEnd').value,
        subtasks: tempSubtasks,
        comments: tempComments,
        history: tempHistory
    };

    if (editingTaskId) {
        const i = tasks.findIndex(t => t.id === editingTaskId);
        if (i > -1) {
            const oldAssignees = tasks[i].assignees || [];
            if (JSON.stringify(oldAssignees.sort()) !== JSON.stringify(newTaskData.assignees.sort())) {
                addHistoryLog(`Atualizou os responsáveis`);
            }
            tasks[i] = { ...tasks[i], ...newTaskData };
        }
    } else {
        newTaskData.id = 'id-' + Date.now();
        newTaskData.status = currentTargetColumn || (columns.length > 0 ? columns[0].id : 'todo');
        newTaskData.history = [{ date: new Date().toISOString(), user: currentUser.email, action: 'Criou a tarefa' }];
        tasks.push(newTaskData);
    }

    save();
    closeModal();
}

async function deleteTaskFromModal() {
    if (!editingTaskId) return;
    const ok = await showSysConfirm("Tem certeza absoluta que deseja excluir esta tarefa permanentemente?");
    if (ok) {
        tasks = tasks.filter(t => t.id !== editingTaskId);
        save();
        closeModal();
    }
}

function renderAssigneeSelect() {
    const select = document.getElementById('modalAssigneeSelect');
    const availableMembers = currentBoardMembers.filter(m => !modalSelectedAssignees.includes(m));
    select.innerHTML = `<option value="">+ Adicionar responsável...</option>` +
        availableMembers.map(m => `<option value="${m}">${m}</option>`).join('');
}

function renderAssigneeChips() {
    const container = document.getElementById('modalAssigneeContainer');
    container.innerHTML = modalSelectedAssignees.map(m =>
        `<div class="assignee-chip" data-email="${m}" onclick="removeAssigneeFromModal('${m}')" title="Clique para remover">${m.split('@')[0]} <span>&times;</span></div>`
    ).join('');
}

function addAssigneeFromSelect() {
    const select = document.getElementById('modalAssigneeSelect');
    const val = select.value;
    if (val && !modalSelectedAssignees.includes(val)) {
        modalSelectedAssignees.push(val);
        renderAssigneeSelect();
        renderAssigneeChips();
    }
}

function removeAssigneeFromModal(email) {
    modalSelectedAssignees = modalSelectedAssignees.filter(m => m !== email);
    renderAssigneeSelect();
    renderAssigneeChips();
}

function updateTagsDropdown() {
    const m = document.getElementById('modalTagInput');
    const f = document.getElementById('filterTag');
    const currVal = m.value;

    m.innerHTML = tags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    f.innerHTML = `<option value="all">🏷️ Todas as Tags</option>` + tags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');

    if (currVal && tags.find(t => t.name === currVal)) { m.value = currVal; }
    f.value = currentTagFilter;
    updateColorPicker();
}

function updateColorPicker() {
    const selectedTagName = document.getElementById('modalTagInput').value;
    const tag = tags.find(t => t.name === selectedTagName);
    if (tag && tag.color) document.getElementById('newTagColor').value = tag.color;
}

function updateCurrentTagColor() {
    const selectedTagName = document.getElementById('modalTagInput').value;
    const newColor = document.getElementById('newTagColor').value;
    const tagIndex = tags.findIndex(t => t.name === selectedTagName);

    if (tagIndex > -1) {
        tags[tagIndex].color = newColor;
        tasks.forEach(t => {
            if (t.tag && t.tag.name === selectedTagName) t.tag.color = newColor;
            else if (typeof t.tag === 'string' && t.tag === selectedTagName) t.tag = { name: selectedTagName, color: newColor };
        });
        syncToFirebase();
        render();
    }
}

async function addNewTag() {
    const tName = await showSysPrompt("Nome da Nova Tag:");
    if (tName) {
        const tColor = document.getElementById('newTagColor').value || '#3b82f6';
        if (!tags.find(x => x.name === tName)) {
            tags.push({ name: tName, color: tColor });
            updateTagsDropdown();
            document.getElementById('modalTagInput').value = tName;
            updateColorPicker();
            syncToFirebase();
        }
    }
}

function switchBottomTab(tab) {
    document.getElementById('btnTabComments').classList.remove('active');
    document.getElementById('btnTabHistory').classList.remove('active');
    document.getElementById('tabComments').style.display = 'none';
    document.getElementById('tabHistory').style.display = 'none';

    if (tab === 'comments') {
        document.getElementById('btnTabComments').classList.add('active');
        document.getElementById('tabComments').style.display = 'block';
    } else {
        document.getElementById('btnTabHistory').classList.add('active');
        document.getElementById('tabHistory').style.display = 'block';
    }
}

function addHistoryLog(action) { tempHistory.unshift({ date: new Date().toISOString(), user: currentUser.email, action: action }); }

function renderHistory() {
    const container = document.getElementById('historyList');
    if (tempHistory.length === 0) { container.innerHTML = '<div style="color:var(--text-sub); font-size:0.9rem; text-align:center; padding: 20px;">Nenhum registro de histórico.</div>'; return; }
    container.innerHTML = tempHistory.map(h => {
        const d = new Date(h.date);
        return `<div class="history-item"><b>${h.user.split('@')[0]}</b> ${h.action} <span style="font-size:0.75rem; opacity:0.6; margin-left:5px;">(${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span></div>`;
    }).join('');
}

function addComment() {
    const input = document.getElementById('commentInput');
    if (input.value.trim()) {
        const now = new Date();
        tempComments.push({ text: input.value.trim(), author: currentUser.email, date: now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        input.value = '';
        renderCommentsList();
        addHistoryLog("Adicionou um comentário");
    }
}

function renderCommentsList() {
    const container = document.getElementById('commentsList');
    if (tempComments.length === 0) { container.innerHTML = '<div style="color:var(--text-sub); font-size:0.9rem; text-align:center; padding: 20px;">Nenhum comentário ainda.</div>'; return; }
    container.innerHTML = tempComments.map(c => {
        let text = c.text.replace(/(@\S+)/g, '<span class="mention">$1</span>');
        return `<div class="comment-item"><div class="comment-header"><span>${c.author.split('@')[0]}</span><span>${c.date}</span></div><div class="comment-text">${text}</div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function addSubtask() { let i = document.getElementById('subtaskInput'); if (i.value.trim()) { tempSubtasks.push({ text: i.value.trim(), done: false }); i.value = ''; renderSubtasksList(); } }
function handleSubtaskEnter(e) { if (e.key === 'Enter') addSubtask(); }
function toggleSubtask(i) { tempSubtasks[i].done = !tempSubtasks[i].done; renderSubtasksList(); }
function removeSubtask(i) { tempSubtasks.splice(i, 1); renderSubtasksList(); }
function renderSubtasksList() { document.getElementById('subtaskList').innerHTML = tempSubtasks.map((s, i) => `<div class="subtask-item"><input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtask(${i})"><span style="${s.done ? 'text-decoration: line-through; opacity: 0.6; flex:1;' : 'flex:1;'}">${s.text}</span><button onclick="removeSubtask(${i})">×</button></div>`).join(''); }

function switchDescTab(mode) {
    if (mode === 'write') { document.getElementById('btnWrite').classList.add('active'); document.getElementById('btnPreview').classList.remove('active'); document.getElementById('modalDescriptionInput').style.display = 'block'; document.getElementById('descPreview').style.display = 'none'; }
    else { document.getElementById('btnWrite').classList.remove('active'); document.getElementById('btnPreview').classList.add('active'); document.getElementById('modalDescriptionInput').style.display = 'none'; document.getElementById('descPreview').style.display = 'block'; document.getElementById('descPreview').innerHTML = simpleMarkdown(document.getElementById('modalDescriptionInput').value); }
}
function simpleMarkdown(text) { if (!text) return '<em style="color:var(--text-sub);">Nenhuma descrição detalhada inserida.</em>'; let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>'); return html.split('\n').join('<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>'); }

function openImageViewer(e, src) { e.stopPropagation(); document.getElementById('fullSizeImage').src = src; document.getElementById('imageViewerOverlay').classList.add('active'); }
function closeImageViewer() { document.getElementById('imageViewerOverlay').classList.remove('active'); setTimeout(() => { document.getElementById('fullSizeImage').src = ''; }, 200); }

async function deleteColumn(id) {
    if (tasks.filter(t => t.status === id).length > 0) return showSysAlert("Esta coluna contém tarefas. Mova-as antes de excluir.");
    const ok = await showSysConfirm("Excluir coluna vazia?");
    if (ok) { columns = columns.filter(c => c.id !== id); saveColumns(); }
}
function updateColumnTitle(id, t) { let c = columns.find(x => x.id === id); if (c) { c.title = t; saveColumns(); } }
async function addColumn() { const t = await showSysPrompt("Nome da coluna:"); if (t) { columns.push({ id: 'col-' + Date.now(), title: t }); saveColumns(); } }

function toggleView() {
    isCalendarView = !isCalendarView;
    document.getElementById('btnViewToggle').style.background = isCalendarView ? 'var(--accent)' : 'transparent';
    document.getElementById('btnViewToggle').style.color = isCalendarView ? 'white' : 'var(--text-sub)';
    document.getElementById('btnAddColBtn').style.display = isCalendarView ? 'none' : 'block';
    render();
}

function renderCalendar() {
    document.getElementById('boardMain').style.display = 'none';
    document.getElementById('calendarMain').style.display = 'flex';
    const head = document.getElementById('calendarHeader');
    const grid = document.getElementById('calendarGrid');

    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

    head.innerHTML = `<h2 style="margin:0;">${monthNames[currentMonth]} ${currentYear}</h2>
                      <div style="display:flex; gap:10px;">
                          <button class="btn-secondary" onclick="changeMonth(-1)">⬅️</button>
                          <button class="btn-secondary" onclick="currentMonth=new Date().getMonth(); currentYear=new Date().getFullYear(); renderCalendar();">Hoje</button>
                          <button class="btn-secondary" onclick="changeMonth(1)">➡️</button>
                      </div>`;
    grid.innerHTML = '';

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();

    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="calendar-day empty"></div>`;
    }

    const todayDate = new Date();
    const isCurrentMonth = todayDate.getMonth() === currentMonth && todayDate.getFullYear() === currentYear;

    for (let d = 1; d <= daysInMonth; d++) {
        let dayStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

        let html = tasks.filter(t => t.endDate === dayStr || t.startDate === dayStr).map(t => {
            const tagObj = tags.find(x => x.name === (t.tag?.name || t.tag)) || t.tag;
            const taskColor = tagObj?.color || 'var(--accent)';
            const isStart = t.startDate === dayStr;
            const icon = isStart ? '▶' : '🏁';

            return `<div class="cal-task-pill" onclick="openModal('${t.id}')" style="--pill-color: ${taskColor};" title="${t.text}">
                        <span style="font-size: 10px; margin-right: 6px; opacity: 0.8;">${icon}</span>
                        ${t.text}
                    </div>`;
        }).join('');

        const isToday = isCurrentMonth && todayDate.getDate() === d;
        const headerHtml = isToday
            ? `<div class="calendar-day-header today"><span>Hoje ${d}</span></div>`
            : `<div class="calendar-day-header">${d}</div>`;

        grid.innerHTML += `<div class="calendar-day">${headerHtml}${html}</div>`;
    }
}

function changeMonth(dir) { currentMonth += dir; if (currentMonth > 11) { currentMonth = 0; currentYear++; } else if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); }

function openShareModal() { document.getElementById('shareOverlay').classList.add('active'); renderMembersList(); }
function closeShareModal() { document.getElementById('shareOverlay').classList.remove('active'); }
function addCollaborator() {
    if (allBoardsData[currentBoardId].owner !== currentUser.email) return showSysAlert("Apenas o dono pode adicionar.");
    let e = document.getElementById('collabEmail').value.trim().toLowerCase();
    if (e && !currentBoardMembers.includes(e)) { currentBoardMembers.push(e); document.getElementById('collabEmail').value = ''; syncToFirebase(); renderMembersList(); showSysAlert(`O quadro aparecerá para ${e}`); }
}
async function removeCollaborator(e) {
    if (allBoardsData[currentBoardId].owner !== currentUser.email) return showSysAlert("Apenas o dono pode remover.");
    if (e !== currentUser.email && await showSysConfirm(`Remover ${e}?`)) { currentBoardMembers = currentBoardMembers.filter(m => m !== e); syncToFirebase(); renderMembersList(); }
}
function renderMembersList() { document.getElementById('membersList').innerHTML = currentBoardMembers.map(m => `<div class="member-item"><div style="display:flex; align-items:center; gap:8px;"><div class="avatar">${m.split('@')[0].charAt(0).toUpperCase()}</div><span style="font-size: 0.85rem; color: var(--text-sub);">${m}</span></div> ${m !== currentUser.email ? `<button onclick="removeCollaborator('${m}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold;">Remover</button>` : ''}</div>`).join(''); }

function openStatsModal() { document.getElementById('statsOverlay').classList.add('active'); renderCharts(); }
function closeStatsModal() { document.getElementById('statsOverlay').classList.remove('active'); }
document.getElementById('statsOverlay').addEventListener('click', (e) => { if (e.target === document.getElementById('statsOverlay')) closeStatsModal(); });

function renderCharts() {
    const today = getTodayString();
    const doneCol = columns.find(c => c.id === 'done' || c.title.toLowerCase().includes('conclu'));
    const stats = { total: tasks.length, done: tasks.filter(t => t.status === (doneCol?.id || 'done')).length, late: tasks.filter(t => t.endDate && t.endDate < today && t.status !== (doneCol?.id || 'done')).length, priority: { Alta: 0, Média: 0, Baixa: 0 } };
    const tagCounts = {}; tags.forEach(t => tagCounts[t.name] = 0);

    const assigneeData = {};
    currentBoardMembers.forEach(m => assigneeData[m] = { total: 0, done: 0 });
    assigneeData['Sem Responsável'] = { total: 0, done: 0 };

    tasks.forEach(t => {
        const tName = t.tag?.name || t.tag;
        if (tagCounts[tName] !== undefined) tagCounts[tName]++;
        if (stats.priority[t.priority] !== undefined) stats.priority[t.priority]++;

        const assigns = (t.assignees && t.assignees.length > 0) ? t.assignees : ['Sem Responsável'];
        assigns.forEach(assign => {
            if (!assigneeData[assign]) assigneeData[assign] = { total: 0, done: 0 };
            assigneeData[assign].total++;
            if (t.status === (doneCol?.id || 'done')) assigneeData[assign].done++;
        });
    });

    document.getElementById('kpi-total').innerText = stats.total;
    document.getElementById('kpi-done').innerText = stats.done;
    document.getElementById('kpi-late').innerText = stats.late;
    document.getElementById('kpi-avg').innerText = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) + '%' : '0%';

    const textColor = theme === 'dark' ? '#e6edf3' : '#18181b';
    const chartColors = ['#ff6900', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];

    if (tagsChartInstance) tagsChartInstance.destroy();
    tagsChartInstance = new Chart(document.getElementById('tagsChart'), {
        type: 'doughnut',
        data: { labels: Object.keys(tagCounts), datasets: [{ data: Object.values(tagCounts), backgroundColor: tags.map(t => t.color), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: textColor, font: { size: 11 } } } } }
    });

    if (statusChartInstance) statusChartInstance.destroy();
    statusChartInstance = new Chart(document.getElementById('statusChart'), {
        type: 'bar',
        data: { labels: columns.map(c => c.title), datasets: [{ label: 'Tarefas', data: columns.map(c => tasks.filter(t => t.status === c.id).length), backgroundColor: '#3b82f6', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } }, plugins: { legend: { display: false } } }
    });

    if (priorityChartInstance) priorityChartInstance.destroy();
    priorityChartInstance = new Chart(document.getElementById('priorityChart'), {
        type: 'polarArea',
        data: {
            labels: ['Alta', 'Média', 'Baixa'],
            datasets: [{ data: [stats.priority.Alta, stats.priority.Média, stats.priority.Baixa], backgroundColor: ['rgba(239, 68, 68, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(59, 130, 246, 0.7)'] }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { grid: { color: 'rgba(128,128,128,0.2)' }, ticks: { display: false, backdropColor: 'transparent' } } },
            plugins: { legend: { position: 'right', labels: { color: textColor, font: { size: 11 } } } }
        }
    });

    const assignLabels = Object.keys(assigneeData);
    const assignTotal = assignLabels.map(l => assigneeData[l].total);
    const assignDone = assignLabels.map(l => assigneeData[l].done);

    if (assigneeChartInstance) assigneeChartInstance.destroy();
    assigneeChartInstance = new Chart(document.getElementById('assigneeChart'), {
        type: 'bar',
        data: {
            labels: assignLabels.map(l => l.split('@')[0]),
            datasets: [
                { label: 'Total de Tarefas', data: assignTotal, backgroundColor: '#6366f1', borderRadius: 4 },
                { label: 'Entregues (Concluído)', data: assignDone, backgroundColor: '#10b981', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } },
            plugins: { legend: { position: 'top', labels: { color: textColor } } }
        }
    });
}

function setBg(t) { currentBg = t; localStorage.setItem('nexus_bg', t); applyBackground(t); }
function applyBackground(t) { const r = document.documentElement; const base = theme === 'dark' ? '#010409' : '#f8fafc'; r.style.setProperty('--bg-body', base); r.style.setProperty('--bg-image', 'none'); if (t === 'gradient-dark') r.style.setProperty('--bg-image', 'linear-gradient(135deg, #1e1e24, #0b0c10)'); else if (t === 'gradient-purple') r.style.setProperty('--bg-image', 'linear-gradient(135deg, #2b5876, #4e4376)'); else if (t === 'space') r.style.setProperty('--bg-image', "url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1280&auto=format&fit=crop')"); }
function toggleTheme() { theme = theme === 'light' ? 'dark' : 'light'; document.body.setAttribute('data-theme', theme); localStorage.setItem('nexus_theme', theme); applyBackground(currentBg); if (document.getElementById('statsOverlay').classList.contains('active')) renderCharts(); }
function toggleMenu() { document.getElementById('sidebar').classList.toggle('active'); document.getElementById('overlay').classList.toggle('active'); }
function getTodayString() { return new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]; }
function formatDate(s) { if (s) { const d = new Date(s); return new Date(d.getTime() + d.getTimezoneOffset() * 60000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } return ''; }

function updateMetrics(tl) {
    columns.forEach(c => {
        let el = document.getElementById(`count-${c.id}`);
        if (el) el.innerText = tl.filter(t => t.status === c.id).length;
    });
    const doneCol = columns.find(c => c.id === 'done' || c.title.toLowerCase().includes('conclu'));
    let pct = 0;
    if (tl.length > 0) {
        const doneCount = doneCol ? tl.filter(t => t.status === doneCol.id).length : 0;
        pct = Math.round((doneCount / tl.length) * 100);
    }
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('prog-val').innerText = pct + '%';
}

function fireConfetti() {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
}

function renderBoardsList() { document.getElementById('boardsList').innerHTML = boards.map(board => `<div class="board-item ${board.id === currentBoardId ? 'active' : ''}" onclick="switchBoard('${board.id}')"><span class="board-item-icon">📋</span><span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${board.title}</span></div>`).join(''); }

async function startVoice(targetId, btnElement) { const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SpeechRecognition) return await showSysAlert("Reconhecimento de voz não suportado no seu navegador."); const recognition = new SpeechRecognition(); recognition.lang = 'pt-BR'; recognition.start(); btnElement.classList.add('recording'); const originalText = btnElement.innerText; if (btnElement.classList.contains('btn-mic-small')) btnElement.innerText = "👂..."; recognition.onresult = (evt) => { const t = evt.results[0][0].transcript; const input = document.getElementById(targetId); input.value = input.value.trim() ? input.value + " " + t : t; input.value = input.value.charAt(0).toUpperCase() + input.value.slice(1); }; recognition.onspeechend = recognition.onerror = () => { recognition.stop(); btnElement.classList.remove('recording'); if (btnElement.classList.contains('btn-mic-small')) btnElement.innerText = originalText; }; }
function handlePaste(e) { if (!document.getElementById('modalOverlay').classList.contains('active')) return; if (e.clipboardData && e.clipboardData.items) { for (let i = 0; i < e.clipboardData.items.length; i++) { if (e.clipboardData.items[i].type.indexOf('image') !== -1) { const blob = e.clipboardData.items[i].getAsFile(); const reader = new FileReader(); reader.onload = function (event) { compressImage(event.target.result, 800, (compressedData) => { setCoverImage(compressedData); }); }; reader.readAsDataURL(blob); e.preventDefault(); return; } } } }
function handleFileSelect(input) { if (input.files && input.files[0]) { const reader = new FileReader(); reader.onload = function (e) { compressImage(e.target.result, 800, (compressedData) => { setCoverImage(compressedData); }); }; reader.readAsDataURL(input.files[0]); } }
function compressImage(base64Str, maxWidth = 800, callback) { const img = new Image(); img.src = base64Str; img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; if (width > maxWidth) { height = Math.round((height *= maxWidth / width)); width = maxWidth; } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); callback(canvas.toDataURL('image/jpeg', 0.7)); }; }
function setCoverImage(base64String) { document.getElementById('coverPreview').src = base64String; document.getElementById('coverPreview').style.display = 'block'; document.getElementById('coverPlaceholder').style.display = 'none'; document.getElementById('removeCoverBtn').style.display = 'block'; document.getElementById('modalCoverInput').value = base64String; }
function removeCover(e) { e.stopPropagation(); document.getElementById('coverPreview').src = ''; document.getElementById('coverPreview').style.display = 'none'; document.getElementById('coverPlaceholder').style.display = 'block'; document.getElementById('removeCoverBtn').style.display = 'none'; document.getElementById('modalCoverInput').value = ''; document.getElementById('fileCoverInput').value = ''; }

function exportData() { if (currentBoardId) { allBoardsData[currentBoardId] = { tasks, columns, tags, members: currentBoardMembers, owner: allBoardsData[currentBoardId].owner }; } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ boards, currentBoardId, tags, allBoardsData })], { type: "application/json" })); a.download = `gerenciador-pro-backup-${new Date().getTime()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
function importData(inputElement) { const file = inputElement.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async function (e) { try { const d = JSON.parse(e.target.result); if (!d.allBoardsData) return showSysAlert("Backup inválido."); boards = d.boards || []; currentBoardId = d.currentBoardId; tags = d.tags || []; allBoardsData = {}; for (const [bId, bData] of Object.entries(d.allBoardsData)) { allBoardsData[bId] = { tasks: bData.tasks || JSON.parse(bData.tasks_string || "[]"), columns: bData.columns || JSON.parse(bData.columns_string || "[]"), members: bData.members || [currentUser.email], tags: bData.tags || tags, owner: bData.owner || currentUser.email }; } loadBoardData(currentBoardId); syncToFirebase(); inputElement.value = ''; showSysAlert("Backup restaurado!"); } catch (err) { showSysAlert("Falha ao ler."); } }; reader.readAsText(file); }

function requestNotificationPermission() { if (Notification.permission !== "granted") Notification.requestPermission(); }
function triggerNotification(t, b) { document.getElementById('alertSound').play().catch(e => console.log(e)); if (Notification.permission === "granted") new Notification(t, { body: b, icon: 'assets/icon.png' }); }
function startTimer() { requestNotificationPermission(); if (isTimerRunning) return; isTimerRunning = true; timerInterval = setInterval(() => { timerSeconds--; document.getElementById('pomodoroTimer').innerText = `${Math.floor(timerSeconds / 60).toString().padStart(2, '0')}:${(timerSeconds % 60).toString().padStart(2, '0')}`; if (timerSeconds <= 0) { clearInterval(timerInterval); isTimerRunning = false; triggerNotification("Pomodoro!", "Tempo esgotado."); showSysAlert("Pomodoro: Tempo esgotado!"); timerSeconds = 1500; document.getElementById('pomodoroTimer').innerText = "25:00"; } }, 1000); }
function resetTimer() { clearInterval(timerInterval); isTimerRunning = false; timerSeconds = 1500; document.getElementById('pomodoroTimer').innerText = "25:00"; }

document.addEventListener('DOMContentLoaded', () => {
    document.body.setAttribute('data-theme', theme);
    applyBackground(currentBg);
    window.addEventListener('paste', handlePaste);
});