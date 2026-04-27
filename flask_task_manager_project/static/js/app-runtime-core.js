function taskCountText(count) {
    return `${count} ${count === 1 ? t("tasks").replace(/s$/i, "") : t("tasks")}`;
}

function completedTaskCountText(count) {
    return `${count} ${count === 1 ? t("completed_on").toLowerCase() : t("completed_tasks_page").toLowerCase()}`;
}

function getPriorityWeight(priority) {
    const value = String(priority || "medium").toLowerCase();
    if (value === "high") return 3;
    if (value === "medium") return 2;
    return 1;
}

function getTaskCreatedTimestamp(task) {
    const raw = task?.created_at || task?.id || 0;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
        return date.getTime();
    }
    return Number(task?.id || 0);
}

function getTaskFilterState() {
    return {
        query: searchInput?.value.trim().toLowerCase() || "",
        priority: taskFilterPriority?.value || "all",
        deadlineDate: taskFilterDeadlineDate?.value || "",
        assignedUser: taskFilterAssignedUser?.value || "all",
        globalMode: taskFilterGlobalMode?.value || "all",
        completion: taskFilterCompletion?.value || "all",
        sortBy: taskSortBy?.value || "created_desc",
        invert: Boolean(taskFilterInvert?.checked),
        reverse: Boolean(taskSortReverse?.checked),
    };
}

function taskMatchesFilters(task, filters) {
    const haystack = [
        task.title,
        task.description,
        task.deadline,
        task.priority,
        task.members.join(" "),
        ...task.subtasks.flatMap((s) => [s.title, s.deadline, s.priority]),
    ].join(" ").toLowerCase();

    let matches = true;

    if (filters.query) {
        matches = matches && haystack.includes(filters.query);
    }
    if (filters.priority !== "all") {
        matches = matches && String(task.priority) === filters.priority;
    }
    if (filters.deadlineDate) {
        matches = matches && Boolean(task.deadline) && String(task.deadline).slice(0, 10) === filters.deadlineDate;
    }
    if (filters.assignedUser !== "all") {
        matches = matches && (task.member_details || task.members || []).some((member) => {
            if (typeof member === "string") {
                return normalizeUsernameKey(member) === normalizeUsernameKey(filters.assignedUser);
            }
            return normalizeUsernameKey(member?.username) === normalizeUsernameKey(filters.assignedUser);
        });
    }
    if (filters.globalMode === "global") {
        matches = matches && Boolean(task.is_global);
    } else if (filters.globalMode === "assigned") {
        matches = matches && !task.is_global;
    }
    if (filters.completion === "completed") {
        matches = matches && Number(task.progress) >= 100;
    } else if (filters.completion === "uncompleted") {
        matches = matches && Number(task.progress) < 100;
    }

    return filters.invert ? !matches : matches;
}

function compareTasksForSort(a, b, sortBy) {
    if (sortBy === "deadline") {
        const aHas = Boolean(a.deadline);
        const bHas = Boolean(b.deadline);
        if (aHas && bHas) {
            return new Date(a.deadline) - new Date(b.deadline);
        }
        if (aHas) return -1;
        if (bHas) return 1;
        return 0;
    }
    if (sortBy === "priority") {
        const diff = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
    }
    if (sortBy === "alphabetical") {
        return a.title.localeCompare(b.title);
    }
    return getTaskCreatedTimestamp(b) - getTaskCreatedTimestamp(a);
}

function populateTaskFilterUsers() {
    if (!taskFilterAssignedUser) {
        return;
    }

    const previous = taskFilterAssignedUser.value || "all";
    const usernames = new Set();
    assignableUsers.forEach((user) => usernames.add(String(user.username || "").trim()));
    tasksCache.forEach((task) => {
        (task.member_details || task.members || []).forEach((member) => {
            const username = typeof member === "string" ? member : member?.username;
            if (username) {
                usernames.add(String(username).trim());
            }
        });
    });
    if (currentUser?.username) {
        usernames.add(currentUser.username);
    }

    const options = [`<option value="all">${escapeHtml(t("all_users"))}</option>`];
    [...usernames]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .forEach((username) => {
            options.push(`<option value="${escapeHtml(username)}">${escapeHtml(username)}</option>`);
        });

    taskFilterAssignedUser.innerHTML = options.join("");
    taskFilterAssignedUser.value = [...taskFilterAssignedUser.options].some((option) => option.value === previous) ? previous : "all";
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        credentials: "same-origin",
        ...options,
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const message = data?.error || "Something went wrong.";
        throw new Error(message);
    }

    return data;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setImagePreview(previewEl, clearBtn, source = "", altKey = "task_image_preview") {
    if (!previewEl) {
        return;
    }

    const hasImage = Boolean(source);
    previewEl.src = hasImage ? source : "";
    previewEl.alt = t(altKey);
    previewEl.classList.toggle("hidden", !hasImage);
    clearBtn?.classList.toggle("hidden", !hasImage);
}

function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    if (value < 1024 * 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error(t("could_not_read_file")));
        reader.readAsDataURL(file);
    });
}

function renderPendingAttachmentList(listEl, items, mode = "create") {
    if (!listEl) {
        return;
    }

    if (!items.length) {
        listEl.innerHTML = `<div class="empty-state">${escapeHtml(t("no_attachments_selected"))}</div>`;
        return;
    }

    listEl.innerHTML = items.map((item, index) => `
        <div class="attachment-upload-item">
            <div class="attachment-main">
                <span class="attachment-name">${escapeHtml(item.name || "file")}</span>
                <span class="attachment-meta">${escapeHtml(formatFileSize(item.size))}${item.existing ? ` · ${escapeHtml(t("attachment_added"))}` : ""}</span>
            </div>
            <div class="attachment-actions">
                ${item.path ? `<a class="attachment-link" href="${escapeHtml(item.path)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(item.name || "")}">${escapeHtml(t("download_file"))}</a>` : ""}
                <button type="button" class="ghost-btn remove-pending-attachment-btn" data-index="${index}" data-mode="${mode}">
                    ${escapeHtml(t("remove_attachment"))}
                </button>
            </div>
        </div>
    `).join("");
}

function renderTaskAttachments(container, attachments) {
    if (!container) {
        return;
    }

    if (!attachments?.length) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(t("no_attachments"))}</div>`;
        return;
    }

    container.innerHTML = attachments.map((attachment) => `
        <div class="attachment-item">
            <div class="attachment-main">
                <span class="attachment-name">${escapeHtml(attachment.name || "file")}</span>
                <span class="attachment-meta">${escapeHtml(formatFileSize(attachment.size_bytes || 0))} · ${escapeHtml(attachment.mime_type || "application/octet-stream")}</span>
            </div>
            <div class="attachment-actions">
                <a class="attachment-link" href="${escapeHtml(attachment.path || "#")}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(attachment.name || "")}">
                    ${escapeHtml(t("download_file"))}
                </a>
            </div>
        </div>
    `).join("");
}

function slugifyMaterialType(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
}

function normalizeMaterialAmount(value) {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? rounded : rounded;
}

function formatMaterialAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) {
        return "0";
    }
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
}

function normalizeTaskMaterials(items) {
    const source = Array.isArray(items) ? items : [];
    const merged = new Map();

    source.forEach((item) => {
        const label = String(
            item?.material_label
            || item?.label
            || item?.material_type
            || item?.type
            || ""
        ).trim();
        const materialType = slugifyMaterialType(item?.material_type || item?.type || label);
        const amount = normalizeMaterialAmount(item?.allocated_amount ?? item?.amount);
        if (!materialType || !amount) {
            return;
        }

        const existing = merged.get(materialType);
        if (existing) {
            existing.allocated_amount = Math.round((existing.allocated_amount + amount) * 100) / 100;
            if (label.length > existing.material_label.length) {
                existing.material_label = label;
            }
        } else {
            merged.set(materialType, {
                material_type: materialType,
                material_label: label || materialType.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
                allocated_amount: amount,
            });
        }
    });

    return [...merged.values()].sort((left, right) => left.material_label.localeCompare(right.material_label));
}

function getTaskMaterials(task) {
    if (Array.isArray(task?.materials)) {
        return task.materials;
    }
    if (typeof task?.materials_config === "string" && task.materials_config.trim()) {
        try {
            return normalizeTaskMaterials(JSON.parse(task.materials_config));
        } catch {
            return [];
        }
    }
    return [];
}

function getTaskMaterialRequirement(subtask) {
    if (subtask?.requirement_material && typeof subtask.requirement_material === "object") {
        return subtask.requirement_material;
    }
    if (typeof subtask?.requirement_config === "string" && subtask.requirement_config.trim()) {
        try {
            const parsed = JSON.parse(subtask.requirement_config);
            const amount = normalizeMaterialAmount(parsed?.amount);
            const label = String(parsed?.material_label || parsed?.label || parsed?.material_type || "").trim();
            const materialType = slugifyMaterialType(parsed?.material_type || label);
            if (materialType && amount) {
                return {
                    material_type: materialType,
                    material_label: label || materialType.replace(/_/g, " "),
                    amount,
                    remaining_amount: 0,
                };
            }
        } catch {
            return null;
        }
    }
    return null;
}

function renderTaskMaterials(container, materials) {
    if (!container) {
        return;
    }

    const source = Array.isArray(materials) ? materials : [];
    const items = source.length && "reserved_amount" in (source[0] || {})
        ? source.map((item) => ({
            material_type: item.material_type,
            material_label: item.material_label,
            allocated_amount: Number(item.allocated_amount || 0),
            reserved_amount: Number(item.reserved_amount || 0),
            remaining_amount: Number(item.remaining_amount || 0),
        }))
        : normalizeTaskMaterials(source).map((item) => ({
            ...item,
            reserved_amount: 0,
            remaining_amount: Number(item.allocated_amount || 0),
        }));

    container.innerHTML = items.length
        ? items.map((material) => `
            <div class="task-material-item">
                <div class="task-material-main">
                    <strong>${escapeHtml(material.material_label)}</strong>
                    <span>${escapeHtml(t("allocated_amount"))}: ${escapeHtml(formatMaterialAmount(material.allocated_amount))}</span>
                </div>
                <div class="task-material-stats">
                    <span>${escapeHtml(t("reserved_amount"))}: ${escapeHtml(formatMaterialAmount(material.reserved_amount))}</span>
                    <span>${escapeHtml(t("remaining_amount"))}: ${escapeHtml(formatMaterialAmount(material.remaining_amount))}</span>
                </div>
            </div>
        `).join("")
        : `<div class="empty-state">${escapeHtml(t("material_pool_empty"))}</div>`;
}

function getMaterialState(mode = "create") {
    return mode === "edit" ? editTaskMaterials : pendingTaskMaterials;
}

function setMaterialState(mode, nextItems) {
    const normalized = normalizeTaskMaterials(nextItems);
    if (mode === "edit") {
        editTaskMaterials = normalized;
        return;
    }
    pendingTaskMaterials = normalized;
}

function getMaterialListContainer(mode = "create") {
    return mode === "edit" ? editTaskMaterialsList : taskMaterialsList;
}

function updateMaterialRowValue(mode, index, field, value) {
    const next = getMaterialState(mode).map((item) => ({ ...item }));
    if (!next[index]) {
        return;
    }
    next[index][field] = value;
    setMaterialState(mode, next);
    renderTaskMaterialConfigList(mode);
}

function removeMaterialRow(mode, index) {
    const next = getMaterialState(mode).filter((_, itemIndex) => itemIndex !== index);
    setMaterialState(mode, next);
    renderTaskMaterialConfigList(mode);
}

function addMaterialRow(mode, material = null) {
    const next = [
        ...getMaterialState(mode).map((item) => ({ ...item })),
        material || { material_label: "", material_type: "", allocated_amount: "" },
    ];
    if (mode === "edit") {
        editTaskMaterials = next;
    } else {
        pendingTaskMaterials = next;
    }
    renderTaskMaterialConfigList(mode);
}

function renderTaskMaterialConfigList(mode = "create") {
    const container = getMaterialListContainer(mode);
    if (!container) {
        return;
    }

    const items = getMaterialState(mode);
    if (!items.length) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(t("material_row_empty"))}</div>`;
        return;
    }

    container.innerHTML = items.map((material, index) => `
        <div class="material-config-row" data-mode="${escapeHtml(mode)}" data-index="${index}">
            <input
                type="text"
                class="material-type-input"
                list="taskMaterialSuggestions"
                value="${escapeHtml(material.material_label || "")}"
                placeholder="${escapeHtml(t("material_type_placeholder"))}"
            >
            <input
                type="number"
                class="material-amount-input"
                min="0.01"
                step="0.01"
                value="${escapeHtml(material.allocated_amount ? formatMaterialAmount(material.allocated_amount) : "")}"
                placeholder="${escapeHtml(t("material_amount_placeholder"))}"
            >
            <button type="button" class="ghost-btn remove-material-btn">${escapeHtml(t("remove_attachment"))}</button>
        </div>
    `).join("");

    container.querySelectorAll(".material-config-row").forEach((row) => {
        const index = Number(row.dataset.index);
        row.querySelector(".material-type-input")?.addEventListener("input", (event) => {
            const label = event.target.value;
            const next = getMaterialState(mode).map((item) => ({ ...item }));
            if (!next[index]) {
                return;
            }
            next[index].material_label = label;
            next[index].material_type = slugifyMaterialType(label);
            if (mode === "edit") {
                editTaskMaterials = next;
            } else {
                pendingTaskMaterials = next;
            }
        });
        row.querySelector(".material-amount-input")?.addEventListener("input", (event) => {
            const next = getMaterialState(mode).map((item) => ({ ...item }));
            if (!next[index]) {
                return;
            }
            next[index].allocated_amount = event.target.value;
            if (mode === "edit") {
                editTaskMaterials = next;
            } else {
                pendingTaskMaterials = next;
            }
        });
        row.querySelector(".remove-material-btn")?.addEventListener("click", () => removeMaterialRow(mode, index));
    });
}

function collectMaterialPayload(mode = "create") {
    const container = getMaterialListContainer(mode);
    if (!container) {
        return [];
    }
    const items = [...container.querySelectorAll(".material-config-row")].map((row) => ({
        material_label: row.querySelector(".material-type-input")?.value.trim() || "",
        material_type: slugifyMaterialType(row.querySelector(".material-type-input")?.value.trim() || ""),
        allocated_amount: row.querySelector(".material-amount-input")?.value || "",
    }));
    return normalizeTaskMaterials(items);
}

function resetTaskMaterialState(mode = "create") {
    if (mode === "edit") {
        editTaskMaterials = [];
    } else {
        pendingTaskMaterials = [];
    }
    renderTaskMaterialConfigList(mode);
}

function syncSubtaskMaterialFields(subtaskForm, task) {
    if (!subtaskForm) {
        return;
    }
    const requirementType = subtaskForm.elements.subtaskRequirementType?.value || "";
    const materialFields = subtaskForm.querySelector(".subtask-material-fields");
    const materialTypeInput = subtaskForm.elements.subtaskMaterialType;
    const materialAmountInput = subtaskForm.elements.subtaskMaterialAmount;
    if (!materialFields || !materialTypeInput || !materialAmountInput) {
        return;
    }

    const enabled = requirementType === "materials";
    materialFields.classList.toggle("hidden", !enabled);
    materialTypeInput.disabled = !enabled;
    materialAmountInput.disabled = !enabled;
    if (!enabled) {
        materialTypeInput.value = "";
        materialAmountInput.value = "";
        return;
    }

    const taskMaterials = getTaskMaterials(task);
    if (!materialTypeInput.value && taskMaterials[0]) {
        materialTypeInput.value = taskMaterials[0].material_label || "";
    }
}

function getSubtaskRequirementStatus(subtask) {
    if (!subtask?.requirement_type) {
        return "";
    }
    if (subtask.requirement_type === "materials") {
        return subtask.requirement_satisfied ? t("materials_requirement_ready") : t("blocked_until_materials");
    }
    return subtask.requirement_satisfied ? t("requirement_file_received") : t("requirement_waiting_file");
}

