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

auth.onAuthStateChanged(user => {
    const loginScreen = document.getElementById('loginOverlay');

    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        loadFromFirebase();
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
    }
});

async function loginFirebase() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const errObj = document.getElementById('loginError');

    if (!email || !pass) {
        errObj.innerText = "Preencha e-mail e senha.";
        errObj.style.display = 'block';
        return;
    }

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

    if (!email || !pass) {
        errObj.innerText = "Preencha e-mail e senha.";
        errObj.style.display = 'block';
        return;
    }

    try {
        await auth.createUserWithEmailAndPassword(email, pass);
        errObj.style.display = 'none';
        await showSysAlert("Conta criada com sucesso! Preparando seu ambiente em nuvem...");
    } catch (error) {
        errObj.innerText = "Erro: " + error.message;
        errObj.style.display = 'block';
    }
}

function logoutFirebase() {
    auth.signOut().then(() => {
        window.location.reload();
    });
}

let theme = localStorage.getItem('nexus_theme') || 'light';
let currentBg = localStorage.getItem('nexus_bg') || 'default';

let priorityChartInstance = null;

let allBoardsData = {};
let boards = [];
let currentBoardId = null;
let boardTitle = '';
let columns = [];
let tasks = [];
let tags = [
    "💻 Desenvolvimento",
    "🐛 Bug Fix",
    "🏋️ Treino",
    "📅 Reunião",
    "🚀 Deploy",
    "🎨 Design"
];

let currentTagFilter = 'all';
let currentPriorityFilter = 'all';
let searchTerm = '';
let editingTaskId = null;
let tempSubtasks = [];
let tempComments = [];

let timerInterval;
let timerSeconds = 1500;
let isTimerRunning = false;
let tagsChartInstance = null;
let statusChartInstance = null;

async function loadFromFirebase() {
    if (!currentUser) {
        return;
    }

    try {
        const docRef = db.collection('users').doc(currentUser.uid);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();

            boards = data.boards || [];
            currentBoardId = data.currentBoardId || (boards.length > 0 ? boards[0].id : null);
            tags = data.tags || [];
            allBoardsData = {};

            if (data.boardData) {
                for (const [bId, bData] of Object.entries(data.boardData)) {
                    allBoardsData[bId] = {
                        tasks: JSON.parse(bData.tasks_string || "[]"),
                        columns: JSON.parse(bData.columns_string || "[]")
                    };
                }
            }

            if (currentBoardId && allBoardsData[currentBoardId]) {
                tasks = allBoardsData[currentBoardId].tasks || [];
                columns = allBoardsData[currentBoardId].columns || [];
            } else {
                tasks = [];
                columns = [
                    { id: 'todo', title: 'Pendências' },
                    { id: 'doing', title: 'Em Andamento' },
                    { id: 'done', title: 'Concluído' }
                ];
            }

            const currentBoardObj = boards.find(b => b.id === currentBoardId);
            boardTitle = currentBoardObj ? currentBoardObj.title : 'Meu Quadro';
            document.getElementById('boardTitle').innerText = boardTitle;

            renderBoardsList();
            updateTagsDropdown();
            render();

        } else {
            const newId = 'board-' + Date.now();

            boards = [{ id: newId, title: 'Meu Primeiro Quadro' }];
            currentBoardId = newId;
            tasks = [];
            columns = [
                { id: 'todo', title: 'Pendências' },
                { id: 'doing', title: 'Em Andamento' },
                { id: 'done', title: 'Concluído' }
            ];

            allBoardsData = {};
            allBoardsData[currentBoardId] = {
                tasks: tasks,
                columns: columns
            };

            boardTitle = 'Meu Primeiro Quadro';
            document.getElementById('boardTitle').innerText = boardTitle;

            renderBoardsList();
            updateTagsDropdown();
            render();
            syncToFirebase();
        }
    } catch (error) {
        console.error("Erro loadFromFirebase:", error);
        await showSysAlert("Erro ao baixar dados da nuvem.");
    }
}