function renderSubtaskRequirementPanel(subtask) {
    if (!subtask?.requirement_type) {
        return "";
    }

    const statusClass = subtask.requirement_satisfied ? "ready" : "pending";
    const materialRequirement = getTaskMaterialRequirement(subtask);
    const submissionLinks = (subtask.requirement_submissions || []).slice(-3).map((submission) => `
        <div class="subtask-requirement-file">
            <a class="attachment-link" href="${escapeHtml(submission.path || "#")}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(submission.name || "")}">
                ${escapeHtml(submission.name || "file")}
            </a>
            <span>${escapeHtml(t("submitted_by_label"))} ${escapeHtml(submission.submitted_by || "")}</span>
        </div>
    `).join("");

    return `
        <div class="subtask-requirement-panel">
            <div class="subtask-requirement-status ${statusClass}">
                ${escapeHtml(getSubtaskRequirementStatus(subtask))}
            </div>
            ${subtask.requirement_type === "materials" && materialRequirement ? `
                <div class="subtask-material-summary">
                    <span><strong>${escapeHtml(t("material_type"))}:</strong> ${escapeHtml(materialRequirement.material_label || "")}</span>
                    <span><strong>${escapeHtml(t("amount_needed"))}:</strong> ${escapeHtml(formatMaterialAmount(materialRequirement.amount || 0))}</span>
                    <span><strong>${escapeHtml(t("task_materials_remaining"))}:</strong> ${escapeHtml(formatMaterialAmount(materialRequirement.remaining_amount || 0))}</span>
                </div>
            ` : ""}
            ${submissionLinks ? `<div class="subtask-requirement-files">${submissionLinks}</div>` : ""}
            ${subtask.requirement_type === "file" ? `
                <div class="attachment-actions">
                    <label class="secondary-btn upload-btn submit-requirement-btn" for="subtaskRequirementInput-${subtask.id}">
                        ${escapeHtml(t("submit_requirement_file"))}
                    </label>
                    <input id="subtaskRequirementInput-${subtask.id}" class="hidden subtask-requirement-input" type="file">
                </div>
            ` : ""}
        </div>
    `;
}

function clearTaskCreateImageState(slot) {
    if (slot === "banner") {
        pendingTaskBannerImageData = "";
        if (taskBannerImageInput) {
            taskBannerImageInput.value = "";
        }
        setImagePreview(taskBannerImagePreview, clearTaskBannerImageBtn, "", "task_banner_preview");
        return;
    }

    pendingTaskMainImageData = "";
    if (taskMainImageInput) {
        taskMainImageInput.value = "";
    }
    setImagePreview(taskMainImagePreview, clearTaskMainImageBtn, "", "task_image_preview");
}

function resetCreateTaskImageState() {
    clearTaskCreateImageState("main");
    clearTaskCreateImageState("banner");
}

function resetCreateTaskAttachmentState() {
    pendingTaskAttachments = [];
    if (taskAttachmentsInput) {
        taskAttachmentsInput.value = "";
    }
    renderPendingAttachmentList(taskAttachmentsList, pendingTaskAttachments, "create");
}

function resetCreateTaskAdvancedState() {
    resetCreateTaskImageState();
    resetCreateTaskAttachmentState();
    resetTaskMaterialState("create");
}

function updateGlobalTaskControls(mode = "create") {
    const isEdit = mode === "edit";
    const checkbox = isEdit ? editTaskIsGlobal : taskIsGlobal;
    const select = isEdit ? editTaskGlobalEditMode : taskGlobalEditMode;
    if (!checkbox || !select) {
        return;
    }

    const enabled = Boolean(checkbox.checked);
    select.disabled = !enabled;
    select.closest(".form-group")?.classList.toggle("muted-field", !enabled);
}

function resetEditTaskImageState() {
    editTaskMainImageData = "";
    editTaskBannerImageData = "";
    editTaskRemoveMainImage = false;
    editTaskRemoveBannerImage = false;
    if (editTaskMainImageInput) {
        editTaskMainImageInput.value = "";
    }
    if (editTaskBannerImageInput) {
        editTaskBannerImageInput.value = "";
    }
}

function resetEditTaskAttachmentState() {
    editTaskAttachments = [];
    editTaskRemoveAttachmentIds = [];
    if (editTaskAttachmentsInput) {
        editTaskAttachmentsInput.value = "";
    }
    renderPendingAttachmentList(editTaskAttachmentsList, editTaskAttachments, "edit");
}

function readImageFileAsDataUrl(file) {
    return readFileAsDataUrl(file).catch(() => {
        throw new Error(t("could_not_read_image_file"));
    });
}

async function handleTaskImageSelection(file, slot, mode = "create") {
    if (!file) {
        return;
    }

    const dataUrl = await readImageFileAsDataUrl(file);
    const isBanner = slot === "banner";
    const isEdit = mode === "edit";

    if (isEdit) {
        if (isBanner) {
            editTaskBannerImageData = dataUrl;
            editTaskRemoveBannerImage = false;
            setImagePreview(editTaskBannerImagePreview, clearEditTaskBannerImageBtn, dataUrl, "task_banner_preview");
        } else {
            editTaskMainImageData = dataUrl;
            editTaskRemoveMainImage = false;
            setImagePreview(editTaskMainImagePreview, clearEditTaskMainImageBtn, dataUrl, "task_image_preview");
        }
        return;
    }

    if (isBanner) {
        pendingTaskBannerImageData = dataUrl;
        setImagePreview(taskBannerImagePreview, clearTaskBannerImageBtn, dataUrl, "task_banner_preview");
    } else {
        pendingTaskMainImageData = dataUrl;
        setImagePreview(taskMainImagePreview, clearTaskMainImageBtn, dataUrl, "task_image_preview");
    }
}

async function handleTaskAttachmentSelection(files, mode = "create") {
    const selectedFiles = [...(files || [])];
    if (!selectedFiles.length) {
        return;
    }

    const nextItems = await Promise.all(selectedFiles.map(async (file) => ({
        name: file.name || "file",
        size: Number(file.size) || 0,
        type: file.type || "application/octet-stream",
        data_url: await readFileAsDataUrl(file),
    })));

    if (mode === "edit") {
        editTaskAttachments = [...editTaskAttachments, ...nextItems];
        renderPendingAttachmentList(editTaskAttachmentsList, editTaskAttachments, "edit");
        if (editTaskAttachmentsInput) {
            editTaskAttachmentsInput.value = "";
        }
        return;
    }

    pendingTaskAttachments = [...pendingTaskAttachments, ...nextItems];
    renderPendingAttachmentList(taskAttachmentsList, pendingTaskAttachments, "create");
    if (taskAttachmentsInput) {
        taskAttachmentsInput.value = "";
    }
}

function formatPriority(priority) {
    return (priority || "medium").toLowerCase();
}

function formatDateTime(value) {
    if (!value) {
        return t("no_deadline");
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return t("no_deadline");
    }
    return date.toLocaleString();
}

function applyCompactMode(enabled) {
    document.body.classList.toggle("compact", Boolean(enabled));
}

function applyAccessibilityMode(enabled) {
    document.body.classList.toggle("accessibility-mode", Boolean(enabled));
}

const SPEECH_LOCALE_BY_LANGUAGE = {
    en: "en-US",
    ru: "ru-RU",
    da: "da-DK",
    no: "nb-NO",
    sv: "sv-SE",
    de: "de-DE",
    uk: "uk-UA",
    pl: "pl-PL",
    pirate: "en-US",
    lolcat: "en-US",
    craft: "en-US",
};

let activeSpeechVoiceInfo = {
    locale: "en-US",
    voice: null,
    fallback: false,
    ready: false,
};

function getSpeechLocale() {
    return SPEECH_LOCALE_BY_LANGUAGE[getLanguage()] || "en-US";
}

function getSpeechVoices() {
    if (!("speechSynthesis" in window)) {
        return [];
    }
    return window.speechSynthesis.getVoices() || [];
}