function syncToFirebase() {
    if (!currentUser) {
        return;
    }

    if (currentBoardId) {
        allBoardsData[currentBoardId] = {
            tasks: tasks || [],
            columns: columns || []
        };
    }

    const payloadBoardData = {};

    for (const [bId, bData] of Object.entries(allBoardsData)) {
        const validId = bId ? String(bId) : `board-${Date.now()}`;
        payloadBoardData[validId] = {
            tasks_string: JSON.stringify(bData.tasks || []),
            columns_string: JSON.stringify(bData.columns || [])
        };
    }

    const rawPayload = {
        boards: boards || [],
        currentBoardId: currentBoardId || "",
        tags: tags || [],
        boardData: payloadBoardData
    };

    const cleanPayload = JSON.parse(JSON.stringify(rawPayload));
    cleanPayload.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('users').doc(currentUser.uid).set(cleanPayload)
        .then(() => {
            console.log("Salvo na nuvem com sucesso!");
        })
        .catch(err => {
            console.error("Erro ao salvar:", err);
            showSysAlert("Erro do Firebase: " + err.message);
        });
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.setAttribute('data-theme', theme);
    applyBackground(currentBg);

    document.addEventListener('paste', handlePaste);
    document.getElementById('overlay').addEventListener('click', toggleMenu);

    const modalOverlay = document.getElementById('modalOverlay');

    modalOverlay.addEventListener('mousedown', (e) => {
        if (e.target === modalOverlay) {
            const titleInput = document.getElementById('modalTaskInput').value.trim();

            if (!titleInput && !editingTaskId) {
                closeModal();
            } else {
                saveTaskBtnClick();
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!modalOverlay.classList.contains('active')) {
            return;
        }

        if (document.getElementById('sysOverlay').classList.contains('active')) {
            return;
        }

        if (e.key === 'Escape') {
            closeModal();
            return;
        }

        if (e.key === 'Enter') {
            const activeId = document.activeElement.id;

            if (activeId === 'modalDescriptionInput' || activeId === 'subtaskInput' || activeId === 'commentInput') {
                return;
            }

            e.preventDefault();

            const titleInput = document.getElementById('modalTaskInput').value.trim();

            if (!titleInput && !editingTaskId) {
                closeModal();
            } else {
                saveTaskBtnClick();
            }
        }
    });

    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
});

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

        if (type === 'prompt') {
            inputEl.style.display = 'block';
        } else {
            inputEl.style.display = 'none';
        }

        inputEl.placeholder = placeholder;

        if (type === 'alert') {
            btnCancel.style.display = 'none';
        } else {
            btnCancel.style.display = 'block';
        }

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

        if (type === 'prompt') {
            setTimeout(() => {
                inputEl.focus();
            }, 100);
        }

        const close = (value) => {
            overlay.classList.remove('active');
            resolve(value);
        };

        btnConfirm.onclick = () => {
            if (type === 'prompt') {
                close(inputEl.value);
            } else {
                close(true);
            }
        };

        btnCancel.onclick = () => {
            if (type === 'prompt') {
                close(null);
            } else {
                close(false);
            }
        };

        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnConfirm.click();
            }
        };
    });
}

async function showSysAlert(message) {
    return await showSysModal('Aviso', message, 'alert');
}

async function showSysConfirm(message, title = 'Confirmação') {
    return await showSysModal(title, message, 'confirm');
}

async function showSysPrompt(title, placeholder = '') {
    return await showSysModal(title, '', 'prompt', placeholder);
}

function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('active');
        overlay.classList.add('active');
    }
}

function renderBoardsList() {
    const list = document.getElementById('boardsList');

    list.innerHTML = boards.map(board => {
        const activeClass = board.id === currentBoardId ? 'active' : '';
        return `
            <div class="board-item ${activeClass}" onclick="switchBoard('${board.id}')">
                <span class="board-item-icon">📋</span>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${board.title}
                </span>
            </div>
        `;
    }).join('');
}

async function createNewBoard() {
    const title = await showSysPrompt("Nome do novo quadro:");

    if (!title) {
        return;
    }

    const newId = 'board-' + Date.now();

    boards.push({
        id: newId,
        title: title
    });

    allBoardsData[newId] = {
        tasks: [],
        columns: [
            { id: 'todo', title: 'Pendências' },
            { id: 'doing', title: 'Em Andamento' },
            { id: 'done', title: 'Concluído' }
        ]
    };

    switchBoard(newId);
}

function switchBoard(boardId) {
    const currentBoard = boards.find(b => b.id === currentBoardId);

    if (currentBoard) {
        currentBoard.title = document.getElementById('boardTitle').innerText;
    }

    allBoardsData[currentBoardId] = {
        tasks: tasks,
        columns: columns
    };

    currentBoardId = boardId;

    tasks = allBoardsData[currentBoardId].tasks || [];
    columns = allBoardsData[currentBoardId].columns || [];

    const newBoard = boards.find(b => b.id === currentBoardId);
    boardTitle = newBoard ? newBoard.title : 'Quadro';
    document.getElementById('boardTitle').innerText = boardTitle;

    render();
    renderBoardsList();
    syncToFirebase();
}

async function deleteCurrentBoard() {
    if (boards.length <= 1) {
        await showSysAlert("Você não pode excluir o único quadro restante.");
        return;
    }

    const confirmed = await showSysConfirm("Tem certeza? Isso apagará todas as tarefas deste quadro permanentemente.", "Excluir Quadro");

    if (confirmed) {
        delete allBoardsData[currentBoardId];
        boards = boards.filter(b => b.id !== currentBoardId);
        switchBoard(boards[0].id);
    }
}

function saveTitle() {
    boardTitle = document.getElementById('boardTitle').innerText;
    const boardIndex = boards.findIndex(b => b.id === currentBoardId);

    if (boardIndex > -1) {
        boards[boardIndex].title = boardTitle;
    }

    renderBoardsList();
    syncToFirebase();
}

function save() {
    render();
    syncToFirebase();
}

function saveColumns() {
    render();
    syncToFirebase();
}

function compressImage(base64Str, maxWidth = 800, callback) {
    const img = new Image();
    img.src = base64Str;

    img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
            height = Math.round((height *= maxWidth / width));
            width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', 0.7));
    };
}

function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();

        reader.onload = function (e) {
            compressImage(e.target.result, 800, (compressedData) => {
                setCoverImage(compressedData);
            });
        }

        reader.readAsDataURL(file);
    }
}

function handlePaste(e) {
    const modal = document.getElementById('modalOverlay');

    if (!modal.classList.contains('active')) {
        return;
    }

    if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                const reader = new FileReader();

                reader.onload = function (event) {
                    compressImage(event.target.result, 800, (compressedData) => {
                        setCoverImage(compressedData);
                    });
                };

                reader.readAsDataURL(blob);
                e.preventDefault();
                return;
            }
        }
    }
}

function setCoverImage(base64String) {
    document.getElementById('coverPreview').src = base64String;
    document.getElementById('coverPreview').style.display = 'block';
    document.getElementById('coverPlaceholder').style.display = 'none';
    document.getElementById('removeCoverBtn').style.display = 'block';
    document.getElementById('modalCoverInput').value = base64String;
}

function removeCover(e) {
    e.stopPropagation();

    document.getElementById('coverPreview').src = '';
    document.getElementById('coverPreview').style.display = 'none';
    document.getElementById('coverPlaceholder').style.display = 'block';
    document.getElementById('removeCoverBtn').style.display = 'none';
    document.getElementById('modalCoverInput').value = '';
    document.getElementById('fileCoverInput').value = '';
}

async function addColumn() {
    const title = await showSysPrompt("Nome da nova coluna:");

    if (title) {
        columns.push({
            id: 'col-' + Date.now(),
            title: title
        });
        saveColumns();
    }
}

async function deleteColumn(colId) {
    if (tasks.filter(t => t.status === colId).length > 0) {
        await showSysAlert("Esta coluna contém tarefas. Mova-as antes de excluir.");
        return;
    }

    if (await showSysConfirm("Tem certeza que deseja excluir esta coluna?", "Excluir Coluna")) {
        columns = columns.filter(c => c.id !== colId);
        saveColumns();
    }
}

function updateColumnTitle(colId, newTitle) {
    const col = columns.find(c => c.id === colId);

    if (col) {
        col.title = newTitle;
        saveColumns();
    }
}