function findSpeechVoice(locale) {
    const voices = getSpeechVoices();
    const normalizedLocale = String(locale || "en-US").toLowerCase();
    const languagePart = normalizedLocale.split("-")[0];

    return voices.find((voice) => voice.lang?.toLowerCase() === normalizedLocale)
        || voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${languagePart}-`))
        || voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-"))
        || null;
}

function resolveSpeechVoice() {
    const locale = getSpeechLocale();
    const voice = findSpeechVoice(locale);
    activeSpeechVoiceInfo = {
        locale,
        voice,
        fallback: Boolean(voice && !voice.lang?.toLowerCase().startsWith(locale.split("-")[0].toLowerCase())),
        ready: getSpeechVoices().length > 0,
    };
    updateTtsVoiceStatus();
    return activeSpeechVoiceInfo;
}

function getSpeechVoice(locale) {
    return findSpeechVoice(locale);
}

function updateTtsVoiceStatus() {
    if (!ttsVoiceLabel || !ttsVoiceStatus) {
        return;
    }

    ttsVoiceLabel.textContent = t("tts_voice_label");

    if (!("speechSynthesis" in window)) {
        ttsVoiceStatus.textContent = t("tts_voice_unavailable");
        return;
    }

    const locale = activeSpeechVoiceInfo.locale || getSpeechLocale();
    const voice = activeSpeechVoiceInfo.voice;
    const label = voice?.name
        ? fillTemplate(t("tts_voice_active"), {
            locale: voice.lang || locale,
            voice: voice.name,
        })
        : fillTemplate(t("tts_voice_default"), { locale });
    ttsVoiceStatus.textContent = label;
}

function getReadableTextFromBlock(block) {
    if (!block) {
        return "";
    }

    const clone = block.cloneNode(true);
    clone.querySelectorAll(".read-aloud-btn").forEach((button) => button.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
}

function speakText(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) {
        return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        console.warn(t("reading_not_supported"));
        return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(value);
    const { locale, voice } = resolveSpeechVoice();

    utterance.lang = voice?.lang || locale;
    utterance.rate = 1;
    utterance.pitch = 1;
    if (voice) {
        utterance.voice = voice;
    }

    utterance.onend = () => {
        if (activeSpeechUtterance === utterance) {
            activeSpeechUtterance = null;
        }
    };
    utterance.onerror = (event) => {
        console.error("Read aloud failed.", event);
        if (activeSpeechUtterance === utterance) {
            activeSpeechUtterance = null;
        }
    };

    activeSpeechUtterance = utterance;
    window.speechSynthesis.speak(utterance);
}

const READABLE_BLOCK_SELECTOR = [
    ".auth-header p",
    ".hero-left p",
    ".section-head p",
    ".section-head-top p",
    ".task-description",
    ".auth-hint",
    ".empty-state",
    ".activity-item p",
    ".update-log-item p",
    ".analytics-chart-summary",
].join(", ");

function decorateReadableBlocks(root = document) {
    root.querySelectorAll(READABLE_BLOCK_SELECTOR).forEach((block) => {
        const text = getReadableTextFromBlock(block);
        let wrapper = block.parentElement?.classList.contains("readable-block-wrap")
            ? block.parentElement
            : null;
        const existingButton = wrapper?.querySelector(".read-aloud-btn") || null;

        if (text.length < 18) {
            existingButton?.remove();
            block.classList.remove("readable-block");
            return;
        }

        if (!wrapper && block.parentNode) {
            wrapper = document.createElement("div");
            wrapper.className = "readable-block-wrap";
            block.parentNode.insertBefore(wrapper, block);
            wrapper.appendChild(block);
        }

        block.classList.add("readable-block");

        const button = existingButton || document.createElement("button");
        button.type = "button";
        button.className = "read-aloud-btn";
        button.innerHTML = '<span aria-hidden="true">🔊</span>';
        button.title = t("read_aloud");
        button.setAttribute("aria-label", t("read_aloud"));

        if (!existingButton && wrapper) {
            wrapper.appendChild(button);
        }
    });
}

function getCountdownText(value) {
    if (!value) {
        return "";
    }

    const target = new Date(value).getTime();
    if (Number.isNaN(target)) {
        return "";
    }

    const now = Date.now();
    let diff = target - now;
    const overdue = diff < 0;
    diff = Math.abs(diff);

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);

    let text = "";
    if (days > 0) {
        text = `${days}d ${hours}h`;
    } else if (hours > 0) {
        text = `${hours}h ${minutes}m`;
    } else {
        text = `${minutes}m`;
    }

    return overdue ? `${t("overdue")} ${text}` : `${t("due_soon")} ${text}`;
}

function isDueSoon(value) {
    if (!value) {
        return false;
    }
    const target = new Date(value).getTime();
    if (Number.isNaN(target)) {
        return false;
    }
    const diff = target - Date.now();
    return diff > 0 && diff <= getUpcomingThresholdMs();
}

function isOverdue(value) {
    if (!value) {
        return false;
    }
    const target = new Date(value).getTime();
    if (Number.isNaN(target)) {
        return false;
    }
    return target < Date.now();
}

function getDeadlineCategory(value) {
    if (!value) {
        return "normal";
    }

    if (isOverdue(value)) {
        return "overdue";
    }

    if (isDueSoon(value)) {
        return "upcoming";
    }

    return "normal";
}

function isTaskCompleted(task) {
    return Number(task?.progress) >= 100;
}

function isSubtaskCompleted(subtask) {
    return Boolean(subtask?.completed);
}

function getDashboardBuckets() {
    const buckets = {
        normalTasks: [],
        upcomingItems: [],
        overdueItems: [],
    };

    tasksCache.forEach((task) => {
        if (isTaskCompleted(task)) {
            return;
        }

        const taskCategory = getDeadlineCategory(task.deadline);

        if (taskCategory === "normal") {
            buckets.normalTasks.push({
                type: "task",
                id: `task-${task.id}`,
                title: task.title,
                deadline: task.deadline,
                subtasks: task.subtasks || [],
            });
        } else if (taskCategory === "upcoming") {
            buckets.upcomingItems.push({
                type: "task",
                id: `task-${task.id}`,
                title: task.title,
                deadline: task.deadline,
                subtasks: task.subtasks || [],
            });
        } else if (taskCategory === "overdue") {
            buckets.overdueItems.push({
                type: "task",
                id: `task-${task.id}`,
                title: task.title,
                deadline: task.deadline,
                subtasks: task.subtasks || [],
            });
        }

        task.subtasks.forEach((subtask) => {
            if (isSubtaskCompleted(subtask)) {
                return;
            }

            const subtaskCategory = getDeadlineCategory(subtask.deadline);
            if (subtaskCategory === "normal") {
                return;
            }

            const item = {
                type: "subtask",
                id: `subtask-${subtask.id}`,
                title: subtask.title,
                deadline: subtask.deadline,
                parentTitle: task.title,
            };

            if (subtaskCategory === "upcoming") {
                buckets.upcomingItems.push(item);
            } else {
                buckets.overdueItems.push(item);
            }
        });
    });

    buckets.normalTasks.sort((a, b) => a.title.localeCompare(b.title));
    buckets.upcomingItems.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    buckets.overdueItems.sort((a, b) => new Date(b.deadline) - new Date(a.deadline));

    return buckets;
}

function renderDeadlineMiniItem(item, toneClass = "") {
    const meta = item.type === "subtask"
        ? `Subtask in ${escapeHtml(item.parentTitle)}`
        : escapeHtml(formatDateTime(item.deadline));
    const subtaskPreview = item.type === "task" ? renderDeadlineSubtaskPreview(item.subtasks || []) : "";

    return `
        <div class="mini-task-item ${toneClass}">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="${toneClass}">${escapeHtml(getCountdownText(item.deadline))}</span>
            <span>${meta}</span>
            ${subtaskPreview}
        </div>
    `;
}

function renderDeadlineSubtaskPreview(subtasks) {
    if (!subtasks.length) {
        return "";
    }

    const previewItems = subtasks.slice(0, 3).map((subtask) => `
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:0.84rem;color:var(--muted);">
            <input type="checkbox" ${subtask.completed ? "checked" : ""} disabled style="margin:0;inline-size:14px;block-size:14px;accent-color:var(--accent);">
            <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${subtask.completed ? "text-decoration:line-through;" : ""}">
                ${escapeHtml(subtask.title)}
            </span>
            <span style="font-size:0.76rem;opacity:0.85;">${subtask.completed ? t("subtask_status_done") : t("subtask_status_open")}</span>
        </div>
    `).join("");

    const overflowLabel = subtasks.length > 3
        ? `<div style="margin-top:6px;font-size:0.76rem;color:var(--muted);">+${subtasks.length - 3} more subtasks</div>`
        : "";

    return `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
            ${previewItems}
            ${overflowLabel}
        </div>
    `;
}

function createPriorityBadge(priority) {
    const safe = formatPriority(priority);
    return `<span class="priority-badge priority-${safe}">${safe}</span>`;
}

function formatThresholdLabel(hours) {
    if (hours === 24) {
        return "24 hours";
    }
    if (hours === 48) {
        return "48 hours";
    }
    if (hours === 168) {
        return "1 week";
    }
    if (hours === 720) {
        return "1 month";
    }
    if (hours % 24 === 0) {
        const days = hours / 24;
        return `${days} day${days === 1 ? "" : "s"}`;
    }
    return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function getUpcomingThresholdHours() {
    const mode = localStorage.getItem("tm_upcoming_threshold") || "48";
    if (mode === "custom") {
        const customHours = Number(localStorage.getItem("tm_upcoming_threshold_custom") || "48");
        return Math.min(Math.max(customHours, 1), 720);
    }

    const presetHours = Number(mode);
    return Number.isFinite(presetHours) && presetHours > 0 ? presetHours : 48;
}

function getUpcomingThresholdMs() {
    return getUpcomingThresholdHours() * 60 * 60 * 1000;
}

function updateThresholdControls() {
    if (!upcomingThreshold || !customThresholdRow || !customThresholdSlider || !customThresholdValue) {
        return;
    }

    const mode = localStorage.getItem("tm_upcoming_threshold") || "48";
    const customHours = getUpcomingThresholdHours();

    upcomingThreshold.value = mode;
    customThresholdSlider.value = String(customHours);
    customThresholdValue.textContent = formatThresholdLabel(customHours);
    customThresholdRow.classList.toggle("hidden", mode !== "custom");
}

function setTaskCreatorCollapsed(collapsed) {
    if (!taskForm || !toggleTaskCreatorBtn) {
        return;
    }

    taskForm.classList.toggle("collapsed", Boolean(collapsed));
    toggleTaskCreatorBtn.textContent = collapsed ? t("open_creator") : t("close_creator");
    toggleTaskCreatorBtn.setAttribute("aria-expanded", String(!collapsed));
}

function setAdvancedTaskSettingsOpen(open) {
    if (!advancedTaskSettings || !toggleAdvancedTaskSettingsBtn) {
        return;
    }

    advancedTaskSettings.classList.toggle("hidden", !open);
    toggleAdvancedTaskSettingsBtn.textContent = open ? t("hide_advanced_settings") : t("advanced_settings");
    toggleAdvancedTaskSettingsBtn.setAttribute("aria-expanded", String(open));
}

function applySettings() {
    const theme = localStorage.getItem("tm_theme") || "default";
    const animationsEnabled = localStorage.getItem("tm_animations") !== "false";
    const notificationsEnabled = localStorage.getItem("tm_notifications") === "true";
    const compactEnabled = localStorage.getItem("tm_compact") === "true";
    const accessibilityEnabled = localStorage.getItem("tm_accessibility") === "true";
    const soundsEnabled = localStorage.getItem("tm_sounds") === "true";

    document.body.dataset.theme = theme;
    document.body.classList.toggle("no-animations", !animationsEnabled);
    applyCompactMode(compactEnabled);
    applyAccessibilityMode(accessibilityEnabled);

    themeSelect.value = theme;
    updateThresholdControls();
    toggleAnimations.checked = animationsEnabled;
    toggleNotifications.checked = notificationsEnabled;
    compactMode.checked = compactEnabled;
    if (accessibilityMode) {
        accessibilityMode.checked = accessibilityEnabled;
    }
    if (toggleSounds) {
        toggleSounds.checked = soundsEnabled;
    }
}

function persistSettings() {
    localStorage.setItem("tm_theme", themeSelect.value);
    localStorage.setItem("tm_animations", String(toggleAnimations.checked));
    localStorage.setItem("tm_notifications", String(toggleNotifications.checked));
    localStorage.setItem("tm_compact", String(compactMode.checked));
    localStorage.setItem("tm_accessibility", String(accessibilityMode?.checked));
    localStorage.setItem("tm_sounds", String(toggleSounds?.checked));
    applySettings();
    updateAllSecondaryViews();
    checkDeadlineNotifications();
}

function switchAuthTab(mode) {
    const loginMode = mode === "login";
    loginForm.classList.toggle("hidden", !loginMode);
    registerForm.classList.toggle("hidden", loginMode);
    forgotPasswordRequestForm.classList.add("hidden");
    forgotPasswordResetForm.classList.add("hidden");
    showLoginBtn.classList.toggle("active", loginMode);
    showRegisterBtn.classList.toggle("active", !loginMode);
    resetTokenInfo.classList.add("hidden");
}

function showForgotPasswordRequest() {
    loginForm.classList.add("hidden");
    registerForm.classList.add("hidden");
    forgotPasswordResetForm.classList.add("hidden");
    forgotPasswordRequestForm.classList.remove("hidden");
    showLoginBtn.classList.remove("active");
    showRegisterBtn.classList.remove("active");
    resetTokenInfo.classList.add("hidden");
}

function showForgotPasswordReset(data = null) {
    loginForm.classList.add("hidden");
    registerForm.classList.add("hidden");
    forgotPasswordRequestForm.classList.add("hidden");
    forgotPasswordResetForm.classList.remove("hidden");
    showLoginBtn.classList.remove("active");
    showRegisterBtn.classList.remove("active");

    if (data) {
        const contact = document.getElementById("resetContact").value.trim();
        document.getElementById("resetContactConfirm").value = contact;
        document.getElementById("resetToken").value = data.token || "";
        resetTokenInfo.textContent = fillTemplate(t("reset_token_info_format"), {
            token: data.token,
            expires: new Date(data.expires_at).toLocaleString(),
        });
        resetTokenInfo.classList.remove("hidden");
    }
}

function showApp() {
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    renderProfileSummary();
    updateAdminUi();
}

function showAuth() {
    authScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    pinnedChatWindow?.classList.add("hidden");
    closeStartPrivateChatModal();
}

function switchPage(pageId) {
    if ((pageId === "adminPage" || pageId === "analyticsPage") && !currentUser?.is_admin) {
        pageId = "dashboardPage";
    }

    pages.forEach((page) => {
        page.classList.toggle("active", page.id === pageId);
    });

    navButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.page === pageId);
    });

    if (pageId === "completedPage" && currentUser) {
        loadCompletedTasks();
    }
    if (pageId === "privateMessagesPage" && currentUser) {
        loadPrivateChats();
    }

    updateMentionBadge();
    updatePrivateMessageBadge();
    decorateReadableBlocks();
}

function getDefaultAvatarDataUri(name = "TM") {
    const initials = escapeHtml((name || "TM").trim().slice(0, 2).toUpperCase());
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
            <rect width="120" height="120" rx="28" fill="#1f3556"/>
            <circle cx="60" cy="45" r="22" fill="#4aa8d8"/>
            <rect x="24" y="74" width="72" height="26" rx="13" fill="#4aa8d8"/>
            <text x="60" y="112" text-anchor="middle" font-size="20" fill="#eaf3ff" font-family="Arial, Helvetica, sans-serif">${initials}</text>
        </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderProfileSummary() {
    if (!currentUser) {
        return;
    }

    const avatarSrc = getUserAvatarSrc(currentUser, currentUser.username, { pendingData: pendingProfileImageData });
    if (profileAvatarPreview) {
        profileAvatarPreview.src = avatarSrc;
    }
    if (document.getElementById("profileUsername")) {
        document.getElementById("profileUsername").value = currentUser.username || "";
    }
    if (document.getElementById("profileContact")) {
        document.getElementById("profileContact").value = currentUser.contact || "";
    }
    renderDeleteAccountState();
}

function renderDeleteAccountState() {
    const rootLocked = Boolean(currentUser?.is_headadmin);

    if (deleteAccountBtn) {
        deleteAccountBtn.disabled = rootLocked;
        deleteAccountBtn.classList.toggle("ghost-btn", rootLocked);
        deleteAccountBtn.classList.toggle("danger-btn", !rootLocked);
    }

    if (deleteAccountLockNote) {
        deleteAccountLockNote.textContent = rootLocked ? t("delete_account_root_locked") : "";
        deleteAccountLockNote.classList.toggle("hidden", !rootLocked);
    }
}

function openDeleteAccountModal() {
    if (!deleteAccountModal || !deleteAccountPassword || currentUser?.is_headadmin) {
        return;
    }
    deleteAccountPassword.value = "";
    deleteAccountModal.classList.remove("hidden");
    deleteAccountPassword.focus();
}

function closeDeleteAccountModal() {
    if (!deleteAccountModal) {
        return;
    }
    deleteAccountModal.classList.add("hidden");
    if (deleteAccountPassword) {
        deleteAccountPassword.value = "";
    }
}

function closeEditTaskModal() {
    if (!editTaskModal) {
        return;
    }

    editTaskModal.classList.add("hidden");
    editingTaskId = null;
    resetEditTaskImageState();
    resetEditTaskAttachmentState();
    editTaskForm?.reset();
    setImagePreview(editTaskMainImagePreview, clearEditTaskMainImageBtn, "", "task_image_preview");
    setImagePreview(editTaskBannerImagePreview, clearEditTaskBannerImageBtn, "", "task_banner_preview");
    if (editTaskIsGlobal) {
        editTaskIsGlobal.checked = false;
    }
    if (editTaskGlobalEditMode) {
        editTaskGlobalEditMode.value = "members";
    }
    resetTaskMaterialState("edit");
    updateGlobalTaskControls("edit");
}

function openEditTaskModal(task) {
    if (!editTaskModal || !editTaskForm || !task) {
        return;
    }

    editingTaskId = Number(task.id);
    resetEditTaskImageState();
    resetEditTaskAttachmentState();
    editTaskForm.reset();

    if (editTaskTitle) editTaskTitle.value = task.title || "";
    if (editTaskDeadline) editTaskDeadline.value = task.deadline || "";
    if (editTaskDescription) editTaskDescription.value = task.description || "";
    if (editTaskPriority) editTaskPriority.value = formatPriority(task.priority);
    if (editTaskIsGlobal) editTaskIsGlobal.checked = Boolean(task.is_global);
    if (editTaskGlobalEditMode) editTaskGlobalEditMode.value = String(task.global_edit_mode || "members");
    editTaskMaterials = getTaskMaterials(task).map((material) => ({
        material_type: material.material_type,
        material_label: material.material_label,
        allocated_amount: material.allocated_amount,
    }));
    renderTaskMaterialConfigList("edit");
    updateGlobalTaskControls("edit");

    setImagePreview(editTaskMainImagePreview, clearEditTaskMainImageBtn, task.main_image_path || "", "task_image_preview");
    setImagePreview(editTaskBannerImagePreview, clearEditTaskBannerImageBtn, task.banner_image_path || "", "task_banner_preview");
    editTaskAttachments = (task.attachments || []).map((attachment) => ({
        id: Number(attachment.id),
        name: attachment.name || "file",
        size: Number(attachment.size_bytes) || 0,
        type: attachment.mime_type || "application/octet-stream",
        path: attachment.path || "",
        existing: true,
    }));
    renderPendingAttachmentList(editTaskAttachmentsList, editTaskAttachments, "edit");

    editTaskModal.classList.remove("hidden");
    initDatePickers();
    editTaskTitle?.focus();
}

function updateTaskCompletionReadyState(card, task) {
    if (!card || !task) {
        return;
    }

    const readyWrap = card.querySelector(".task-complete-ready");
    const readyNote = card.querySelector(".task-complete-note");
    const readyButton = card.querySelector(".confirm-task-btn");
    const readyForConfirmation = Number(task.progress) >= 100 && Number(task.subtask_count || 0) > 0;

    if (!readyWrap || !readyNote || !readyButton) {
        return;
    }

    readyWrap.classList.toggle("hidden", !readyForConfirmation);
    readyNote.textContent = t("task_ready_to_complete");
    readyButton.textContent = t("confirm_completion_cta");
}

function openTaskCompletionModal(task) {
    if (!taskCompletionModal || !task) {
        return;
    }

    pendingTaskCompletion = { id: Number(task.id), title: task.title || "" };
    if (taskCompletionModalTitle) {
        taskCompletionModalTitle.textContent = t("confirm_task_completion_title");
    }
    if (taskCompletionModalText) {
        taskCompletionModalText.textContent = `${t("confirm_task_completion_desc")} "${task.title}"`;
    }
    taskCompletionModal.classList.remove("hidden");
}

function closeTaskCompletionModal() {
    pendingTaskCompletion = null;
    taskCompletionModal?.classList.add("hidden");
}

async function confirmPendingTaskCompletion() {
    if (!pendingTaskCompletion?.id) {
        return;
    }

    const taskId = pendingTaskCompletion.id;
    try {
        await fetchJSON(`/api/tasks/${taskId}/confirm-complete`, { method: "POST" });
        closeTaskCompletionModal();
        removeTaskFromUi(taskId);
        await Promise.all([
            loadActivityFeed(),
            loadCompletedTasks(),
            loadAnalytics(),
            document.getElementById("userDetailPage")?.classList.contains("active") && userProfileCache?.user?.username
                ? loadUserProfile(userProfileCache.user.username, { keepPeriod: true })
                : Promise.resolve(),
        ]);
    } catch (error) {
        alert(error.message);
    }
}

function updateAdminUi() {
    if (!adminNavBtn && !analyticsNavBtn) {
        return;
    }

    const isAdmin = Boolean(currentUser?.is_admin);
    adminNavBtn?.classList.toggle("hidden", !isAdmin);
    analyticsNavBtn?.classList.toggle("hidden", !isAdmin);

    if (
        !isAdmin &&
        (
            document.getElementById("adminPage")?.classList.contains("active") ||
            document.getElementById("analyticsPage")?.classList.contains("active")
        )
    ) {
        switchPage("dashboardPage");
    }
}

function renderAdminSummary() {
    if (!adminSummary) {
        return;
    }

    if (!currentUser?.is_admin) {
        adminSummary.innerHTML = `<p class="auth-hint">${escapeHtml(t("admin_tools_hidden"))}</p>`;
        return;
    }

    const adminCount = adminUsersCache.filter((user) => user.is_admin).length;
    const headadminCount = adminUsersCache.filter((user) => user.is_headadmin).length;
    adminSummary.innerHTML = `
        <div class="admin-user-meta">
            <span><strong>${tasksCache.length}</strong> ${escapeHtml(t("visible_tasks"))}</span>
            <span><strong>${adminUsersCache.length}</strong> ${escapeHtml(t("users_word"))}</span>
            <span><strong>${adminCount}</strong> ${escapeHtml(t("admins_word"))}</span>
            <span><strong>${headadminCount}</strong> ${escapeHtml(t("headadmins_word"))}</span>
        </div>
        <p class="auth-hint">${escapeHtml(currentUser.is_headadmin ? t("headadmin_signed_in") : t("admin_signed_in"))}</p>
    `;
}

function renderAdminUsers() {
    if (!adminUsersList) {
        return;
    }

    if (!currentUser?.is_admin) {
        adminUsersList.innerHTML = `<div class="empty-state">${escapeHtml(t("admin_access_required"))}</div>`;
        return;
    }

    if (!adminUsersCache.length) {
        adminUsersList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_users_found"))}</div>`;
        return;
    }

    adminUsersList.innerHTML = adminUsersCache.map((user) => {
        const isCurrentUser = user.id === currentUser.id;
        const isRoot = user.username.toLowerCase() === "root";
        const deleteDisabled = isCurrentUser || isRoot;
        const deleteLabel = isCurrentUser
            ? t("current_account")
            : isRoot
                ? t("protected_account")
                : t("delete_user");
        const canToggleAdmin = Boolean(currentUser?.is_headadmin) && !isRoot;
        const roleButtonLabel = user.is_admin ? t("demote_admin") : t("promote_admin");

        return `
            <article class="admin-user-card">
                <div class="admin-user-head">
                    <div>
                        <h4 class="admin-user-name">${renderUserDisplayName(user, "", { showAvatar: true })}</h4>
                        <div class="admin-user-meta">
                            <span>${escapeHtml(user.contact || t("no_contact"))}</span>
                            <span>${escapeHtml(formatDateTime(user.created_at))}</span>
                            <span>${user.task_count} ${escapeHtml(user.task_count === 1 ? t("task_word") : t("tasks_word"))}</span>
                        </div>
                    </div>
                </div>
                <div class="form-actions">
                    ${canToggleAdmin ? `
                        <button
                            type="button"
                            class="${user.is_admin ? "ghost-btn" : "secondary-btn"} admin-toggle-role-btn"
                            data-user-id="${user.id}"
                            data-make-admin="${user.is_admin ? "false" : "true"}"
                        >
                            ${escapeHtml(roleButtonLabel)}
                        </button>
                    ` : ""}
                    <button
                        type="button"
                        class="${deleteDisabled ? "ghost-btn" : "danger-btn"} admin-delete-user-btn"
                        data-user-id="${user.id}"
                        ${deleteDisabled ? "disabled" : ""}
                    >
                        ${escapeHtml(deleteLabel)}
                    </button>
                </div>
            </article>
        `;
    }).join("");

    adminUsersList.querySelectorAll(".admin-delete-user-btn").forEach((button) => {
        if (button.disabled) {
            return;
        }

        button.addEventListener("click", async () => {
            const userId = Number(button.dataset.userId);
            const targetUser = adminUsersCache.find((user) => user.id === userId);
            if (!targetUser) {
                return;
            }

            const confirmed = confirm(`Delete user "${targetUser.username}"? This will also remove their related records.`);
            if (!confirmed) {
                return;
            }

            try {
                await fetchJSON(`/api/admin/users/${userId}`, { method: "DELETE" });
                await Promise.all([
                    loadAdminUsers(),
                    loadTasks(),
                    loadActivityFeed(),
                    loadAssignableUsers(),
                ]);
            } catch (error) {
                alert(error.message);
            }
        });
    });

    adminUsersList.querySelectorAll(".admin-toggle-role-btn").forEach((button) => {
        button.addEventListener("click", async () => {
            const userId = Number(button.dataset.userId);
            const makeAdmin = button.dataset.makeAdmin === "true";
            const targetUser = adminUsersCache.find((user) => user.id === userId);
            if (!targetUser) {
                return;
            }

            try {
                await fetchJSON(`/api/admin/users/${userId}/role`, {
                    method: "PATCH",
                    body: JSON.stringify({ is_admin: makeAdmin }),
                });
                await Promise.all([
                    loadAdminUsers(),
                    loadAssignableUsers(),
                    loadTasks(),
                    loadActivityFeed(),
                ]);
                const me = await fetchJSON("/api/auth/me");
                currentUser = me.user;
                updateWelcome();
            } catch (error) {
                alert(error.message);
            }
        });
    });
}

async function loadAdminUsers() {
    if (!currentUser?.is_admin) {
        adminUsersCache = [];
        renderAdminSummary();
        renderAdminUsers();
        return;
    }

    try {
        adminUsersCache = await fetchJSON("/api/admin/users");
        renderAdminSummary();
        renderAdminUsers();
    } catch (error) {
        if (adminSummary) {
            adminSummary.innerHTML = `<p class="auth-hint">${escapeHtml(error.message)}</p>`;
        }
        if (adminUsersList) {
            adminUsersList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
    }
}

function syncTaskMembersInput() {
    if (!taskMembersInput) {
        return;
    }
    taskMembersInput.value = selectedTaskMembers.join(", ");
}

function getVisibleAssignableUsers(filter = "") {
    const query = filter.trim().toLowerCase();
    return assignableUsers.filter((user) => !query || user.username.toLowerCase().includes(query));
}

function renderSelectedTaskMembers() {
    if (!selectedMembers) {
        return;
    }

    syncTaskMembersInput();

    if (!selectedTaskMembers.length) {
        selectedMembers.innerHTML = `<span class="empty-chip">${escapeHtml(t("only_you"))}</span>`;
        return;
    }

    selectedMembers.innerHTML = selectedTaskMembers.map((username) => `
        <span class="member-chip">
            ${renderUserDisplayName(username, "mini-badge", { showAvatar: true })}
            <button type="button" class="remove-member-btn" data-username="${escapeHtml(username)}" aria-label="${escapeHtml(`${t("remove_member")}: ${username}`)}">x</button>
        </span>
    `).join("");

    selectedMembers.querySelectorAll(".remove-member-btn").forEach((button) => {
        button.addEventListener("click", () => {
            selectedTaskMembers = selectedTaskMembers.filter((username) => username !== button.dataset.username);
            renderSelectedTaskMembers();
            renderAssignableUserList(assignUserSearch?.value || "");
        });
    });
}

function renderAssignableUserList(filter = "") {
    if (!assignUserList) {
        return;
    }

    const visibleUsers = getVisibleAssignableUsers(filter);

    if (!assignableUsers.length) {
        assignUserList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_users_available_yet"))}</div>`;
        return;
    }

    if (!visibleUsers.length) {
        assignUserList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_users_match_search"))}</div>`;
        return;
    }

    assignUserList.innerHTML = visibleUsers.map((user) => {
        const isCurrentUser = currentUser && user.username.toLowerCase() === currentUser.username.toLowerCase();
        const isSelected = selectedTaskMembers.includes(user.username);
        const helperLabel = isCurrentUser
            ? t("always_included")
            : isSelected
                ? t("assigned_label")
                : t("click_to_assign");

        return `
            <div class="assign-user-item ${isSelected || isCurrentUser ? "active" : ""}" data-username="${escapeHtml(user.username)}">
                <button
                    type="button"
                    class="assign-user-toggle"
                    data-username="${escapeHtml(user.username)}"
                    ${isCurrentUser ? "disabled" : ""}
                >
                    <span>${renderUserDisplayName(user, "mini-badge", { clickable: false, showAvatar: true })}</span>
                    <span>${escapeHtml(helperLabel)}</span>
                </button>
                <button
                    type="button"
                    class="ghost-btn assign-user-open-profile"
                    data-user-profile="${escapeHtml(user.username)}"
                    title="${escapeHtml(`${t("open_profile")}: ${user.username}`)}"
                >
                    ${escapeHtml(t("profile"))}
                </button>
            </div>
        `;
    }).join("");

    assignUserList.querySelectorAll(".assign-user-toggle").forEach((button) => {
        if (button.disabled) {
            return;
        }

        button.addEventListener("click", () => {
            const username = button.dataset.username;
            if (!username) {
                return;
            }

            if (selectedTaskMembers.includes(username)) {
                selectedTaskMembers = selectedTaskMembers.filter((item) => item !== username);
            } else {
                selectedTaskMembers = [...selectedTaskMembers, username].sort((a, b) => a.localeCompare(b));
            }

            renderSelectedTaskMembers();
            renderAssignableUserList(assignUserSearch?.value || "");
        });
    });
}

function resetTaskAssignmentSelection() {
    selectedTaskMembers = [];
    if (assignUserSearch) {
        assignUserSearch.value = "";
    }
    renderSelectedTaskMembers();
    renderAssignableUserList("");
}

async function loadAssignableUsers() {
    if (!currentUser) {
        assignableUsers = [];
        resetTaskAssignmentSelection();
        return;
    }

    try {
        const users = await fetchJSON("/api/users");
        assignableUsers = users
            .map((user) => ({
                username: String(user?.username || "").trim(),
                is_admin: Boolean(user?.is_admin),
                is_headadmin: Boolean(user?.is_headadmin),
            }))
            .filter((user) => user.username)
            .sort((a, b) => a.username.localeCompare(b.username));
    } catch (error) {
        assignableUsers = [];
        if (assignUserList && assignUsersModal && !assignUsersModal.classList.contains("hidden")) {
            assignUserList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
    }

    renderSelectedTaskMembers();
    renderAssignableUserList(assignUserSearch?.value || "");
    populateTaskFilterUsers();
    renderCompletedTaskUserSuggestions();
}

function formatTemplateDeadlineValue(offsetHours) {
    const hours = Number(offsetHours);
    if (!Number.isFinite(hours) || hours <= 0) {
        return "";
    }
    const date = new Date(Date.now() + hours * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSelectedTaskTemplate() {
    if (!selectedCreateTemplateId) {
        return null;
    }
    return taskTemplatesCache.find((template) => template.id === Number(selectedCreateTemplateId)) || null;
}

function resetTaskTemplateSelection() {
    selectedCreateTemplateId = null;
    if (taskTemplateSelect) {
        taskTemplateSelect.value = "";
    }
    renderTaskTemplatePreview();
}

function renderTaskTemplatePreview() {
    if (!taskTemplatePreview) {
        return;
    }
    const template = getSelectedTaskTemplate();
    if (!template) {
        taskTemplatePreview.classList.add("hidden");
        taskTemplatePreview.innerHTML = "";
        return;
    }

    const metaBits = [];
    if (template.default_priority) {
        metaBits.push(fillTemplate(t("template_applied_priority"), { value: t(template.default_priority) }));
    }
    if (template.default_deadline_offset_hours) {
        metaBits.push(fillTemplate(t("template_applied_deadline"), { count: template.default_deadline_offset_hours }));
    }

    const subtaskList = template.subtasks?.length
        ? template.subtasks.map((subtask) => `
            <li class="template-preview-subtask">${escapeHtml(subtask.title)}</li>
        `).join("")
        : `<div class="empty-state">${escapeHtml(t("no_template_subtasks"))}</div>`;

    taskTemplatePreview.classList.remove("hidden");
    taskTemplatePreview.innerHTML = `
        <div class="template-preview-head">
            <div>
                <h4>${escapeHtml(template.name)}</h4>
                <p>${escapeHtml(template.description || t("template_preview_desc"))}</p>
            </div>
            <span class="template-preview-count">${escapeHtml(fillTemplate(t("template_subtasks_count"), { count: template.subtasks?.length || 0 }))}</span>
        </div>
        ${metaBits.length ? `<div class="template-preview-meta">${metaBits.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        <p class="template-preview-note">${escapeHtml(t("template_created_task_note"))}</p>
        <ul class="template-preview-subtasks">${subtaskList}</ul>
    `;
}

function populateTaskTemplateSelect() {
    if (!taskTemplateSelect) {
        return;
    }
    const previous = selectedCreateTemplateId ? String(selectedCreateTemplateId) : "";
    const options = [
        `<option value="">${escapeHtml(t("start_from_scratch"))}</option>`,
        ...taskTemplatesCache.map((template) => `
            <option value="${template.id}">${escapeHtml(template.name)}</option>
        `),
    ];
    taskTemplateSelect.innerHTML = options.join("");
    taskTemplateSelect.value = taskTemplatesCache.some((template) => String(template.id) === previous) ? previous : "";
    selectedCreateTemplateId = taskTemplateSelect.value ? Number(taskTemplateSelect.value) : null;
    renderTaskTemplatePreview();
}

function applyTaskTemplateToCreator(template) {
    if (!template) {
        return;
    }
    const titleInput = taskForm?.elements.title;
    const descriptionInput = taskForm?.elements.description;
    const deadlineInput = taskForm?.elements.deadline;
    const priorityInput = taskForm?.elements.priority;

    if (titleInput && !String(titleInput.value || "").trim()) {
        titleInput.focus();
    }
    if (descriptionInput && !String(descriptionInput.value || "").trim() && template.description) {
        descriptionInput.value = template.description;
    }
    if (priorityInput && template.default_priority && (!priorityInput.value || priorityInput.value === "medium")) {
        priorityInput.value = template.default_priority;
    }
    if (deadlineInput && !String(deadlineInput.value || "").trim() && template.default_deadline_offset_hours) {
        deadlineInput.value = formatTemplateDeadlineValue(template.default_deadline_offset_hours);
    }
    initDatePickers();
}

function renderTaskTemplateEditorSubtasks() {
    if (!taskTemplateSubtasksList) {
        return;
    }
    if (!draftTaskTemplateSubtasks.length) {
        taskTemplateSubtasksList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_template_subtasks"))}</div>`;
        return;
    }
    taskTemplateSubtasksList.innerHTML = draftTaskTemplateSubtasks.map((subtask, index) => `
        <div class="template-subtask-item">
            <span>${escapeHtml(subtask.title)}</span>
            <button type="button" class="ghost-btn remove-template-subtask-btn" data-index="${index}">${escapeHtml(t("remove_image"))}</button>
        </div>
    `).join("");

    taskTemplateSubtasksList.querySelectorAll(".remove-template-subtask-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.index);
            if (!Number.isFinite(index)) {
                return;
            }
            draftTaskTemplateSubtasks = draftTaskTemplateSubtasks.filter((_, itemIndex) => itemIndex !== index);
            renderTaskTemplateEditorSubtasks();
        });
    });
}

function resetTaskTemplateEditor() {
    editingTaskTemplateId = null;
    draftTaskTemplateSubtasks = [];
    taskTemplateEditorForm?.reset();
    if (taskTemplateDefaultPriority) {
        taskTemplateDefaultPriority.value = "";
    }
    if (taskTemplateDeadlineOffsetInput) {
        taskTemplateDeadlineOffsetInput.value = "";
    }
    if (deleteTaskTemplateBtn) {
        deleteTaskTemplateBtn.classList.add("hidden");
    }
    if (taskTemplateEditorHeading) {
        taskTemplateEditorHeading.textContent = t("new_template");
    }
    renderTaskTemplateEditorSubtasks();
}

function fillTaskTemplateEditor(template) {
    if (!template) {
        resetTaskTemplateEditor();
        return;
    }
    editingTaskTemplateId = Number(template.id);
    if (taskTemplateNameInput) taskTemplateNameInput.value = template.name || "";
    if (taskTemplateDescriptionInput) taskTemplateDescriptionInput.value = template.description || "";
    if (taskTemplateDefaultPriority) taskTemplateDefaultPriority.value = template.default_priority || "";
    if (taskTemplateDeadlineOffsetInput) taskTemplateDeadlineOffsetInput.value = template.default_deadline_offset_hours || "";
    draftTaskTemplateSubtasks = (template.subtasks || []).map((subtask) => ({ title: subtask.title }));
    if (deleteTaskTemplateBtn) {
        deleteTaskTemplateBtn.classList.remove("hidden");
    }
    if (taskTemplateEditorHeading) {
        taskTemplateEditorHeading.textContent = template.name || t("task_template");
    }
    renderTaskTemplateEditorSubtasks();
}

function renderTaskTemplateList() {
    if (!taskTemplateList) {
        return;
    }
    if (!taskTemplatesCache.length) {
        taskTemplateList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_templates_saved"))}</div>`;
        return;
    }
    taskTemplateList.innerHTML = taskTemplatesCache.map((template) => `
        <button
            type="button"
            class="template-library-item ${editingTaskTemplateId === Number(template.id) ? "active" : ""}"
            data-template-id="${template.id}"
        >
            <strong>${escapeHtml(template.name)}</strong>
            <span>${escapeHtml(fillTemplate(t("template_subtasks_count"), { count: template.subtasks?.length || 0 }))}</span>
        </button>
    `).join("");

    taskTemplateList.querySelectorAll(".template-library-item").forEach((button) => {
        button.addEventListener("click", () => {
            const template = taskTemplatesCache.find((item) => item.id === Number(button.dataset.templateId));
            fillTaskTemplateEditor(template || null);
            renderTaskTemplateList();
        });
    });
}

async function loadTaskTemplates() {
    if (!currentUser) {
        taskTemplatesCache = [];
        resetTaskTemplateSelection();
        renderTaskTemplateList();
        return;
    }
    try {
        taskTemplatesCache = await fetchJSON("/api/task-templates");
    } catch (error) {
        console.error("[Task templates] failed to load:", error);
        taskTemplatesCache = [];
    }
    populateTaskTemplateSelect();
    renderTaskTemplateList();
}

function openTaskTemplateModal() {
    if (!taskTemplateModal) {
        return;
    }
    taskTemplateModal.classList.remove("hidden");
    renderTaskTemplateList();
    if (!editingTaskTemplateId) {
        resetTaskTemplateEditor();
    }
    taskTemplateNameInput?.focus();
}

function closeTaskTemplateModal() {
    taskTemplateModal?.classList.add("hidden");
}

function openAssignUsersModal() {
    if (!assignUsersModal) {
        return;
    }

    assignUsersModal.classList.remove("hidden");
    renderAssignableUserList(assignUserSearch?.value || "");
    if (assignUserSearch) {
        assignUserSearch.focus();
        assignUserSearch.select();
    }
}

function closeAssignUsersModal() {
    if (!assignUsersModal) {
        return;
    }
    assignUsersModal.classList.add("hidden");
}

function updateProfileVerificationUI() {
    return;
}

function destroyFlatpickrs() {
    flatpickrInstances.forEach((instance) => instance.destroy());
    flatpickrInstances = [];
}

function initDatePickers() {
    destroyFlatpickrs();

    if (typeof flatpickr === "undefined") {
        return;
    }

    document.querySelectorAll("#taskDeadline, #editTaskDeadline, [name='subtaskDeadline']").forEach((element) => {
        flatpickrInstances.push(
            flatpickr(element, {
                enableTime: true,
                time_24hr: true,
                dateFormat: "Y-m-d\\TH:i",
                allowInput: true,
            })
        );
    });
}

function updateWelcome() {
    if (!currentUser || !welcomeText || !dashboardWelcome) {
        return;
    }
    welcomeText.innerHTML = `${escapeHtml(t("welcome"))}, ${renderUserDisplayName(currentUser, "", { showAvatar: true })}`;
    dashboardWelcome.innerHTML = `${escapeHtml(t("welcome_back"))}, ${renderUserDisplayName(currentUser, "", { showAvatar: true })}`;
    renderProfileSummary();
    updateAdminUi();
}

function syncTaskPinState(card, task) {
    if (!card || !task) {
        return;
    }

    const pinTaskBtn = card.querySelector(".pin-task-btn");
    if (!pinTaskBtn) {
        return;
    }

    const pinned = getPinnedTaskId() === Number(task.id);
    pinTaskBtn.textContent = pinned ? t("unpin_task") : t("pin_task");
    pinTaskBtn.title = pinned ? t("clear_featured_task") : t("featured_task");
    pinTaskBtn.classList.toggle("active", pinned);
    pinTaskBtn.setAttribute("aria-pressed", String(pinned));
}

function syncFeaturedTaskActionState() {
    if (!clearPinnedTaskBtn) {
        return;
    }
    const pinned = Boolean(getPinnedTaskId());
    clearPinnedTaskBtn.textContent = pinned ? t("unpin_task") : t("clear_featured_task");
    clearPinnedTaskBtn.title = pinned ? t("clear_featured_task") : t("clear_featured_task");
    clearPinnedTaskBtn.setAttribute("aria-pressed", String(pinned));
}

function syncTaskChatPinState(card, task) {
    if (!card || !task) {
        return;
    }

    const pinChatBtn = card.querySelector(".pin-chat-btn");
    if (!pinChatBtn) {
        return;
    }

    const pinned = isPinnedChatTask(task.id);
    pinChatBtn.textContent = pinned ? t("unpin_chat") : t("pin_chat");
    pinChatBtn.title = pinned ? t("unpin_chat") : t("pin_chat");
    pinChatBtn.classList.toggle("active", pinned);
    pinChatBtn.setAttribute("aria-pressed", String(pinned));
}

async function refreshPinnedChatWindow(scrollToBottom = false) {
    if (!pinnedChatWindow || !pinnedChatMessages || pinnedChatWindow.dataset.chatLoading === "true") {
        return;
    }

    const pinnedState = getPinnedChatState();
    const taskId = Number(pinnedState?.taskId);
    if (!taskId) {
        return;
    }

    const wasInitialized = pinnedChatWindow.dataset.chatInitialized === "true";
    pinnedChatWindow.dataset.chatLoading = "true";
    pinnedChatWindow.dataset.taskId = String(taskId);
    try {
        const messages = await fetchJSON(`/api/tasks/${taskId}/messages`);
        renderTaskMessages(pinnedChatMessages, messages, { trackMentions: false });
        const mentionIdsNow = new Set(messages.filter((message) => message.mentions_current_user).map((message) => String(message.id)));
        mentionIdsNow.forEach((id) => {
            if (wasInitialized && !lastMentionAlertIds.has(id)) {
                playMentionSound();
            }
        });
        lastMentionAlertIds = new Set([...lastMentionAlertIds, ...mentionIdsNow]);
        pinnedChatWindow.dataset.chatInitialized = "true";
        if (scrollToBottom) {
            pinnedChatMessages.scrollTop = pinnedChatMessages.scrollHeight;
        }
    } catch (error) {
        pinnedChatMessages.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
        pinnedChatWindow.dataset.chatLoading = "false";
    }
}

function renderPinnedChatWindow() {
    if (!pinnedChatWindow || !pinnedChatTitle || !togglePinnedChatBtn || !closePinnedChatBtn) {
        return;
    }

    const pinnedState = getPinnedChatState();
    const pinnedTask = pinnedState ? tasksCache.find((task) => Number(task.id) === Number(pinnedState.taskId)) : null;

    if (!pinnedState || !pinnedTask) {
        if (pinnedState && !pinnedTask) {
            clearPinnedChat({ silent: true });
        }
        pinnedChatWindow.classList.add("hidden");
        return;
    }

    pinnedChatWindow.classList.remove("hidden");
    pinnedChatWindow.classList.toggle("minimized", Boolean(pinnedState.minimized));
    pinnedChatWindow.dataset.taskId = String(pinnedTask.id);
    pinnedChatTitle.textContent = `${t("task_chat")}: ${pinnedTask.title}`;
    togglePinnedChatBtn.textContent = pinnedState.minimized ? t("expand") : t("minimize");
    togglePinnedChatBtn.title = pinnedState.minimized ? t("expand") : t("minimize");
    closePinnedChatBtn.title = t("close");

    if (pinnedChatForm) {
        pinnedChatForm.querySelector("button[type='submit']").textContent = t("send");
    }
    if (pinnedChatInput) {
        pinnedChatInput.placeholder = t("write_message");
    }

    if (!pinnedState.minimized) {
        refreshPinnedChatWindow();
    }

    document.querySelectorAll(".task-card").forEach((card) => {
        const task = tasksCache.find((item) => item.id === Number(card.dataset.taskId));
        if (task) {
            syncTaskChatPinState(card, task);
        }
    });
}

function renderFeaturedTask() {
    if (!featuredTaskHost) {
        return;
    }

    const pinnedTaskId = getPinnedTaskId();
    const pinnedTask = pinnedTaskId ? tasksCache.find((task) => Number(task.id) === pinnedTaskId) : null;

    if (!pinnedTaskId || !pinnedTask) {
        if (pinnedTaskId && !pinnedTask) {
            clearPinnedTask({ silent: true });
        }
        featuredTaskHost.innerHTML = `<div class="empty-state">${escapeHtml(t("no_featured_task"))}</div>`;
        clearPinnedTaskBtn?.classList.add("hidden");
        syncFeaturedTaskActionState();
        return;
    }

    clearPinnedTaskBtn?.classList.remove("hidden");
    syncFeaturedTaskActionState();
    featuredTaskHost.innerHTML = "";
    const featuredCard = createTaskCard(pinnedTask, false);
    featuredCard.classList.add("featured-task-card");
    featuredTaskHost.appendChild(featuredCard);
}

function updateDashboard() {
    if (!statTasks || !statDueSoon || !statOverdue || !miniTaskCount || !ongoingMiniList || !deadlineMiniList) {
        return;
    }

    const buckets = getDashboardBuckets();
    const dueSoonCount = buckets.upcomingItems.length;
    const overdueCount = buckets.overdueItems.length;

    statTasks.textContent = String(tasksCache.length);
    statDueSoon.textContent = String(dueSoonCount);
    statOverdue.textContent = String(overdueCount);
    renderFeaturedTask();

    miniTaskCount.textContent = `${buckets.normalTasks.length} task${buckets.normalTasks.length === 1 ? "" : "s"}`;

    if (!tasksCache.length) {
        ongoingMiniList.innerHTML = `<div class="empty-state">${escapeHtml(t("currently_ongoing_tasks"))}</div>`;
        deadlineMiniList.innerHTML = `<div class="empty-state">${escapeHtml(t("upcoming_deadlines"))}</div>`;
        renderOverdue();
        return;
    }

    ongoingMiniList.innerHTML = buckets.normalTasks.length
        ? buckets.normalTasks.slice(0, 6).map((task) => `
            <div class="mini-task-item">
                <strong>${escapeHtml(task.title)}</strong>
                <span>${escapeHtml(formatDateTime(task.deadline))}</span>
            </div>
        `)
        .join("")
        : `<div class="empty-state">${escapeHtml(t("currently_ongoing_tasks"))}</div>`;

    deadlineMiniList.innerHTML = buckets.upcomingItems.length
        ? buckets.upcomingItems.slice(0, 6).map((item) => renderDeadlineMiniItem(item, "soon")).join("")
        : `<div class="empty-state">${escapeHtml(t("upcoming_deadlines"))}</div>`;

    renderOverdue(buckets.overdueItems);
}

function renderOverdue(overdueItems = null) {
    if (!overdueList) {
        return;
    }

    const overdue = overdueItems || getDashboardBuckets().overdueItems;

    overdueList.innerHTML = overdue.length
        ? overdue.slice(0, 6).map((item) => renderDeadlineMiniItem(item, "overdue")).join("")
        : `<div class="empty-state">${escapeHtml(t("overdue_tasks"))}</div>`;
}

function updateTaskCount() {
    if (!taskCountLabel) {
        return;
    }

    taskCountLabel.textContent = taskCountText(tasksCache.length);
}

function playCompleteSound() {
    if (!toggleSounds?.checked) {
        return;
    }

    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioContext.currentTime;

        const clickOsc = audioContext.createOscillator();
        const clickGain = audioContext.createGain();
        clickOsc.type = "triangle";
        clickOsc.frequency.setValueAtTime(520, now);
        clickOsc.frequency.exponentialRampToValueAtTime(360, now + 0.08);
        clickGain.gain.setValueAtTime(0.0001, now);
        clickGain.gain.exponentialRampToValueAtTime(0.035, now + 0.01);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        clickOsc.connect(clickGain);
        clickGain.connect(audioContext.destination);
        clickOsc.start(now);
        clickOsc.stop(now + 0.11);

        const chimeOsc = audioContext.createOscillator();
        const chimeGain = audioContext.createGain();
        chimeOsc.type = "sine";
        chimeOsc.frequency.setValueAtTime(660, now + 0.03);
        chimeOsc.frequency.exponentialRampToValueAtTime(880, now + 0.22);
        chimeGain.gain.setValueAtTime(0.0001, now + 0.03);
        chimeGain.gain.exponentialRampToValueAtTime(0.028, now + 0.06);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        chimeOsc.connect(chimeGain);
        chimeGain.connect(audioContext.destination);
        chimeOsc.start(now + 0.03);
        chimeOsc.stop(now + 0.32);
    } catch {
        // ignore audio failures
    }
}