function render() {
    const board = document.getElementById('boardMain');
    board.innerHTML = '';

    const filteredTasks = tasks.filter(t => {
        const matchTag = currentTagFilter === 'all' || t.tag === currentTagFilter;
        const matchPriority = currentPriorityFilter === 'all' || t.priority === currentPriorityFilter;
        const term = searchTerm ? searchTerm.toLowerCase() : '';
        const titleMatch = t.text.toLowerCase().includes(term);
        const descMatch = t.description && t.description.toLowerCase().includes(term);

        return matchTag && matchPriority && (term === '' || titleMatch || descMatch);
    });

    columns.forEach(col => {
        const columnEl = document.createElement('div');
        columnEl.className = 'column';
        columnEl.id = col.id;

        const deleteBtn = `<button class="column-delete-btn" onclick="deleteColumn('${col.id}')" title="Excluir Coluna">✖</button>`;
        const addBtn = `<button class="btn-add-rounded" onclick="openModal(null, '${col.id}')" title="Adicionar Tarefa" style="margin-left: 10px;">+</button>`;
        const count = filteredTasks.filter(t => t.status === col.id).length;

        columnEl.innerHTML = `
            <div class="column-header">
                <div class="header-title-group">
                    <span contenteditable="true" class="column-title-edit" onblur="updateColumnTitle('${col.id}', this.innerText)">${col.title}</span>
                    ${addBtn}
                </div>
                <div style="display:flex; align-items:center;">
                    <span id="count-${col.id}" class="count-badge">${count}</span>
                    ${deleteBtn}
                </div>
            </div>
            <div class="tasks-container" data-status="${col.id}"></div>
        `;

        board.appendChild(columnEl);

        const container = columnEl.querySelector('.tasks-container');

        filteredTasks.filter(t => t.status === col.id).forEach(t => {
            const isDoneCol = col.id === 'done' || col.title.toLowerCase().includes('conclu');
            const card = document.createElement('div');

            card.className = `card ${t.status === 'done' || isDoneCol ? 'finalizado' : ''}`;
            card.id = t.id;
            card.onclick = () => openModal(t.id);

            let coverHtml = '';
            if (t.cover) {
                coverHtml = `<img src="${t.cover}" class="card-cover" alt="Capa">`;
            }

            let dateHtml = '';
            if (t.startDate || t.endDate) {
                const isOverdue = t.endDate && t.endDate < getTodayString() && !isDoneCol;

                dateHtml = `
                    <div class="${isOverdue ? 'date-display overdue' : 'date-display'}">
                        ${isOverdue ? '⚠️ ' : '📅 '} ${formatDate(t.startDate)} ${t.endDate ? '- ' + formatDate(t.endDate) : ''}
                    </div>
                `;
            }

            const descIcon = t.description && t.description.trim() !== '' ? '<span class="has-desc-icon">📄</span>' : '';
            const prioColor = t.priority === 'Alta' ? '#ef4444' : t.priority === 'Média' ? '#f59e0b' : '#6366f1';

            let progressHtml = '';
            if (t.subtasks && t.subtasks.length > 0) {
                const total = t.subtasks.length;
                const doneCount = t.subtasks.filter(s => s.done).length;
                const pct = Math.round((doneCount / total) * 100);

                progressHtml = `
                    <div style="font-size: 10px; color: var(--text-sub); margin-top: 5px; display: flex; justify-content: space-between;">
                        <span>Checklist</span> <span>${doneCount}/${total}</span>
                    </div>
                    <div class="progress-container" style="display:block">
                        <div class="progress-bar-card" style="width: ${pct}%"></div>
                    </div>
                `;
            }

            card.innerHTML = `
                ${coverHtml}
                <div class="tag-row">
                    <div class="tag">${t.tag}</div>
                    ${dateHtml}
                    ${descIcon}
                </div>
                <span class="card-text">${t.text}</span>
                ${progressHtml}
                <div class="card-footer">
                    <div class="prio-indicator">
                        <div class="dot" style="background:${prioColor}"></div>
                        <span>${t.priority}</span>
                    </div>
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
            group: 'shared',
            animation: 150,
            ghostClass: 'sortable-ghost',
            delay: 100,
            delayOnTouchOnly: true,
            onEnd: function (evt) {
                const itemEl = evt.item;
                const newStatus = evt.to.getAttribute('data-status');
                const task = tasks.find(t => t.id === itemEl.id);

                if (task) {
                    const targetCol = columns.find(c => c.id === newStatus);
                    const isDoneTarget = targetCol && (targetCol.id === 'done' || targetCol.title.toLowerCase().includes('conclu'));
                    const wasDone = task.status === 'done' || (columns.find(c => c.id === task.status)?.title.toLowerCase().includes('conclu'));

                    if (!wasDone && isDoneTarget) {
                        task.endDate = getTodayString();
                        fireConfetti();
                    }

                    if (wasDone && !isDoneTarget) {
                        task.endDate = '';
                    }

                    task.status = newStatus;
                }

                const allCards = document.querySelectorAll('.card');
                const newOrderIds = Array.from(allCards).map(card => card.id);
                const reorderedTasks = [];
                const visibleTasksMap = new Map(tasks.map(t => [t.id, t]));

                newOrderIds.forEach(id => {
                    if (visibleTasksMap.has(id)) {
                        reorderedTasks.push(visibleTasksMap.get(id));
                        visibleTasksMap.delete(id);
                    }
                });

                tasks = [...reorderedTasks, ...Array.from(visibleTasksMap.values())];
                save();
            }
        });
    });
}

function setupColumnDragAndDrop() {
    new Sortable(document.getElementById('boardMain'), {
        animation: 150,
        handle: '.column-header',
        ghostClass: 'sortable-ghost-column',
        delay: 100,
        delayOnTouchOnly: true,
        onEnd: function () {
            const newColumnOrder = [];

            document.querySelectorAll('.column').forEach(colEl => {
                const colData = columns.find(c => c.id === colEl.id);
                if (colData) {
                    newColumnOrder.push(colData);
                }
            });

            columns = newColumnOrder;
            saveColumns();
        }
    });
}

function openModal(taskId = null, initialStatus = null) {
    const modal = document.getElementById('modalOverlay');
    const saveBtn = document.getElementById('modalSaveBtn');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    const modalTitle = document.getElementById('modalTitle');

    document.getElementById('modalTaskInput').value = '';
    document.getElementById('modalDescriptionInput').value = '';
    document.getElementById('modalDateStart').value = '';
    document.getElementById('modalDateEnd').value = '';
    document.getElementById('subtaskInput').value = '';
    document.getElementById('subtaskList').innerHTML = '';
    document.getElementById('modalTagInput').selectedIndex = 0;
    document.getElementById('modalPriorityInput').selectedIndex = 0;
    document.getElementById('commentsList').innerHTML = '';
    document.getElementById('commentInput').value = '';

    removeCover({ stopPropagation: () => { } });

    if (taskId) {
        editingTaskId = taskId;
        const task = tasks.find(t => t.id === taskId);

        if (!task) {
            return;
        }

        modalTitle.innerText = "Detalhes da Tarefa";
        saveBtn.innerText = "Atualizar";
        deleteBtn.style.display = 'block';

        document.getElementById('modalTaskInput').value = task.text;
        document.getElementById('modalDescriptionInput').value = task.description || '';
        document.getElementById('modalTagInput').value = task.tag;
        document.getElementById('modalPriorityInput').value = task.priority;
        document.getElementById('modalDateStart').value = task.startDate || '';
        document.getElementById('modalDateEnd').value = task.endDate || '';

        if (task.cover) {
            setCoverImage(task.cover);
        }

        tempSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
        tempComments = task.comments ? JSON.parse(JSON.stringify(task.comments)) : [];

        renderSubtasksList();
        renderCommentsList();

        saveBtn.onclick = () => saveTaskBtnClick();
        switchDescTab('preview');

    } else {
        editingTaskId = null;
        modalTitle.innerText = "Nova Tarefa";
        saveBtn.innerText = "Salvar";
        deleteBtn.style.display = 'none';

        tempSubtasks = [];
        tempComments = [];

        renderSubtasksList();
        renderCommentsList();

        document.getElementById('modalDateStart').value = getTodayString();
        saveBtn.onclick = () => saveTaskBtnClick(initialStatus || (columns.length > 0 ? columns[0].id : 'todo'));

        switchDescTab('write');

        setTimeout(() => {
            document.getElementById('modalTaskInput').focus();
        }, 100);
    }

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    editingTaskId = null;
}

async function saveTaskBtnClick(statusOverride = null) {
    const titleInput = document.getElementById('modalTaskInput');

    if (!titleInput.value.trim()) {
        await showSysAlert("O título da tarefa é obrigatório.");
        titleInput.focus();
        return;
    }

    if (editingTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === editingTaskId);

        if (taskIndex > -1) {
            tasks[taskIndex].text = titleInput.value;
            tasks[taskIndex].description = document.getElementById('modalDescriptionInput').value;
            tasks[taskIndex].tag = document.getElementById('modalTagInput').value;
            tasks[taskIndex].priority = document.getElementById('modalPriorityInput').value;
            tasks[taskIndex].cover = document.getElementById('modalCoverInput').value;
            tasks[taskIndex].startDate = document.getElementById('modalDateStart').value;
            tasks[taskIndex].endDate = document.getElementById('modalDateEnd').value;
            tasks[taskIndex].subtasks = tempSubtasks;
            tasks[taskIndex].comments = tempComments;
        }
    } else {
        tasks.push({
            id: 'id-' + Date.now(),
            text: titleInput.value,
            description: document.getElementById('modalDescriptionInput').value,
            tag: document.getElementById('modalTagInput').value,
            priority: document.getElementById('modalPriorityInput').value,
            cover: document.getElementById('modalCoverInput').value,
            startDate: document.getElementById('modalDateStart').value,
            endDate: document.getElementById('modalDateEnd').value,
            subtasks: tempSubtasks,
            comments: tempComments,
            status: statusOverride || (columns.length > 0 ? columns[0].id : 'todo')
        });
    }

    save();
    closeModal();
}

async function deleteTaskFromModal() {
    if (!editingTaskId) {
        return;
    }

    if (await showSysConfirm("Tem certeza absoluta que deseja excluir esta tarefa?", "Excluir Tarefa")) {
        tasks = tasks.filter(t => t.id !== editingTaskId);
        save();
        closeModal();
    }
}

function handleSubtaskEnter(e) {
    if (e.key === 'Enter') {
        addSubtask();
    }
}

function addSubtask() {
    const input = document.getElementById('subtaskInput');

    if (input.value.trim()) {
        tempSubtasks.push({
            text: input.value.trim(),
            done: false
        });
        input.value = '';
        renderSubtasksList();
    }
}

function renderSubtasksList() {
    const container = document.getElementById('subtaskList');

    container.innerHTML = tempSubtasks.map((s, i) => `
        <div class="subtask-item">
            <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtask(${i})">
            <span style="${s.done ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${s.text}</span>
            <button onclick="removeSubtask(${i})">×</button>
        </div>
    `).join('');
}

function toggleSubtask(i) {
    tempSubtasks[i].done = !tempSubtasks[i].done;
    renderSubtasksList();
}

function removeSubtask(i) {
    tempSubtasks.splice(i, 1);
    renderSubtasksList();
}

function addComment() {
    const input = document.getElementById('commentInput');

    if (input.value.trim()) {
        const now = new Date();
        tempComments.push({
            text: input.value.trim(),
            author: 'Usuário',
            date: now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        input.value = '';
        renderCommentsList();
    }
}

function renderCommentsList() {
    const container = document.getElementById('commentsList');

    if (tempComments.length === 0) {
        container.innerHTML = '<div style="color:var(--text-sub); font-size:0.8rem; text-align:center;">Nenhum comentário.</div>';
        return;
    }

    container.innerHTML = tempComments.map(c => `
        <div class="comment-item">
            <div class="comment-header">
                <span>${c.author}</span>
                <span style="font-weight:400; opacity:0.7;">${c.date}</span>
            </div>
            <div class="comment-text">${c.text}</div>
        </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
}

function switchDescTab(mode) {
    const btnWrite = document.getElementById('btnWrite');
    const btnPreview = document.getElementById('btnPreview');
    const input = document.getElementById('modalDescriptionInput');
    const preview = document.getElementById('descPreview');

    if (mode === 'write') {
        btnWrite.classList.add('active');
        btnPreview.classList.remove('active');
        input.style.display = 'block';
        preview.style.display = 'none';
        document.getElementById('descMicBtn').style.display = 'flex';
        input.focus();
    } else {
        btnWrite.classList.remove('active');
        btnPreview.classList.add('active');
        input.style.display = 'none';
        preview.style.display = 'block';
        document.getElementById('descMicBtn').style.display = 'none';
        preview.innerHTML = simpleMarkdown(input.value);
    }
}

function simpleMarkdown(text) {
    if (!text || text.trim() === '') {
        return '<div style="color:var(--text-sub); text-align:center; padding:10px;"><em>Nenhuma descrição inserida.</em></div>';
    }

    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>');

    let lines = html.split('\n');
    let inList = false;
    let newLines = [];

    lines.forEach(line => {
        let t = line.trim();

        if (t.startsWith('- ')) {
            if (!inList) {
                newLines.push('<ul>');
                inList = true;
            }
            newLines.push(`<li>${t.substring(2)}</li>`);
        } else {
            if (inList) {
                newLines.push('</ul>');
                inList = false;
            }

            if (t === '') {
                newLines.push('<br>');
            } else {
                newLines.push(`<div>${line}</div>`);
            }
        }
    });

    if (inList) {
        newLines.push('</ul>');
    }

    return newLines.join('').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
}

async function startVoice(targetId, btnElement) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        return await showSysAlert("Seu navegador não suporta reconhecimento de voz.");
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.start();

    btnElement.classList.add('recording');
    const originalText = btnElement.innerText;

    if (btnElement.classList.contains('btn-mic-small')) {
        btnElement.innerText = "👂...";
    }

    recognition.onresult = (evt) => {
        const t = evt.results[0][0].transcript;
        const input = document.getElementById(targetId);
        input.value = input.value.trim() ? input.value + " " + t : t;
        input.value = input.value.charAt(0).toUpperCase() + input.value.slice(1);
    };

    recognition.onspeechend = recognition.onerror = () => {
        recognition.stop();
        btnElement.classList.remove('recording');

        if (btnElement.classList.contains('btn-mic-small')) {
            btnElement.innerText = originalText;
        }
    };
}

function exportData() {
    if (currentBoardId) {
        allBoardsData[currentBoardId] = {
            tasks: tasks,
            columns: columns
        };
    }

    const dataToExport = JSON.stringify({
        boards: boards,
        currentBoardId: currentBoardId,
        tags: tags,
        allBoardsData: allBoardsData
    });

    const blob = new Blob([dataToExport], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `gerenciador-pro-backup-${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importData(inputElement) {
    const file = inputElement.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = async function (e) {
        try {
            const importedData = JSON.parse(e.target.result);

            if (!importedData.allBoardsData) {
                await showSysAlert("Formato de backup inválido ou antigo. Use apenas backups gerados neste novo sistema.");
                inputElement.value = '';
                return;
            }

            boards = importedData.boards || [];
            currentBoardId = importedData.currentBoardId;
            tags = importedData.tags || [];
            allBoardsData = {};

            for (const [bId, bData] of Object.entries(importedData.allBoardsData)) {
                allBoardsData[bId] = {
                    tasks: JSON.parse(bData.tasks_string || "[]"),
                    columns: JSON.parse(bData.columns_string || "[]")
                };
            }

            tasks = allBoardsData[currentBoardId].tasks || [];
            columns = allBoardsData[currentBoardId].columns || [];

            const currentBoardObj = boards.find(b => b.id === currentBoardId);
            boardTitle = currentBoardObj ? currentBoardObj.title : 'Meu Quadro';
            document.getElementById('boardTitle').innerText = boardTitle;

            renderBoardsList();
            updateTagsDropdown();
            render();

            syncToFirebase();

            inputElement.value = '';
            await showSysAlert("Backup restaurado e salvo na nuvem com sucesso!");

        } catch (err) {
            console.error("Erro na importação:", err);
            await showSysAlert("Falha ao ler o arquivo. Ele pode estar corrompido ou vazio.");
            inputElement.value = '';
        }
    };

    reader.readAsText(file);
}

function setBg(t) {
    currentBg = t;
    localStorage.setItem('nexus_bg', t);
    applyBackground(t);
}

function applyBackground(t) {
    const r = document.documentElement;
    const base = theme === 'dark' ? '#010409' : '#f8fafc';

    r.style.setProperty('--bg-body', base);
    r.style.setProperty('--bg-image', 'none');

    if (t === 'gradient-dark') {
        r.style.setProperty('--bg-image', 'linear-gradient(135deg, #1e1e24, #0b0c10)');
    } else if (t === 'gradient-purple') {
        r.style.setProperty('--bg-image', 'linear-gradient(135deg, #2b5876, #4e4376)');
    } else if (t === 'space') {
        r.style.setProperty('--bg-image', "url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1280&auto=format&fit=crop')");
    }
}

function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('nexus_theme', theme);
    applyBackground(currentBg);

    if (document.getElementById('statsOverlay').classList.contains('active')) {
        renderCharts();
    }
}

function requestNotificationPermission() {
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }
}

function triggerNotification(t, b) {
    document.getElementById('alertSound').play().catch(e => console.log(e));
    if (Notification.permission === "granted") {
        new Notification(t, { body: b, icon: 'assets/icon.png' });
    }
}

function startTimer() {
    requestNotificationPermission();

    if (isTimerRunning) {
        return;
    }

    isTimerRunning = true;

    timerInterval = setInterval(() => {
        timerSeconds--;
        document.getElementById('pomodoroTimer').innerText = `${Math.floor(timerSeconds / 60).toString().padStart(2, '0')}:${(timerSeconds % 60).toString().padStart(2, '0')}`;

        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            isTimerRunning = false;
            triggerNotification("Pomodoro!", "Tempo esgotado.");
            showSysAlert("Pomodoro: Tempo esgotado!");
            timerSeconds = 1500;
            document.getElementById('pomodoroTimer').innerText = "25:00";
        }
    }, 1000);
}

function resetTimer() {
    clearInterval(timerInterval);
    isTimerRunning = false;
    timerSeconds = 1500;
    document.getElementById('pomodoroTimer').innerText = "25:00";
}

function applyFilters() {
    currentTagFilter = document.getElementById('filterTag').value;
    currentPriorityFilter = document.getElementById('filterPriority').value;
    searchTerm = document.getElementById('searchInput').value.toLowerCase();
    render();
}

async function updateTagsDropdown() {
    const m = document.getElementById('modalTagInput');
    const f = document.getElementById('filterTag');

    m.innerHTML = tags.map(t => `<option value="${t}">${t}</option>`).join('');
    f.innerHTML = `<option value="all">🏷️ Tags</option>` + tags.map(t => `<option value="${t}">${t}</option>`).join('');
    f.value = currentTagFilter;
}

async function addNewTag() {
    const t = await showSysPrompt("Tag:");

    if (t && !tags.includes(t)) {
        tags.push(t);
        updateTagsDropdown();
        syncToFirebase();
    }
}

function updateMetrics(tl) {
    columns.forEach(c => {
        const el = document.getElementById(`count-${c.id}`);
        if (el) {
            el.innerText = tl.filter(t => t.status === c.id).length;
        }
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

async function clearAllDone() {
    const doneCol = columns.find(c => c.id === 'done' || c.title.toLowerCase().includes('conclu'));

    if (doneCol) {
        const confirmed = await showSysConfirm("Limpar tarefas concluídas?", "Limpar Tudo");
        if (confirmed) {
            tasks = tasks.filter(t => t.status !== doneCol.id);
            save();
            toggleMenu();
            syncToFirebase();
        }
    } else {
        await showSysAlert("Nenhuma coluna de conclusão encontrada.");
    }
}

function openStatsModal() {
    document.getElementById('statsOverlay').classList.add('active');
    renderCharts();
}

function closeStatsModal() {
    document.getElementById('statsOverlay').classList.remove('active');
}

document.getElementById('statsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('statsOverlay')) {
        closeStatsModal();
    }
});

function renderCharts() {
    const today = getTodayString();
    const doneCol = columns.find(c => c.id === 'done' || c.title.toLowerCase().includes('conclu'));

    const stats = {
        total: tasks.length,
        done: tasks.filter(t => t.status === (doneCol?.id || 'done')).length,
        late: tasks.filter(t => t.endDate && t.endDate < today && t.status !== (doneCol?.id || 'done')).length,
        priority: { Alta: 0, Média: 0, Baixa: 0 }
    };

    const tagCounts = {};
    tags.forEach(t => tagCounts[t] = 0);

    tasks.forEach(t => {
        if (tagCounts[t.tag] !== undefined) tagCounts[t.tag]++;
        if (stats.priority[t.priority] !== undefined) stats.priority[t.priority]++;
    });

    document.getElementById('kpi-total').innerText = stats.total;
    document.getElementById('kpi-done').innerText = stats.done;
    document.getElementById('kpi-late').innerText = stats.late;
    document.getElementById('kpi-avg').innerText = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) + '%' : '0%';

    const textColor = theme === 'dark' ? '#e6edf3' : '#18181b';
    const chartColors = ['#ff6900', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];

    if (tagsChartInstance) tagsChartInstance.destroy();
    tagsChartInstance = new Chart(document.getElementById('tagsChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(tagCounts),
            datasets: [{ data: Object.values(tagCounts), backgroundColor: chartColors, borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor, font: { size: 10 } } } } }
    });

    if (statusChartInstance) statusChartInstance.destroy();
    statusChartInstance = new Chart(document.getElementById('statusChart'), {
        type: 'bar',
        data: {
            labels: columns.map(c => c.title),
            datasets: [{ label: 'Tarefas', data: columns.map(c => tasks.filter(t => t.status === c.id).length), backgroundColor: '#3b82f6', borderRadius: 5 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } },
            plugins: { legend: { display: false } }
        }
    });

    if (priorityChartInstance) priorityChartInstance.destroy();
    priorityChartInstance = new Chart(document.getElementById('priorityChart'), {
        type: 'polarArea',
        data: {
            labels: ['Alta', 'Média', 'Baixa'],
            datasets: [{ data: [stats.priority.Alta, stats.priority.Média, stats.priority.Baixa], backgroundColor: ['rgba(239, 68, 68, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(99, 102, 241, 0.7)'] }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { grid: { color: 'rgba(128,128,128,0.2)' }, ticks: { display: false } } },
            plugins: { legend: { position: 'bottom', labels: { color: textColor, font: { size: 10 } } } }
        }
    });
}

function getTodayString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localDate = new Date(now.getTime() - offset);
    return localDate.toISOString().split('T')[0];
}

function formatDate(s) {
    if (s) {
        const d = new Date(s);
        const offset = d.getTimezoneOffset() * 60000;
        const localDate = new Date(d.getTime() + offset);
        return localDate.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit'
        });
    } else {
        return '';
    }
}

function fireConfetti() {
    const end = Date.now() + 1000;

    (function frame() {
        confetti({
            particleCount: 2,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#ff6900', '#fff']
        });

        confetti({
            particleCount: 2,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#ff6900', '#fff']
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}