function renderOverview() {
    if (!overviewGrid || !overviewCardTemplate) {
        return;
    }

    overviewGrid.innerHTML = "";

    if (!tasksCache.length) {
        overviewGrid.innerHTML = `<div class="empty-state">${escapeHtml(t("no_tasks_to_show"))}</div>`;
        return;
    }

    tasksCache.forEach((task) => {
        const node = overviewCardTemplate.content.cloneNode(true);
        const card = node.querySelector(".overview-card");

        card.querySelector(".overview-title").textContent = task.title;
        card.querySelector(".overview-deadline").textContent = `Deadline: ${formatDateTime(task.deadline)}`;

        const priorityEl = card.querySelector(".overview-priority");
        priorityEl.className = `priority-badge overview-priority priority-${formatPriority(task.priority)}`;
        priorityEl.textContent = formatPriority(task.priority);

        card.querySelector(".overview-members").innerHTML = `${escapeHtml(t("users_label"))} ${renderUserList(task.member_details || task.members)}`;
        card.querySelector(".overview-subtask-summary").textContent =
            `${task.completed_count}/${task.subtask_count} completed, ${task.remaining_count} left`;

        card.querySelector(".overview-progress-label").textContent = `${task.progress}%`;
        const fill = card.querySelector(".tiny-progress-fill");
        requestAnimationFrame(() => {
            fill.style.width = `${task.progress}%`;
        });

        overviewGrid.appendChild(card);
    });
}

function applySearchFilter() {
    if (!searchInput || !taskList) {
        return;
    }

    const filters = getTaskFilterState();
    const cards = [...taskList.querySelectorAll(".task-card")];
    const taskMap = new Map(tasksCache.map((task) => [Number(task.id), task]));

    const visibleCards = [];
    cards.forEach((card) => {
        const task = taskMap.get(Number(card.dataset.taskId));
        if (!task) {
            card.style.display = "none";
            return;
        }
        const matches = taskMatchesFilters(task, filters);
        card.style.display = matches ? "" : "none";
        if (matches) {
            visibleCards.push({ card, task });
        }
    });

    visibleCards
        .sort((a, b) => compareTasksForSort(a.task, b.task, filters.sortBy))
        .forEach(({ card }) => taskList.appendChild(card));

    if (filters.reverse) {
        visibleCards.reverse().forEach(({ card }) => taskList.appendChild(card));
    }

    if (taskCountLabel) {
        taskCountLabel.textContent = taskCountText(visibleCards.length);
    }
}

function renderEmptyTasks() {
    taskList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_tasks_yet_create_first"))}</div>`;
    if (taskCountLabel) {
        taskCountLabel.textContent = taskCountText(0);
    }
}

function getActivityTone(entry) {
    const action = String(entry?.action || "").toLowerCase();
    if (action.includes("deleted")) {
        return "danger";
    }
    if (action.includes("completed") || action.includes("confirmed completion") || action.includes("created")) {
        return "important success";
    }
    if (action.includes("added") || action.includes("joined")) {
        return "important";
    }
    return "";
}

function getActivityLabel(entry) {
    const action = String(entry?.action || "").toLowerCase();
    if (action.includes("deleted")) {
        return t("activity_label_alert");
    }
    if (action.includes("confirmed completion")) {
        return t("activity_label_done");
    }
    if (action.includes("completed")) {
        return t("activity_label_done");
    }
    if (action.includes("created")) {
        return t("activity_label_new");
    }
    if (action.includes("added") || action.includes("joined")) {
        return t("activity_label_team");
    }
    return "";
}

function renderActivityFeed() {
    if (!activityFeed) {
        return;
    }

    activityFeed.innerHTML = activityCache.length
        ? activityCache.map((entry) => `
            <div class="activity-item ${getActivityTone(entry)}">
                <p>${getActivityLabel(entry) ? `<span class="activity-label">${escapeHtml(getActivityLabel(entry))}</span>` : ""}${renderUserDisplayName(entry, "mini-badge", { showAvatar: true })} ${escapeHtml(entry.action)}</p>
                <span>${escapeHtml(formatDateTime(entry.timestamp))}</span>
            </div>
        `).join("")
        : `<div class="empty-state">${escapeHtml(t("no_recent_activity_yet"))}</div>`;
}

function prependActivity(entry) {
    activityCache = [entry, ...activityCache.filter((item) => item.id !== entry.id)].slice(0, 25);
    renderActivityFeed();
    if (activityFeed) {
        activityFeed.scrollTo({
            top: 0,
            behavior: document.body.classList.contains("no-animations") ? "auto" : "smooth",
        });
    }
}

function renderUpdateLog() {
    if (!updateLogList) {
        return;
    }

    const entries = getRenderableUpdateLogEntries();

    updateLogList.innerHTML = entries.length
        ? entries.map((entry) => `
            <div class="update-log-item">
                <div class="update-log-head">
                    <strong>v${escapeHtml(entry.version)}</strong>
                    <span>${escapeHtml(entry.date || formatDateTime(entry.timestamp))}</span>
                </div>
                <p>${escapeHtml(entry.description || "")}</p>
                ${(entry.highlights || []).length ? `
                    <ul class="update-log-points">
                        ${(entry.highlights || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
                    </ul>
                ` : ""}
            </div>
        `).join("")
        : `<div class="empty-state">${escapeHtml(t("no_updates_yet"))}</div>`;
}

function renderAnalyticsChart() {
    if (!analyticsChart || !analyticsChartSummary) {
        return;
    }

    const labels = analyticsCache?.series?.labels || [];
    const values = analyticsCache?.series?.values || [];

    if (!labels.length || !values.length || values.every((value) => value === 0)) {
        analyticsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("analytics_empty"))}</div>`;
        analyticsChartSummary.textContent = t("analytics_empty");
        return;
    }

    const maxValue = Math.max(...values, 1);
    const total = values.reduce((sum, value) => sum + value, 0);
    const chartType = analyticsChartTypeSelect?.value || "bar";

    analyticsChartSummary.textContent = `${total} ${t("analytics_completed_tasks").toLowerCase()}`;

    if (chartType === "line") {
        const width = 640;
        const height = 240;
        const padding = 24;
        const points = values.map((value, index) => {
            const x = padding + ((width - padding * 2) / Math.max(values.length - 1, 1)) * index;
            const y = height - padding - ((height - padding * 2) * (value / maxValue));
            return `${x},${y}`;
        }).join(" ");
        analyticsChart.innerHTML = `
            <div class="analytics-line-wrap">
                <svg class="analytics-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(t("analytics_completed_over_time"))}">
                    <polyline class="analytics-line-path" points="${points}"></polyline>
                    ${values.map((value, index) => {
                        const x = padding + ((width - padding * 2) / Math.max(values.length - 1, 1)) * index;
                        const y = height - padding - ((height - padding * 2) * (value / maxValue));
                        return `<circle class="analytics-line-point" cx="${x}" cy="${y}" r="5"></circle>`;
                    }).join("")}
                </svg>
                <div class="analytics-line-labels">
                    ${labels.map((label) => `<span class="analytics-bar-label">${escapeHtml(label)}</span>`).join("")}
                </div>
            </div>
        `;
        return;
    }

    if (chartType === "pie") {
        let offset = 0;
        const segments = values.map((value, index) => {
            const angle = (value / total) * 360;
            const start = offset;
            offset += angle;
            const color = `hsl(${(index * 57) % 360} 78% 60%)`;
            return { label: labels[index], value, color, start, end: offset };
        });
        analyticsChart.innerHTML = `
            <div class="analytics-pie-layout">
                <div class="analytics-pie-chart" style="background: conic-gradient(${segments.map((segment) => `${segment.color} ${segment.start}deg ${segment.end}deg`).join(", ")});"></div>
                <div class="analytics-pie-legend">
                    ${segments.map((segment) => `
                        <div class="analytics-pie-item">
                            <span class="analytics-pie-swatch" style="background:${segment.color}"></span>
                            <span class="analytics-pie-text">${escapeHtml(segment.label)}: ${segment.value}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
        return;
    }

    analyticsChart.innerHTML = `
        <div class="analytics-bars">
            ${values.map((value, index) => `
                <div class="analytics-bar-col">
                    <span class="analytics-bar-value">${value}</span>
                    <div class="analytics-bar-track">
                        <div class="analytics-bar-fill" style="height: ${(value / maxValue) * 100}%"></div>
                    </div>
                    <span class="analytics-bar-label">${escapeHtml(labels[index] || "")}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderAnalyticsMaterialsChart() {
    if (!analyticsMaterialsChart || !analyticsMaterialsSummary) {
        return;
    }

    const labels = analyticsCache?.materials_series?.labels || [];
    const materials = analyticsCache?.materials_series?.materials || [];
    const chartType = analyticsChartTypeSelect?.value || "bar";

    if (!labels.length || !materials.length || materials.every((item) => (item.values || []).every((value) => Number(value) === 0))) {
        analyticsMaterialsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("materials_chart_empty"))}</div>`;
        analyticsMaterialsSummary.textContent = t("materials_chart_empty");
        return;
    }

    const total = materials.reduce((sum, item) => sum + Number(item.total || 0), 0);
    analyticsMaterialsSummary.textContent = `${formatMaterialAmount(total)} ${t("materials_used_over_time").toLowerCase()}`;

    if (chartType === "pie") {
        let offset = 0;
        const segments = materials.map((material, index) => {
            const segmentTotal = Number(material.total || 0);
            const angle = total > 0 ? (segmentTotal / total) * 360 : 0;
            const start = offset;
            offset += angle;
            const color = `hsl(${(index * 57) % 360} 78% 60%)`;
            return {
                label: material.material_label || material.material_type || "",
                value: segmentTotal,
                color,
                start,
                end: offset,
            };
        });

        analyticsMaterialsChart.innerHTML = `
            <div class="analytics-pie-layout">
                <div class="analytics-pie-chart" style="background: conic-gradient(${segments.map((segment) => `${segment.color} ${segment.start}deg ${segment.end}deg`).join(", ")});"></div>
                <div class="analytics-pie-legend">
                    ${segments.map((segment) => `
                        <div class="analytics-pie-item">
                            <span class="analytics-pie-swatch" style="background:${segment.color}"></span>
                            <span class="analytics-pie-text">${escapeHtml(segment.label)}: ${escapeHtml(formatMaterialAmount(segment.value))}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
        return;
    }

    if (chartType === "line") {
        analyticsMaterialsChart.innerHTML = materials.map((material, materialIndex) => {
            const values = (material.values || []).map((value) => Number(value) || 0);
            const maxValue = Math.max(...values, 1);
            const width = 640;
            const height = 220;
            const padding = 24;
            const color = `hsl(${(materialIndex * 57) % 360} 78% 60%)`;
            const points = values.map((value, index) => {
                const x = padding + ((width - padding * 2) / Math.max(values.length - 1, 1)) * index;
                const y = height - padding - ((height - padding * 2) * (value / maxValue));
                return `${x},${y}`;
            }).join(" ");

            return `
                <div class="materials-chart-group">
                    <div class="materials-chart-head">
                        <strong>${escapeHtml(material.material_label || material.material_type || "")}</strong>
                        <span>${escapeHtml(formatMaterialAmount(material.total || 0))}</span>
                    </div>
                    <div class="analytics-line-wrap">
                        <svg class="analytics-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(material.material_label || material.material_type || "")}">
                            <polyline class="analytics-line-path" style="stroke:${color}" points="${points}"></polyline>
                            ${values.map((value, index) => {
                                const x = padding + ((width - padding * 2) / Math.max(values.length - 1, 1)) * index;
                                const y = height - padding - ((height - padding * 2) * (value / maxValue));
                                return `<circle class="analytics-line-point" style="fill:${color}" cx="${x}" cy="${y}" r="5"></circle>`;
                            }).join("")}
                        </svg>
                        <div class="analytics-line-labels">
                            ${labels.map((label) => `<span class="analytics-bar-label">${escapeHtml(label)}</span>`).join("")}
                        </div>
                    </div>
                </div>
            `;
        }).join("");
        return;
    }

    analyticsMaterialsChart.innerHTML = materials.map((material) => {
        const values = material.values || [];
        const maxValue = Math.max(...values.map((value) => Number(value) || 0), 1);
        return `
            <div class="materials-chart-group">
                <div class="materials-chart-head">
                    <strong>${escapeHtml(material.material_label || material.material_type || "")}</strong>
                    <span>${escapeHtml(formatMaterialAmount(material.total || 0))}</span>
                </div>
                <div class="analytics-bars materials-analytics-bars">
                    ${values.map((value, index) => `
                        <div class="analytics-bar-col">
                            <span class="analytics-bar-value">${escapeHtml(formatMaterialAmount(value || 0))}</span>
                            <div class="analytics-bar-track">
                                <div class="analytics-bar-fill" style="height: ${(Number(value || 0) / maxValue) * 100}%"></div>
                            </div>
                            <span class="analytics-bar-label">${escapeHtml(labels[index] || "")}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    }).join("");
}

function renderAnalytics() {
    if (!analyticsTotalUsers || !analyticsTotalTasks || !analyticsCompletedTasks || !analyticsOverdueTasks || !analyticsChart || !analyticsMaterialsChart) {
        return;
    }

    if (!currentUser?.is_admin) {
        analyticsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("admin_access_required"))}</div>`;
        analyticsMaterialsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("admin_access_required"))}</div>`;
        if (analyticsChartSummary) {
            analyticsChartSummary.textContent = t("admin_access_required");
        }
        if (analyticsMaterialsSummary) {
            analyticsMaterialsSummary.textContent = t("admin_access_required");
        }
        return;
    }

    if (!analyticsCache) {
        analyticsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("analytics_loading"))}</div>`;
        analyticsMaterialsChart.innerHTML = `<div class="empty-state">${escapeHtml(t("materials_chart_loading"))}</div>`;
        if (analyticsChartSummary) {
            analyticsChartSummary.textContent = t("analytics_loading");
        }
        if (analyticsMaterialsSummary) {
            analyticsMaterialsSummary.textContent = t("materials_chart_loading");
        }
        return;
    }

    analyticsTotalUsers.textContent = String(analyticsCache.totals?.total_users || 0);
    analyticsTotalTasks.textContent = String(analyticsCache.totals?.total_tasks || 0);
    analyticsCompletedTasks.textContent = String(analyticsCache.totals?.completed_tasks || 0);
    analyticsOverdueTasks.textContent = String(analyticsCache.totals?.overdue_tasks || 0);
    renderAnalyticsChart();
    renderAnalyticsMaterialsChart();
}

async function loadAnalytics() {
    if (!currentUser?.is_admin || !analyticsPeriodSelect) {
        analyticsCache = null;
        renderAnalytics();
        return;
    }

    try {
        const period = analyticsPeriodSelect.value || "1w";
        analyticsCache = await fetchJSON(`/api/admin/analytics?period=${encodeURIComponent(period)}`);
        renderAnalytics();
    } catch (error) {
        analyticsCache = null;
        if (analyticsChart) {
            analyticsChart.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
        if (analyticsMaterialsChart) {
            analyticsMaterialsChart.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
        if (analyticsChartSummary) {
            analyticsChartSummary.textContent = error.message;
        }
        if (analyticsMaterialsSummary) {
            analyticsMaterialsSummary.textContent = error.message;
        }
    }
}

function renderUserProfileChart() {
    if (!userDetailChart || !userDetailChartSummary) {
        return;
    }

    const labels = userProfileCache?.series?.labels || [];
    const values = userProfileCache?.series?.values || [];

    if (!labels.length || !values.length || values.every((value) => value === 0)) {
        userDetailChart.innerHTML = `<div class="empty-state">${escapeHtml(t("profile_chart_empty"))}</div>`;
        userDetailChartSummary.textContent = t("profile_chart_empty");
        return;
    }

    const maxValue = Math.max(...values, 1);
    const total = values.reduce((sum, value) => sum + value, 0);

    userDetailChartSummary.textContent = `${total} ${t("analytics_completed_tasks").toLowerCase()}`;
    userDetailChart.innerHTML = `
        <div class="analytics-bars">
            ${values.map((value, index) => `
                <div class="analytics-bar-col">
                    <span class="analytics-bar-value">${value}</span>
                    <div class="analytics-bar-track">
                        <div class="analytics-bar-fill" style="height: ${(value / maxValue) * 100}%"></div>
                    </div>
                    <span class="analytics-bar-label">${escapeHtml(labels[index] || "")}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderUserProfilePage() {
    if (!userDetailPage || !userDetailName || !userDetailChart || !userDetailChartSummary) {
        return;
    }

    if (!userProfileCache?.user) {
        userDetailName.textContent = t("user_profile");
        if (userDetailRole) {
            userDetailRole.innerHTML = "";
        }
        if (userDetailAvatar) {
        userDetailAvatar.src = getUserAvatarSrc({ username: "TM", profile_image_path: "" }, "TM");
        }
        if (userDetailJoined) {
            userDetailJoined.textContent = "-";
        }
        if (userDetailContact) {
            userDetailContact.textContent = t("profile_loading");
        }
        if (userDetailMessageBtn) {
            userDetailMessageBtn.disabled = true;
        }
        userDetailAssignedTasks.textContent = "0";
        userDetailCreatedTasks.textContent = "0";
        userDetailCompletedTasks.textContent = "0";
        userDetailOverdueTasks.textContent = "0";
        userDetailChart.innerHTML = `<div class="empty-state">${escapeHtml(t("profile_loading"))}</div>`;
        userDetailChartSummary.textContent = t("profile_loading");
        return;
    }

    const user = userProfileCache.user;
    const stats = userProfileCache.stats || {};
    userDetailName.textContent = user.username || t("user_profile");
    if (userDetailRole) {
        userDetailRole.innerHTML = renderRoleBadge(user);
    }
    if (userDetailAvatar) {
        userDetailAvatar.src = getUserAvatarSrc(user, user.username || "TM");
    }
    if (userDetailJoined) {
        userDetailJoined.textContent = formatDateTime(user.created_at);
    }
    if (userDetailContact) {
        userDetailContact.textContent = user.can_view_contact
            ? (user.contact || t("no_contact"))
            : t("hidden_contact");
    }
    if (userDetailMessageBtn) {
        userDetailMessageBtn.disabled = false;
        userDetailMessageBtn.classList.toggle("ghost-btn", normalizeUsernameKey(user.username) === normalizeUsernameKey(currentUser?.username));
        userDetailMessageBtn.classList.toggle("secondary-btn", normalizeUsernameKey(user.username) !== normalizeUsernameKey(currentUser?.username));
    }
    userDetailAssignedTasks.textContent = String(stats.assigned_tasks || 0);
    userDetailCreatedTasks.textContent = String(stats.created_tasks || 0);
    userDetailCompletedTasks.textContent = String(stats.completed_tasks || 0);
    userDetailOverdueTasks.textContent = String(stats.overdue_tasks || 0);
    renderUserProfileChart();
}

async function loadUserProfile(username, options = {}) {
    if (!username) {
        return;
    }

    const nextPeriod = options.keepPeriod
        ? (userDetailPeriodSelect?.value || "1w")
        : (options.period || userDetailPeriodSelect?.value || "1w");

    if (userDetailPeriodSelect) {
        userDetailPeriodSelect.value = nextPeriod;
    }

    userProfileCache = null;
    renderUserProfilePage();

    try {
        userProfileCache = await fetchJSON(`/api/users/${encodeURIComponent(username)}/profile?period=${encodeURIComponent(nextPeriod)}`);
        renderUserProfilePage();
        switchPage("userDetailPage");
    } catch (error) {
        userProfileCache = null;
        renderUserProfilePage();
        alert(error.message);
    }
}

function openUserProfile(username) {
    if (!username) {
        return;
    }

    const activePage = document.querySelector(".page.active")?.id || "dashboardPage";
    if (activePage !== "userDetailPage") {
        userProfileReturnPage = activePage;
    }
    loadUserProfile(username);
}

function updatePrivateMessageBadge() {
    if (!privateMessageBadge) {
        return;
    }
    if (!currentUser) {
        privateMessageBadge.classList.add("hidden");
        return;
    }
    const count = privateChatsCache.filter((chat) => chat.last_message && Number(chat.last_message.user_id) !== Number(currentUser.id)).length;
    privateMessageBadge.textContent = String(count);
    privateMessageBadge.classList.toggle("hidden", count <= 0);
}

function renderPrivateChatList() {
    if (!privateChatList) {
        return;
    }

    if (!privateChatsCache.length) {
        privateChatList.innerHTML = `<div class="empty-state">${escapeHtml(t("no_private_chats"))}</div>`;
        updatePrivateMessageBadge();
        return;
    }

    privateChatList.innerHTML = privateChatsCache.map((chat) => {
        const preview = chat.last_message?.content || t(chat.is_group ? "group_chat" : "direct_message");
        const badges = [
            `<span class="private-chat-badge ${chat.is_group ? "group" : ""}">${escapeHtml(t(chat.is_group ? "group_chat" : "direct_message"))}</span>`,
            ...(chat.other_members || []).slice(0, 3).map((member) => renderRoleBadge(member)),
        ].join("");
        return `
            <button type="button" class="private-chat-item ${Number(chat.id) === Number(activePrivateChatId) ? "active" : ""}" data-private-chat-id="${chat.id}">
                <div class="private-chat-item-head">
                    <strong class="private-chat-item-title">${escapeHtml(chat.display_name || chat.title || t("private_messages"))}</strong>
                    <span class="private-chat-item-time">${escapeHtml(chat.last_message ? formatDateTime(chat.last_message.timestamp) : formatDateTime(chat.created_at))}</span>
                </div>
                <p class="private-chat-item-preview">${escapeHtml(preview)}</p>
                <div class="private-chat-badges">${badges}</div>
            </button>
        `;
    }).join("");

    privateChatList.querySelectorAll("[data-private-chat-id]").forEach((button) => {
        button.addEventListener("click", () => {
            openPrivateChatConversation(Number(button.dataset.privateChatId));
        });
    });
    updatePrivateMessageBadge();
}

function renderPrivateChatPanel(messages = null) {
    if (!privateChatMessages || !privateChatTitleHeading || !privateChatTitleSubheading) {
        return;
    }

    const activeChat = privateChatsCache.find((chat) => Number(chat.id) === Number(activePrivateChatId));
    if (!activeChat) {
        privateChatTitleHeading.textContent = t("select_private_chat");
        privateChatTitleSubheading.textContent = t("select_private_chat_desc");
        privateChatMessages.innerHTML = `<div class="empty-state">${escapeHtml(t("no_private_chat_selected"))}</div>`;
        if (privateChatInput) {
            privateChatInput.value = "";
            privateChatInput.disabled = true;
        }
        if (privateChatForm?.querySelector("button")) {
            privateChatForm.querySelector("button").disabled = true;
        }
        return;
    }

    privateChatTitleHeading.textContent = activeChat.display_name || activeChat.title || t("private_messages");
    privateChatTitleSubheading.textContent = t(activeChat.is_group ? "group_chat" : "direct_message");
    if (privateChatInput) {
        privateChatInput.disabled = false;
    }
    if (privateChatForm?.querySelector("button")) {
        privateChatForm.querySelector("button").disabled = false;
    }
    if (Array.isArray(messages)) {
        renderTaskMessages(privateChatMessages, messages, { trackMentions: false });
        privateChatMessages.scrollTop = privateChatMessages.scrollHeight;
    }
}

async function loadPrivateChats(options = {}) {
    if (!currentUser) {
        privateChatsCache = [];
        activePrivateChatId = null;
        renderPrivateChatList();
        renderPrivateChatPanel();
        return;
    }

    try {
        const conversations = await fetchJSON("/api/private-chats");
        privateChatsCache = Array.isArray(conversations) ? conversations : [];
        if (options.openConversationId) {
            activePrivateChatId = Number(options.openConversationId);
        } else if (activePrivateChatId && !privateChatsCache.some((chat) => Number(chat.id) === Number(activePrivateChatId))) {
            activePrivateChatId = privateChatsCache[0]?.id || null;
        } else if (!activePrivateChatId && privateChatsCache[0]) {
            activePrivateChatId = privateChatsCache[0].id;
        }
        renderPrivateChatList();
        if (activePrivateChatId) {
            await loadPrivateChatMessages(activePrivateChatId);
        } else {
            renderPrivateChatPanel();
        }
    } catch (error) {
        if (privateChatList) {
            privateChatList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
        renderPrivateChatPanel();
    }
}

async function loadPrivateChatMessages(conversationId) {
    if (!conversationId) {
        renderPrivateChatPanel();
        return;
    }

    const messages = await fetchJSON(`/api/private-chats/${conversationId}/messages`);
    renderPrivateChatPanel(messages);
}

async function openPrivateChatConversation(conversationId) {
    activePrivateChatId = Number(conversationId);
    renderPrivateChatList();
    switchPage("privateMessagesPage");
    try {
        await loadPrivateChatMessages(activePrivateChatId);
    } catch (error) {
        if (privateChatMessages) {
            privateChatMessages.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
    }
}

function renderPrivateChatUserPicker() {
    if (!privateChatUserList) {
        return;
    }

    const query = (privateChatUserSearch?.value || "").trim().toLowerCase();
    const users = assignableUsers
        .filter((user) => Number(user.id) !== Number(currentUser?.id))
        .filter((user) => !query || String(user.username || "").toLowerCase().includes(query));

    if (!users.length) {
        privateChatUserList.innerHTML = `<div class="empty-state">${escapeHtml(query ? t("no_users_match_search") : t("no_users_available_yet"))}</div>`;
        return;
    }

    privateChatUserList.innerHTML = users.map((user) => `
        <article class="assign-user-item">
            <button type="button" class="assign-user-toggle" data-private-chat-username="${escapeHtml(user.username)}">
                <span>${renderUserDisplayName(user, "mini-badge", { showAvatar: true })}</span>
                <span class="auth-hint">${escapeHtml(t("message_user"))}</span>
            </button>
        </article>
    `).join("");

    privateChatUserList.querySelectorAll("[data-private-chat-username]").forEach((button) => {
        button.addEventListener("click", async () => {
            await openDirectChatWithUser(button.dataset.privateChatUsername || "");
        });
    });
}

function openStartPrivateChatModal() {
    if (!startPrivateChatModal) {
        return;
    }
    startPrivateChatModal.classList.remove("hidden");
    if (privateChatUserSearch) {
        privateChatUserSearch.value = "";
        privateChatUserSearch.focus();
    }
    renderPrivateChatUserPicker();
}

function closeStartPrivateChatModal() {
    startPrivateChatModal?.classList.add("hidden");
}

async function openDirectChatWithUser(username) {
    const normalizedUsername = String(username || "").trim();
    if (!normalizedUsername) {
        return;
    }
    if (normalizeUsernameKey(normalizedUsername) === normalizeUsernameKey(currentUser?.username)) {
        alert(t("cannot_message_self"));
        return;
    }

    try {
        const result = await fetchJSON("/api/private-chats/direct", {
            method: "POST",
            body: JSON.stringify({ username: normalizedUsername }),
        });
        const conversation = result?.conversation;
        if (conversation) {
            privateChatsCache = [conversation, ...privateChatsCache.filter((chat) => Number(chat.id) !== Number(conversation.id))];
            closeStartPrivateChatModal();
            await openPrivateChatConversation(conversation.id);
        }
    } catch (error) {
        alert(error.message);
    }
}

function getFrontendUpdateEntries() {
    return [
        {
            version: "1.19.4",
            date: "2026-04-15",
            description: t("update_tts_language_desc"),
            highlights: [
                t("update_tts_language_point_1"),
                t("update_tts_language_point_2"),
                t("update_tts_language_point_3"),
            ],
        },
        {
            version: "1.18.8",
            date: "2026-04-10",
            description: t("update_pin_labels_desc"),
            highlights: [
                t("update_pin_labels_point_1"),
                t("update_pin_labels_point_2"),
                t("update_pin_labels_point_3"),
            ],
        },
        {
            version: "1.18.7",
            date: "2026-04-09",
            description: t("update_templates_desc"),
            highlights: [
                t("update_templates_point_1"),
                t("update_templates_point_2"),
                t("update_templates_point_3"),
            ],
        },
        {
            version: "1.18.5",
            date: "2026-04-09",
            description: t("update_polish_language_desc"),
            highlights: [
                t("update_polish_language_point_1"),
                t("update_polish_language_point_2"),
                t("update_polish_language_point_3"),
            ],
        },
        {
            version: "1.18.4",
            date: "2026-04-09",
            description: t("update_translation_audit_desc"),
            highlights: [
                t("update_translation_audit_point_1"),
                t("update_translation_audit_point_2"),
                t("update_translation_audit_point_3"),
            ],
        },
        {
            version: "1.18.3",
            date: "2026-04-09",
            description: t("update_private_messages_desc"),
            highlights: [
                t("update_private_messages_point_1"),
                t("update_private_messages_point_2"),
                t("update_private_messages_point_3"),
            ],
        },
        {
            version: "1.18.2",
            date: "2026-04-08",
            description: t("update_materials_chart_modes_desc"),
            highlights: [
                t("update_materials_chart_modes_point_1"),
                t("update_materials_chart_modes_point_2"),
                t("update_materials_chart_modes_point_3"),
            ],
        },
        {
            version: "1.18.1",
            date: "2026-04-08",
            description: t("update_completed_tasks_desc"),
            highlights: [
                t("update_completed_tasks_point_1"),
                t("update_completed_tasks_point_2"),
                t("update_completed_tasks_point_3"),
            ],
        },
        {
            version: "1.18.0",
            date: "2026-04-08",
            description: t("update_materials_desc"),
            highlights: [
                t("update_materials_point_1"),
                t("update_materials_point_2"),
                t("update_materials_point_3"),
            ],
        },
        {
            version: "1.17.6",
            date: "2026-03-27",
            description: t("update_profile_images_desc"),
            highlights: [
                t("update_profile_images_point_1"),
                t("update_profile_images_point_2"),
                t("update_profile_images_point_3"),
            ],
        },
        {
            version: "1.17.5",
            date: "2026-03-27",
            description: t("update_tts_hints_desc"),
            highlights: [
                t("update_tts_hints_point_1"),
                t("update_tts_hints_point_2"),
                t("update_tts_hints_point_3"),
            ],
        },
        {
            version: "1.17.4",
            date: "2026-03-27",
            description: t("update_chat_avatars_desc"),
            highlights: [
                t("update_chat_avatars_point_1"),
                t("update_chat_avatars_point_2"),
                t("update_chat_avatars_point_3"),
            ],
        },
        {
            version: "1.17.3",
            date: "2026-03-27",
            description: t("update_task_creator_desc"),
            highlights: [
                t("update_task_creator_point_1"),
                t("update_task_creator_point_2"),
                t("update_task_creator_point_3"),
            ],
        },
        {
            version: "1.17.2",
            date: "2026-03-27",
            description: t("update_pinned_chat_desc"),
            highlights: [
                t("update_pinned_chat_point_1"),
                t("update_pinned_chat_point_2"),
                t("update_pinned_chat_point_3"),
            ],
        },
        {
            version: "1.17.1",
            date: "2026-03-27",
            description: t("update_accessibility_desc"),
            highlights: [
                t("update_accessibility_point_1"),
                t("update_accessibility_point_2"),
                t("update_accessibility_point_3"),
            ],
        },
        {
            version: "1.17.0",
            date: "2026-03-27",
            description: t("update_subtask_requirements_desc"),
            highlights: [
                t("update_subtask_requirements_point_1"),
                t("update_subtask_requirements_point_2"),
                t("update_subtask_requirements_point_3"),
            ],
        },
        {
            version: "1.16.9",
            date: "2026-03-27",
            description: t("update_task_attachments_desc"),
            highlights: [
                t("update_task_attachments_point_1"),
                t("update_task_attachments_point_2"),
                t("update_task_attachments_point_3"),
            ],
        },
        {
            version: "1.16.8",
            date: "2026-03-26",
            description: t("update_featured_task_desc"),
            highlights: [
                t("update_featured_task_point_1"),
                t("update_featured_task_point_2"),
                t("update_featured_task_point_3"),
            ],
        },
        {
            version: "1.16.7",
            date: "2026-03-26",
            description: t("update_ui_polish_desc"),
            highlights: [
                t("update_ui_polish_point_1"),
                t("update_ui_polish_point_2"),
                t("update_ui_polish_point_3"),
            ],
        },
        {
            version: "1.16.6",
            date: "2026-03-26",
            description: t("update_analytics_charts_desc"),
            highlights: [
                t("update_analytics_charts_point_1"),
                t("update_analytics_charts_point_2"),
                t("update_analytics_charts_point_3"),
            ],
        },
        {
            version: "1.16.5",
            date: "2026-03-26",
            description: t("task_filters_updated_desc"),
            highlights: [
                t("task_filters_updated_point_1"),
                t("task_filters_updated_point_2"),
                t("task_filters_updated_point_3"),
            ],
        },
        {
            version: "1.16.4",
            date: "2026-03-26",
            description: t("update_global_tasks_desc"),
            highlights: [
                t("update_global_tasks_point_1"),
                t("update_global_tasks_point_2"),
                t("update_global_tasks_point_3"),
            ],
        },
        {
            version: "1.16.3",
            date: "2026-03-26",
            description: t("update_task_images_desc"),
            highlights: [
                t("update_task_images_point_1"),
                t("update_task_images_point_2"),
                t("update_task_images_point_3"),
            ],
        },
        {
            version: "1.16.2",
            date: "2026-03-26",
            description: t("update_compact_columns_desc"),
            highlights: [
                t("update_compact_columns_point_1"),
                t("update_compact_columns_point_2"),
                t("update_compact_columns_point_3"),
            ],
        },
        {
            version: "1.16.1",
            date: "2026-03-26",
            description: t("update_profile_chart_fix_desc"),
            highlights: [
                t("update_profile_chart_fix_point_1"),
                t("update_profile_chart_fix_point_2"),
                t("update_profile_chart_fix_point_3"),
            ],
        },
        {
            version: "1.16.0",
            date: "2026-03-26",
            description: t("update_completion_confirm_desc"),
            highlights: [
                t("update_completion_confirm_point_1"),
                t("update_completion_confirm_point_2"),
                t("update_completion_confirm_point_3"),
            ],
        },
        {
            version: "1.15.0",
            date: "2026-03-25",
            description: "Added clickable user profile pages from user lists.",
            highlights: [
                "Added dedicated user detail pages with avatars, role badges, and task stats.",
                "Added per-user completed-task charts with selectable time ranges.",
                "Kept contact details permission-aware so admins and the owner can see them safely.",
            ],
        },
        {
            version: "1.13.1",
            date: "2026-03-25",
            description: t("update_language_flags_desc"),
            highlights: [
                t("update_language_flags_point_1"),
                t("update_language_flags_point_2"),
                t("update_language_flags_point_3"),
            ],
        },
        {
            version: "1.14.0",
            date: "2026-03-25",
            description: "Added an admin-only analytics dashboard.",
            highlights: [
                "Added admin-only workspace totals for users, tasks, completed tasks, and overdue tasks.",
                "Added completed-task trend charts with selectable time windows.",
                "Added a dedicated analytics page for admins and head admins.",
            ],
        },
        {
            version: "1.11.1",
            date: "2026-03-25",
            description: t("update_compact_refresh_desc"),
            highlights: [
                t("update_compact_refresh_point_1"),
                t("update_compact_refresh_point_2"),
                t("update_compact_refresh_point_3"),
            ],
        },
    ];
}

function getCompletedTaskSearchQuery() {
    return String(completedTaskUserSearch?.value || "").trim().toLowerCase();
}

function renderCompletedTaskUserSuggestions() {
    if (!completedTaskUserSuggestions) {
        return;
    }

    const usernames = [...new Set(
        (assignableUsers || [])
            .map((user) => String(user?.username || "").trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
    )];

    completedTaskUserSuggestions.innerHTML = usernames
        .map((username) => `<option value="${escapeHtml(username)}"></option>`)
        .join("");
}

function completedTaskMatchesSearch(entry, query) {
    if (!query) {
        return true;
    }

    const workedOnMatch = (entry.worked_on_users || []).some(
        (user) => normalizeUsernameKey(user?.username) === query
    );
    const completedByMatch = normalizeUsernameKey(entry.completed_by?.username) === query;
    return workedOnMatch || completedByMatch;
}

function fillCompletedTaskUserSearch(username) {
    if (!completedTaskUserSearch) {
        return;
    }
    completedTaskUserSearch.value = username || "";
}

function renderCompletedTasks() {
    if (!completedTaskList) {
        return;
    }

    const query = getCompletedTaskSearchQuery();
    const filtered = completedTasksCache.filter((entry) => completedTaskMatchesSearch(entry, query));

    if (completedTaskCount) {
        completedTaskCount.textContent = completedTaskCountText(filtered.length);
    }

    if (!filtered.length) {
        completedTaskList.innerHTML = `<div class="empty-state">${escapeHtml(query ? t("no_completed_tasks_for_user") : t("no_completed_tasks"))}</div>`;
        return;
    }

    completedTaskList.innerHTML = filtered.map((entry) => `
        <article class="completed-task-item">
            <div class="completed-task-head">
                <div>
                    <h3 class="completed-task-title">${escapeHtml(entry.title || "")}</h3>
                    <p class="completed-task-time">${escapeHtml(t("completed_on"))}: ${escapeHtml(formatDateTime(entry.completed_at))}</p>
                </div>
            </div>
            <div class="completed-task-meta">
                <div class="completed-user-group">
                    <span class="completed-user-label">${escapeHtml(t("worked_on_by"))}</span>
                    <div class="completed-user-list">
                        ${(entry.worked_on_users || []).length
                            ? (entry.worked_on_users || []).map((user) => `
                                <button
                                    type="button"
                                    class="completed-user-chip"
                                    data-completed-user="${escapeHtml(user.username || "")}"
                                    title="${escapeHtml(`${t("completed_search_heading")}: ${user.username || ""}`)}"
                                >
                                    ${renderUserAvatar(user, "completed-user-avatar")}
                                    <span class="completed-user-chip-text">${renderUserDisplayName(user, "mini-badge", { clickable: false })}</span>
                                </button>
                            `).join("")
                            : `<span class="muted-inline">${escapeHtml(t("unknown_user"))}</span>`}
                    </div>
                </div>
                <div class="completed-user-row">
                    <span class="completed-user-label">${escapeHtml(t("confirmed_by"))}</span>
                    ${entry.completed_by ? `
                        <button
                            type="button"
                            class="completed-user-chip"
                            data-completed-user="${escapeHtml(entry.completed_by.username || "")}"
                            title="${escapeHtml(`${t("completed_search_heading")}: ${entry.completed_by.username || ""}`)}"
                        >
                            ${renderUserAvatar(entry.completed_by, "completed-user-avatar")}
                            <span class="completed-user-chip-text">${renderUserDisplayName(entry.completed_by, "mini-badge", { clickable: false })}</span>
                        </button>
                    ` : `<span class="muted-inline">${escapeHtml(t("unknown_user"))}</span>`}
                </div>
            </div>
        </article>
    `).join("");
}

async function loadCompletedTasks() {
    try {
        const userQuery = getCompletedTaskSearchQuery();
        const queryString = userQuery ? `?user=${encodeURIComponent(userQuery)}` : "";
        completedTasksCache = await fetchJSON(`/api/completed-tasks${queryString}`);
        renderCompletedTasks();
    } catch (error) {
        completedTasksCache = [];
        if (completedTaskList) {
            completedTaskList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
        if (completedTaskCount) {
            completedTaskCount.textContent = completedTaskCountText(0);
        }
    }
}

function getRenderableUpdateLogEntries() {
    const seen = new Set();
    return [...getFrontendUpdateEntries(), ...updateLogCache].filter((entry) => {
        const key = `${entry.version}-${entry.date || entry.timestamp || ""}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).sort((left, right) => {
        const leftParts = String(left.version || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
        const rightParts = String(right.version || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
        const length = Math.max(leftParts.length, rightParts.length);
        for (let index = 0; index < length; index += 1) {
            const diff = (rightParts[index] || 0) - (leftParts[index] || 0);
            if (diff !== 0) {
                return diff;
            }
        }
        return String(right.date || right.timestamp || "").localeCompare(String(left.date || left.timestamp || ""));
    });
}

function removeTaskFromUi(taskId) {
    tasksCache = tasksCache.filter((task) => task.id !== taskId);
    setTaskCollapsed(taskId, false);
    if (getPinnedTaskId() === Number(taskId)) {
        clearPinnedTask({ silent: true });
    }
    if (isPinnedChatTask(taskId)) {
        clearPinnedChat({ silent: true });
    }
    if (pendingTaskCompletion?.id === Number(taskId)) {
        closeTaskCompletionModal();
    }
    const existing = taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (existing) {
        existing.remove();
    }
    if (!tasksCache.length) {
        renderEmptyTasks();
    }
    updateAllSecondaryViews();
}

function initSocketConnection() {
    if (!currentUser || typeof io === "undefined") {
        return;
    }

    if (socket) {
        return;
    }

    socket = io({ withCredentials: true });

    socket.on("task_created", (task) => {
        upsertTaskCard(task, true);
    });

    socket.on("task_updated", (task) => {
        applyTaskUpdateInPlace(task);
    });

    socket.on("subtask_updated", (task) => {
        applyTaskUpdateInPlace(task);
    });

    socket.on("task_deleted", ({ task_id: taskId }) => {
        removeTaskFromUi(Number(taskId));
    });

    socket.on("message_sent", ({ task_id: taskId, message }) => {
        const card = taskList.querySelector(`[data-task-id="${Number(taskId)}"]`);
        if (message.mentions_current_user && !lastMentionAlertIds.has(String(message.id))) {
            playMentionSound();
            lastMentionAlertIds.add(String(message.id));
        }

        if (card) {
            const chatList = card.querySelector(".task-chat-list");
            if (chatList && !chatList.querySelector(`[data-message-id="${message.id}"]`)) {
                appendTaskMessage(chatList, message, true, { trackMentions: true });
            }
        }

        if (isPinnedChatTask(taskId) && pinnedChatMessages && !pinnedChatMessages.querySelector(`[data-message-id="${message.id}"]`)) {
            appendTaskMessage(pinnedChatMessages, message, true, { trackMentions: false });
        }
    });

    socket.on("private_chat_upserted", (conversation) => {
        if (!conversation?.id) {
            return;
        }
        privateChatsCache = [conversation, ...privateChatsCache.filter((chat) => Number(chat.id) !== Number(conversation.id))];
        renderPrivateChatList();
        if (!activePrivateChatId) {
            activePrivateChatId = conversation.id;
            renderPrivateChatPanel();
        }
    });

    socket.on("private_message_sent", ({ conversation_id: conversationId, message, conversation }) => {
        if (conversation?.id) {
            privateChatsCache = [conversation, ...privateChatsCache.filter((chat) => Number(chat.id) !== Number(conversation.id))];
            renderPrivateChatList();
        }
        if (Number(activePrivateChatId) === Number(conversationId) && privateChatMessages && !privateChatMessages.querySelector(`[data-message-id="${message.id}"]`)) {
            appendTaskMessage(privateChatMessages, message, true, { trackMentions: false });
        }
        updatePrivateMessageBadge();
    });

    socket.on("activity_logged", (entry) => {
        prependActivity(entry);
        if (String(entry?.action || "").toLowerCase().includes("confirmed completion")) {
            loadCompletedTasks();
            if (currentUser?.is_admin) {
                loadAnalytics();
            }
            if (document.getElementById("userDetailPage")?.classList.contains("active") && userProfileCache?.user?.username) {
                loadUserProfile(userProfileCache.user.username, { keepPeriod: true });
            }
        }
    });
}

function disconnectSocket() {
    if (!socket) {
        return;
    }
    socket.disconnect();
    socket = null;
}

function getSeenMentionStorageKey() {
    return currentUser ? `tm_seen_mentions_${currentUser.id}` : "tm_seen_mentions";
}

function getCollapsedTaskStorageKey() {
    return currentUser ? `tm_collapsed_tasks_${currentUser.id}` : "tm_collapsed_tasks";
}

function getPinnedTaskStorageKey() {
    return currentUser ? `tm_pinned_task_${currentUser.id}` : "tm_pinned_task";
}

function getPinnedChatStorageKey() {
    return currentUser ? `tm_pinned_chat_${currentUser.id}` : "tm_pinned_chat";
}

function getPinnedTaskId() {
    const rawValue = localStorage.getItem(getPinnedTaskStorageKey());
    if (!rawValue) {
        return null;
    }
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function setPinnedTaskId(taskId) {
    if (!taskId) {
        localStorage.removeItem(getPinnedTaskStorageKey());
        return;
    }
    localStorage.setItem(getPinnedTaskStorageKey(), String(taskId));
}

function clearPinnedTask(options = {}) {
    const hadPinnedTask = Boolean(getPinnedTaskId());
    setPinnedTaskId(null);
    syncFeaturedTaskActionState();
    if (!options.silent && hadPinnedTask && featuredTaskHost) {
        renderFeaturedTask();
    }
    document.querySelectorAll(".task-card").forEach((card) => {
        const task = tasksCache.find((item) => item.id === Number(card.dataset.taskId));
        if (task) {
            syncTaskPinState(card, task);
        }
    });
}

function togglePinnedTask(taskId) {
    if (getPinnedTaskId() === Number(taskId)) {
        clearPinnedTask({ silent: true });
        return false;
    }
    setPinnedTaskId(taskId);
    syncFeaturedTaskActionState();
    return true;
}

function getPinnedChatState() {
    try {
        const raw = localStorage.getItem(getPinnedChatStorageKey());
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        const taskId = Number(parsed?.taskId);
        if (!Number.isFinite(taskId) || taskId <= 0) {
            return null;
        }
        return {
            taskId,
            minimized: Boolean(parsed?.minimized),
        };
    } catch {
        return null;
    }
}

function setPinnedChatState(taskId, minimized = false) {
    if (!taskId) {
        localStorage.removeItem(getPinnedChatStorageKey());
        return;
    }
    localStorage.setItem(getPinnedChatStorageKey(), JSON.stringify({
        taskId: Number(taskId),
        minimized: Boolean(minimized),
    }));
}

function updatePinnedChatState(patch = {}) {
    const currentState = getPinnedChatState();
    if (!currentState) {
        return;
    }
    setPinnedChatState(
        patch.taskId ?? currentState.taskId,
        patch.minimized ?? currentState.minimized
    );
}

function isPinnedChatTask(taskId) {
    return getPinnedChatState()?.taskId === Number(taskId);
}

function clearPinnedChat(options = {}) {
    const hadPinnedChat = Boolean(getPinnedChatState());
    setPinnedChatState(null);
    if (pinnedChatMessages) {
        pinnedChatMessages.innerHTML = "";
    }
    if (!options.silent && hadPinnedChat) {
        renderPinnedChatWindow();
    }
    document.querySelectorAll(".task-card").forEach((card) => {
        const task = tasksCache.find((item) => item.id === Number(card.dataset.taskId));
        if (task) {
            syncTaskChatPinState(card, task);
        }
    });
}

function togglePinnedChat(taskId) {
    if (isPinnedChatTask(taskId)) {
        clearPinnedChat({ silent: true });
        return false;
    }
    setPinnedChatState(taskId, false);
    return true;
}

function getCollapsedTaskIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(getCollapsedTaskStorageKey()) || "[]"));
    } catch {
        return new Set();
    }
}

function setCollapsedTaskIds(ids) {
    localStorage.setItem(getCollapsedTaskStorageKey(), JSON.stringify([...ids]));
}

function isTaskCollapsed(taskId) {
    return getCollapsedTaskIds().has(String(taskId));
}

function setTaskCollapsed(taskId, collapsed) {
    const ids = getCollapsedTaskIds();
    const key = String(taskId);

    if (collapsed) {
        ids.add(key);
    } else {
        ids.delete(key);
    }

    setCollapsedTaskIds(ids);
}

function toggleTaskCollapsed(taskId) {
    const nextState = !isTaskCollapsed(taskId);
    setTaskCollapsed(taskId, nextState);
    return nextState;
}

function applyTaskCollapsedState(card, taskId) {
    if (!card) {
        return;
    }

    const collapsed = isTaskCollapsed(taskId);
    card.classList.toggle("collapsed", collapsed);

    const collapseButton = card.querySelector(".collapse-btn");
    if (collapseButton) {
        collapseButton.title = collapsed ? "Open task" : "Close task";
        collapseButton.setAttribute("aria-expanded", String(!collapsed));
    }
}

function getSeenMentionIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(getSeenMentionStorageKey()) || "[]"));
    } catch {
        return new Set();
    }
}

function setSeenMentionIds(ids) {
    localStorage.setItem(getSeenMentionStorageKey(), JSON.stringify([...ids]));
}

function updateMentionBadge() {
    if (!mentionBadge || !currentUser) {
        return;
    }

    const seenIds = getSeenMentionIds();
    const activePage = document.querySelector(".page.active")?.id;
    const unseenMentionIds = [];

    document.querySelectorAll('.task-chat-item[data-message-id][data-track-mentions="true"]').forEach((node) => {
        const messageId = String(node.dataset.messageId);
        if (node.dataset.mentionsCurrentUser !== "true") {
            return;
        }
        if (activePage === "tasksPage") {
            seenIds.add(messageId);
            return;
        }
        if (!seenIds.has(messageId)) {
            unseenMentionIds.push(messageId);
        }
    });

    setSeenMentionIds(seenIds);
    mentionBadge.textContent = String(unseenMentionIds.length);
    mentionBadge.classList.toggle("hidden", unseenMentionIds.length === 0);
}

function playMentionSound() {
    if (!toggleSounds?.checked) {
        return;
    }

    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioContext.currentTime;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(740, now);
        osc.frequency.exponentialRampToValueAtTime(988, now + 0.18);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.025, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    } catch {
        // ignore audio failures
    }
}

function renderMentionedContent(message) {
    const mentions = Array.isArray(message.mentioned_usernames) ? message.mentioned_usernames : [];
    let html = escapeHtml(message.content);

    mentions.forEach((username) => {
        const escapedMention = escapeHtml(`@${username}`);
        const pattern = new RegExp(`(^|[^A-Za-z0-9_])(${escapedMention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^A-Za-z0-9_])`, "gi");
        html = html.replace(pattern, (_, prefix, mention) => `${prefix}<span class="chat-mention">${mention}</span>`);
    });

    return html;
}

function getChatAvatarMarkup(message) {
    const username = message?.username || currentUser?.username || "TM";
    const avatarSrc = getUserAvatarSrc(message, username);
    return `
        <img
            class="task-chat-avatar"
            src="${escapeHtml(avatarSrc)}"
            alt="${escapeHtml(username)}"
            loading="lazy"
        >
    `;
}

function renderTaskMessageMarkup(message, trackMentions = true) {
    return `
        <div class="task-chat-item ${message.mentions_current_user ? "mentioned-message" : ""}" data-message-id="${message.id}" data-mentions-current-user="${message.mentions_current_user ? "true" : "false"}" data-track-mentions="${trackMentions ? "true" : "false"}">
            ${getChatAvatarMarkup(message)}
            <div class="task-chat-main">
                <div class="task-chat-meta">
                    ${renderUserDisplayName(message, "mini-badge", { showAvatar: false })}
                    <span>${escapeHtml(formatDateTime(message.timestamp))}</span>
                </div>
                <p class="task-chat-content">${renderMentionedContent(message)}</p>
            </div>
        </div>
    `;
}

