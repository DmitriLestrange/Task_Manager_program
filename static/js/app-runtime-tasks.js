function renderTaskMessages(container, messages, options = {}) {
    const trackMentions = options.trackMentions !== false;
    container.innerHTML = messages.length
        ? messages.map((message) => renderTaskMessageMarkup(message, trackMentions)).join("")
        : `<div class="empty-state">${escapeHtml(t("no_messages_yet"))}</div>`;
}

function appendTaskMessage(container, message, scrollToBottom = true, options = {}) {
    if (!container) {
        return;
    }
    const trackMentions = options.trackMentions !== false;

    const emptyState = container.querySelector(".empty-state");
    if (emptyState) {
        emptyState.remove();
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderTaskMessageMarkup(message, trackMentions);

    container.appendChild(wrapper.firstElementChild);
    updateMentionBadge();

    if (scrollToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

async function refreshTaskChatCard(card, scrollToBottom = false) {
    if (!card || card.dataset.chatLoading === "true") {
        return;
    }

    const taskId = Number(card.dataset.taskId);
    if (!taskId) {
        return;
    }

    const chatList = card.querySelector(".task-chat-list");
    if (!chatList) {
        return;
    }

    const wasInitialized = card.dataset.chatInitialized === "true";
    card.dataset.chatLoading = "true";
    try {
        const messages = await fetchJSON(`/api/tasks/${taskId}/messages`);
        renderTaskMessages(chatList, messages, { trackMentions: true });
        const mentionIdsNow = new Set(messages.filter((message) => message.mentions_current_user).map((message) => String(message.id)));
        mentionIdsNow.forEach((id) => {
            if (wasInitialized && !lastMentionAlertIds.has(id)) {
                playMentionSound();
            }
        });
        lastMentionAlertIds = new Set([...lastMentionAlertIds, ...mentionIdsNow]);
        card.dataset.chatInitialized = "true";
        updateMentionBadge();
        if (scrollToBottom) {
            chatList.scrollTop = chatList.scrollHeight;
        }
    } catch (error) {
        chatList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
        card.dataset.chatLoading = "false";
    }
}

function createSubtaskItem(subtask, taskId) {
    const li = document.createElement("li");
    li.className = "subtask-item";
    li.draggable = true;
    li.dataset.subtaskId = String(subtask.id);

    const materialRequirement = getTaskMaterialRequirement(subtask);
    li.innerHTML = `
        <div class="subtask-left">
            <span class="drag-handle" title="Drag to reorder">☰</span>

            <label class="custom-check">
                <input type="checkbox" class="subtask-checkbox" ${subtask.completed ? "checked" : ""}>
                <span class="checkmark"></span>
            </label>

            <div class="subtask-content">
                <span class="subtask-title ${subtask.completed ? "done" : ""}">${escapeHtml(subtask.title)}</span>
                <div class="subtask-meta">
                    ${createPriorityBadge(subtask.priority)}
                    <span class="${isOverdue(subtask.deadline) ? "overdue" : isDueSoon(subtask.deadline) ? "soon" : ""}">
                        ${escapeHtml(formatDateTime(subtask.deadline))}
                    </span>
                    <span class="${isOverdue(subtask.deadline) ? "overdue" : isDueSoon(subtask.deadline) ? "soon" : ""}">
                        ${escapeHtml(getCountdownText(subtask.deadline))}
                    </span>
                    ${subtask.requirement_type ? `<span class="${subtask.requirement_satisfied ? "" : "overdue"}">${escapeHtml(
                        subtask.requirement_type === "materials"
                            ? `${t("materials_needed")}: ${materialRequirement ? `${materialRequirement.material_label} · ${formatMaterialAmount(materialRequirement.amount)}` : t("blocked_until_materials")}`
                            : (subtask.requirement_satisfied ? t("file_submission_required") : t("blocked_until_requirement"))
                    )}</span>` : ""}
                </div>
                ${renderSubtaskRequirementPanel(subtask)}
            </div>
        </div>

        <div class="subtask-actions">
            <button type="button" class="ghost-btn edit-subtask-btn">Edit</button>
            <button type="button" class="danger-btn delete-subtask-btn">Delete</button>
        </div>
    `;

    li.querySelector(".subtask-checkbox").addEventListener("change", async (event) => {
        if (event.target.checked && subtask.requirement_type && !subtask.requirement_satisfied) {
            event.target.checked = false;
            alert(subtask.requirement_type === "materials" ? t("blocked_until_materials") : t("blocked_until_requirement"));
            return;
        }
        try {
            const updatedTask = await fetchJSON(`/api/subtasks/${subtask.id}`, {
                method: "PATCH",
                body: JSON.stringify({ completed: event.target.checked }),
            });

            if (event.target.checked) {
                playCompleteSound();
            }

            applyTaskUpdateInPlace(updatedTask);
            if (event.target.checked && Number(updatedTask.progress) >= 100 && Number(updatedTask.subtask_count || 0) > 0) {
                openTaskCompletionModal(updatedTask);
            }
        } catch (error) {
            alert(error.message);
            event.target.checked = !event.target.checked;
        }
    });

    li.querySelector(".delete-subtask-btn").addEventListener("click", async () => {
        try {
            const updatedTask = await fetchJSON(`/api/subtasks/${subtask.id}`, { method: "DELETE" });
            applyTaskUpdateInPlace(updatedTask);
        } catch (error) {
            alert(error.message);
        }
    });

    li.querySelector(".edit-subtask-btn").addEventListener("click", async () => {
        const newTitle = prompt(t("edit_subtask_title_prompt"), subtask.title);
        if (newTitle === null) {
            return;
        }

        const newDeadline = prompt(
            t("edit_subtask_deadline_prompt"),
            subtask.deadline || ""
        );
        if (newDeadline === null) {
            return;
        }

        const newPriority = prompt(t("edit_subtask_priority_prompt"), subtask.priority || "medium");
        if (newPriority === null) {
            return;
        }

        const newRequirementType = prompt(t("edit_subtask_requirement_prompt"), subtask.requirement_type || "");
        if (newRequirementType === null) {
            return;
        }

        let requirementConfig = subtask.requirement_config || "";
        if (newRequirementType.trim().toLowerCase() === "materials") {
            const currentRequirement = getTaskMaterialRequirement(subtask);
            const newMaterialType = prompt(t("material_type_prompt"), currentRequirement?.material_label || "");
            if (newMaterialType === null) {
                return;
            }
            const newMaterialAmount = prompt(t("amount_needed_prompt"), currentRequirement ? String(currentRequirement.amount || "") : "");
            if (newMaterialAmount === null) {
                return;
            }
            requirementConfig = {
                material_type: slugifyMaterialType(newMaterialType),
                material_label: newMaterialType.trim(),
                amount: newMaterialAmount.trim(),
            };
        }

        try {
            const updatedTask = await fetchJSON(`/api/subtasks/${subtask.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    title: newTitle.trim(),
                    deadline: newDeadline.trim(),
                    priority: newPriority.trim().toLowerCase(),
                    requirement_type: newRequirementType.trim().toLowerCase(),
                    requirement_config: requirementConfig,
                    completed: subtask.completed,
                }),
            });
            applyTaskUpdateInPlace(updatedTask);
        } catch (error) {
            alert(error.message);
        }
    });

    li.querySelector(".subtask-requirement-input")?.addEventListener("change", async (event) => {
        const [file] = event.target.files || [];
        if (!file) {
            return;
        }
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const updatedTask = await fetchJSON(`/api/subtasks/${subtask.id}/requirement-submission`, {
                method: "POST",
                body: JSON.stringify({
                    name: file.name || "file",
                    size: Number(file.size) || 0,
                    type: file.type || "application/octet-stream",
                    data_url: dataUrl,
                }),
            });
            applyTaskUpdateInPlace(updatedTask);
        } catch (error) {
            alert(error.message);
        } finally {
            event.target.value = "";
        }
    });

    li.addEventListener("dragstart", () => {
        li.classList.add("dragging");
    });

    li.addEventListener("dragend", async () => {
        li.classList.remove("dragging");
        await saveSubtaskOrder(taskId);
    });

    const parentTask = tasksCache.find((task) => task.id === taskId);
    const canEdit = canCurrentUserEditTask(parentTask);
    if (!canEdit) {
        li.draggable = false;
        li.querySelector(".subtask-checkbox").disabled = true;
        li.querySelector(".edit-subtask-btn").classList.add("hidden");
        li.querySelector(".delete-subtask-btn").classList.add("hidden");
        li.querySelector(".submit-requirement-btn")?.classList.add("hidden");
        const dragHandle = li.querySelector(".drag-handle");
        if (dragHandle) {
            dragHandle.classList.add("hidden");
        }
    }

    if (subtask.requirement_type && !subtask.requirement_satisfied && !subtask.completed) {
        li.querySelector(".subtask-checkbox").disabled = true;
    }

    return li;
}

function syncTaskCardImages(card, task) {
    if (!card || !task) {
        return;
    }

    const banner = card.querySelector(".task-banner");
    const mainImageWrap = card.querySelector(".task-main-image-wrap");
    const mainImage = card.querySelector(".task-main-image");

    if (banner) {
        const bannerPath = task.banner_image_path || "";
        banner.style.backgroundImage = bannerPath ? `url("${bannerPath.replace(/"/g, '\\"')}")` : "";
        banner.classList.toggle("hidden", !bannerPath);
    }

    if (mainImageWrap && mainImage) {
        const mainPath = task.main_image_path || "";
        mainImage.src = mainPath;
        mainImage.alt = task.title || t("task_image_preview");
        mainImageWrap.classList.toggle("hidden", !mainPath);
    }
}

function syncTaskCardAttachments(card, task) {
    if (!card || !task) {
        return;
    }

    const attachmentsList = card.querySelector(".task-attachments-list");
    if (!attachmentsList) {
        return;
    }

    renderTaskAttachments(attachmentsList, task.attachments || []);
}

function syncTaskInteractionPermissions(card, task) {
    if (!card || !task) {
        return;
    }

    const canEdit = canCurrentUserEditTask(task);
    const canDelete = canCurrentUserDeleteTask(task);
    const editTaskBtn = card.querySelector(".edit-task-btn");
    const deleteTaskBtn = card.querySelector(".delete-task-btn");
    const subtaskForm = card.querySelector(".subtask-form");
    const lockedNote = card.querySelector(".task-edit-lock-note");

    if (editTaskBtn) {
        editTaskBtn.disabled = !canEdit;
        editTaskBtn.classList.toggle("hidden", !canEdit);
    }
    if (deleteTaskBtn) {
        deleteTaskBtn.disabled = !canDelete;
        deleteTaskBtn.classList.toggle("hidden", !canDelete);
    }
    if (subtaskForm) {
        subtaskForm.classList.toggle("hidden", !canEdit);
    }
    if (lockedNote) {
        const showLocked = Boolean(task.is_global) && !canEdit;
        lockedNote.textContent = t("global_edit_locked_note");
        lockedNote.classList.toggle("hidden", !showLocked);
    }
}

function createTaskCard(task, animate = true) {
    const node = taskTemplate.content.cloneNode(true);
    const card = node.querySelector(".task-card");
    card.dataset.taskId = String(task.id);

    if (!animate || document.body.classList.contains("no-animations")) {
        card.style.animation = "none";
    }

    applyTaskCollapsedState(card, task.id);

    card.querySelector(".task-title").textContent = task.title;
    card.querySelector(".task-description").textContent = task.description || t("no_description_provided");
    syncTaskCardImages(card, task);
    syncTaskCardAttachments(card, task);
    syncTaskCardMaterials(card, task);

    const priorityBadge = card.querySelector(".priority-badge");
    priorityBadge.className = `priority-badge priority-${formatPriority(task.priority)}`;
    priorityBadge.textContent = formatPriority(task.priority);

    const scopeBadge = card.querySelector(".task-scope-badge");
    const permissionBadge = card.querySelector(".task-permission-badge");
    if (scopeBadge) {
        scopeBadge.textContent = t("global_badge");
        scopeBadge.classList.toggle("hidden", !task.is_global);
    }
    if (permissionBadge) {
        permissionBadge.textContent = getTaskPermissionBadgeText(task);
        permissionBadge.classList.toggle("hidden", !task.is_global);
    }
    syncTaskPinState(card, task);

    card.querySelector(".deadline-label").textContent = `Deadline: ${formatDateTime(task.deadline)}`;
    const countdownLabel = card.querySelector(".countdown-label");
    countdownLabel.textContent = getCountdownText(task.deadline);
    countdownLabel.className = `countdown-label ${isOverdue(task.deadline) ? "overdue" : isDueSoon(task.deadline) ? "soon" : ""}`;

    card.querySelector(".members-label").innerHTML = `${escapeHtml(t("users_label"))} ${renderUserList(task.member_details || task.members)}`;
    if (task.is_global) {
        card.querySelector(".members-label").insertAdjacentHTML("beforeend", ` <span class="task-global-visibility">${escapeHtml(t("global_visible_label"))}</span>`);
    }
    card.querySelector(".progress-label").textContent = `${task.progress}%`;

    const fill = card.querySelector(".progress-fill");
    fill.style.width = `${task.progress}%`;
    updateTaskCompletionReadyState(card, task);
    const attachmentsHeading = card.querySelector(".attachment-block .subtask-head h4");
    if (attachmentsHeading) {
        attachmentsHeading.textContent = t("attachments");
    }
    const chatHeading = card.querySelector(".chat-block .subtask-head h4");
    if (chatHeading) {
        chatHeading.textContent = t("task_chat");
    }
    syncTaskChatPinState(card, task);

    card.querySelector(".collapse-btn").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTaskCollapsed(task.id);
        applyTaskCollapsedState(card, task.id);
    });

    const editTaskBtn = card.querySelector(".edit-task-btn");
    const pinTaskBtn = card.querySelector(".pin-task-btn");
    if (pinTaskBtn) {
        pinTaskBtn.addEventListener("click", () => {
            togglePinnedTask(task.id);
            updateAllSecondaryViews();
        });
    }
    if (editTaskBtn) {
        editTaskBtn.textContent = t("edit_task");
        editTaskBtn.addEventListener("click", () => {
            const latestTask = tasksCache.find((item) => item.id === task.id) || task;
            openEditTaskModal(latestTask);
        });
    }

    card.querySelector(".delete-task-btn").addEventListener("click", async () => {
        const confirmed = confirm(`${t("delete")} "${task.title}"?`);
        if (!confirmed) {
            return;
        }

        try {
            await fetchJSON(`/api/tasks/${task.id}`, { method: "DELETE" });
            removeTaskFromUi(task.id);
        } catch (error) {
            alert(error.message);
        }
    });

    card.querySelector(".confirm-task-btn")?.addEventListener("click", () => {
        const latestTask = tasksCache.find((item) => item.id === task.id) || task;
        openTaskCompletionModal(latestTask);
    });

    const subtaskList = card.querySelector(".subtask-list");
    if (!task.subtasks.length) {
        subtaskList.innerHTML = `<li class="empty-state">${escapeHtml(t("no_subtasks_yet"))}</li>`;
    } else {
        task.subtasks.forEach((subtask) => {
            subtaskList.appendChild(createSubtaskItem(subtask, task.id));
        });
    }

    subtaskList.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = subtaskList.querySelector(".dragging");
        if (!dragging) {
            return;
        }

        const siblings = [...subtaskList.querySelectorAll(".subtask-item:not(.dragging)")];
        const nextSibling = siblings.find((sibling) => {
            const box = sibling.getBoundingClientRect();
            return event.clientY <= box.top + box.height / 2;
        });

        if (nextSibling) {
            subtaskList.insertBefore(dragging, nextSibling);
        } else {
            subtaskList.appendChild(dragging);
        }
    });

    const subtaskForm = card.querySelector(".subtask-form");
    if (!subtaskForm) {
        return card;
    }
    subtaskForm.elements.subtaskTitle.placeholder = t("task_title");
    subtaskForm.elements.subtaskDeadline.placeholder = t("deadline");
    subtaskForm.elements.subtaskPriority.options[0].textContent = t("low");
    subtaskForm.elements.subtaskPriority.options[1].textContent = t("medium");
    subtaskForm.elements.subtaskPriority.options[2].textContent = t("high");
    subtaskForm.elements.subtaskRequirementType.options[0].textContent = t("no_requirement");
    subtaskForm.elements.subtaskRequirementType.options[1].textContent = t("file_submission_required");
    subtaskForm.elements.subtaskRequirementType.options[2].textContent = t("materials_needed");
    subtaskForm.elements.subtaskMaterialType.placeholder = t("material_type_placeholder");
    subtaskForm.elements.subtaskMaterialAmount.placeholder = t("material_amount_placeholder");
    subtaskForm.querySelector("button[type='submit']").textContent = t("add_task");
    subtaskForm.elements.subtaskRequirementType.addEventListener("change", () => {
        const latestTask = tasksCache.find((item) => item.id === task.id) || task;
        syncSubtaskMaterialFields(subtaskForm, latestTask);
    });
    syncSubtaskMaterialFields(subtaskForm, task);
    subtaskForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const title = subtaskForm.elements.subtaskTitle.value.trim();
        const deadline = subtaskForm.elements.subtaskDeadline.value.trim();
        const priority = subtaskForm.elements.subtaskPriority.value;
        const requirementType = subtaskForm.elements.subtaskRequirementType.value;
        const materialType = subtaskForm.elements.subtaskMaterialType.value.trim();
        const materialAmount = subtaskForm.elements.subtaskMaterialAmount.value.trim();

        if (!title) {
            return;
        }

        let requirementConfig = "";
        if (requirementType === "materials") {
            if (!materialType || !materialAmount) {
                alert(t("blocked_until_materials"));
                return;
            }
            requirementConfig = {
                material_type: slugifyMaterialType(materialType),
                material_label: materialType,
                amount: materialAmount,
            };
        }

        try {
            const updatedTask = await fetchJSON(`/api/tasks/${task.id}/subtasks`, {
                method: "POST",
                body: JSON.stringify({ title, deadline, priority, requirement_type: requirementType, requirement_config: requirementConfig }),
            });

            applyTaskUpdateInPlace(updatedTask);
            subtaskForm.reset();
            syncSubtaskMaterialFields(subtaskForm, updatedTask);
        } catch (error) {
            alert(error.message);
        }
    });

    const chatForm = card.querySelector(".task-chat-form");
    const pinChatBtn = card.querySelector(".pin-chat-btn");
    if (pinChatBtn) {
        pinChatBtn.addEventListener("click", () => {
            togglePinnedChat(task.id);
            renderPinnedChatWindow();
        });
    }
    chatForm.elements.messageContent.placeholder = t("write_message");
    chatForm.querySelector("button[type='submit']").textContent = t("send");
    chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const content = chatForm.elements.messageContent.value.trim();
        if (!content) {
            return;
        }

        try {
            await fetchJSON(`/api/tasks/${task.id}/messages`, {
                method: "POST",
                body: JSON.stringify({ content }),
            });
            chatForm.reset();
        } catch (error) {
            alert(error.message);
        }
    });

    refreshTaskChatCard(card);
    syncTaskInteractionPermissions(card, task);

    return card;
}

function updateProgressBarSmooth(card, progress) {
    const label = card.querySelector(".progress-label");
    const fill = card.querySelector(".progress-fill");

    if (label) {
        label.textContent = `${progress}%`;
    }

    if (fill) {
        requestAnimationFrame(() => {
            fill.style.width = `${progress}%`;
        });
    }
}

function syncTaskCardMaterials(card, task) {
    const materialsBlock = card.querySelector(".task-materials-block");
    const materialsList = card.querySelector(".task-materials-list");
    const heading = materialsBlock?.querySelector(".subtask-head h4");
    if (heading) {
        heading.textContent = t("task_materials");
    }
    if (!materialsBlock || !materialsList) {
        return;
    }
    const materials = getTaskMaterials(task);
    materialsBlock.classList.toggle("hidden", !materials.length);
    renderTaskMaterials(materialsList, materials);
}

function syncTaskCardMeta(card, task) {
    if (!card || !task) {
        return;
    }

    applyTaskCollapsedState(card, task.id);
    card.querySelector(".task-title").textContent = task.title;
    card.querySelector(".task-description").textContent = task.description || t("no_description_provided");
    syncTaskCardImages(card, task);
    syncTaskCardAttachments(card, task);
    syncTaskCardMaterials(card, task);

    const priorityBadge = card.querySelector(".priority-badge");
    priorityBadge.className = `priority-badge priority-${formatPriority(task.priority)}`;
    priorityBadge.textContent = formatPriority(task.priority);

    const scopeBadge = card.querySelector(".task-scope-badge");
    const permissionBadge = card.querySelector(".task-permission-badge");
    if (scopeBadge) {
        scopeBadge.textContent = t("global_badge");
        scopeBadge.classList.toggle("hidden", !task.is_global);
    }
    if (permissionBadge) {
        permissionBadge.textContent = getTaskPermissionBadgeText(task);
        permissionBadge.classList.toggle("hidden", !task.is_global);
    }
    syncTaskPinState(card, task);

    card.querySelector(".members-label").innerHTML = `${escapeHtml(t("users_label"))} ${renderUserList(task.member_details || task.members)}`;
    if (task.is_global) {
        card.querySelector(".members-label").insertAdjacentHTML("beforeend", ` <span class="task-global-visibility">${escapeHtml(t("global_visible_label"))}</span>`);
    }
    card.querySelector(".deadline-label").textContent = `Deadline: ${formatDateTime(task.deadline)}`;

    const countdownLabel = card.querySelector(".countdown-label");
    countdownLabel.textContent = getCountdownText(task.deadline);
    countdownLabel.className = `countdown-label ${isOverdue(task.deadline) ? "overdue" : isDueSoon(task.deadline) ? "soon" : ""}`;

    const editTaskBtn = card.querySelector(".edit-task-btn");
    if (editTaskBtn) {
        editTaskBtn.textContent = t("edit_task");
    }

    updateProgressBarSmooth(card, task.progress);
    updateTaskCompletionReadyState(card, task);
    const attachmentsHeading = card.querySelector(".attachment-block .subtask-head h4");
    if (attachmentsHeading) {
        attachmentsHeading.textContent = t("attachments");
    }
    const chatHeading = card.querySelector(".chat-block .subtask-head h4");
    if (chatHeading) {
        chatHeading.textContent = t("task_chat");
    }
    syncTaskChatPinState(card, task);
    syncTaskInteractionPermissions(card, task);
}

function renderTaskSubtasksInPlace(card, task) {
    const subtaskList = card.querySelector(".subtask-list");
    if (!subtaskList) {
        return;
    }

    subtaskList.innerHTML = "";
    if (!task.subtasks.length) {
        subtaskList.innerHTML = `<li class="empty-state">${escapeHtml(t("no_subtasks_yet"))}</li>`;
        return;
    }

    task.subtasks.forEach((subtask) => {
        subtaskList.appendChild(createSubtaskItem(subtask, task.id));
    });
}

function applyTaskUpdateInPlace(task) {
    const index = tasksCache.findIndex((t) => t.id === task.id);
    if (index >= 0) {
        tasksCache[index] = task;
    } else {
        tasksCache.unshift(task);
    }

    const card = taskList.querySelector(`[data-task-id="${task.id}"]`);
    if (!card) {
        upsertTaskCard(task, false);
        return;
    }

    syncTaskCardMeta(card, task);
    renderTaskSubtasksInPlace(card, task);

    updateAllSecondaryViews();
    applySearchFilter();
}

async function saveSubtaskOrder(taskId) {
    const taskCard = taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (!taskCard) {
        return;
    }

    const ids = [...taskCard.querySelectorAll(".subtask-item")]
        .map((item) => Number(item.dataset.subtaskId))
        .filter(Boolean);

    if (!ids.length) {
        return;
    }

    try {
        const updatedTask = await fetchJSON(`/api/tasks/${taskId}/subtasks/reorder`, {
            method: "PATCH",
            body: JSON.stringify({ order: ids }),
        });
        applyTaskUpdateInPlace(updatedTask);
    } catch (error) {
        alert(error.message);
    }
}

function upsertTaskCard(task, animate = false) {
    const index = tasksCache.findIndex((t) => t.id === task.id);
    if (index >= 0) {
        applyTaskUpdateInPlace(task);
        return;
    }
    tasksCache.unshift(task);

    const existing = taskList.querySelector(`[data-task-id="${task.id}"]`);
    const newCard = createTaskCard(task, animate);

    if (existing) {
        existing.replaceWith(newCard);
    } else {
        const emptyState = taskList.querySelector(".empty-state");
        if (emptyState) {
            taskList.innerHTML = "";
        }
        taskList.prepend(newCard);
    }

    updateAllSecondaryViews();
    initDatePickers();
    applySearchFilter();
    decorateReadableBlocks(taskList);
}

function updateAllSecondaryViews() {
    updateTaskCount();
    updateDashboard();
    renderOverview();
    renderActivityFeed();
    renderCompletedTasks();
    renderUpdateLog();
    renderAdminSummary();
    renderAdminUsers();
    renderAnalytics();
    renderUserProfilePage();
    renderPinnedChatWindow();
    renderPrivateChatList();
    renderPrivateChatPanel();
    applySearchFilter();
    decorateReadableBlocks();
}

function buildProfileUpdatePayload(includePassword = false) {
    const payload = {
        username: document.getElementById("profileUsername").value.trim(),
        contact: document.getElementById("profileContact").value.trim(),
        profile_image_data: pendingProfileImageData,
    };

    if (includePassword) {
        payload.new_password = document.getElementById("profileNewPassword").value;
        payload.confirm_password = document.getElementById("profileConfirmPassword").value;
    }

    return payload;
}

async function loadTasks() {
    try {
        const tasks = await fetchJSON("/api/tasks");
        tasksCache = tasks;

        taskList.innerHTML = "";
        if (!tasks.length) {
            renderEmptyTasks();
        } else {
            tasks.forEach((task) => {
                taskList.appendChild(createTaskCard(task, false));
            });
        }

        populateTaskFilterUsers();
        updateAllSecondaryViews();
        initDatePickers();
        applySearchFilter();
        decorateReadableBlocks(taskList);
    } catch (error) {
        taskList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

async function loadActivityFeed() {
    try {
        activityCache = await fetchJSON("/api/activity");
        renderActivityFeed();
    } catch (error) {
        if (activityFeed) {
            activityFeed.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function loadUpdateLog() {
    try {
        updateLogCache = await fetchJSON("/api/updates");
        renderUpdateLog();
    } catch (error) {
        if (updateLogList) {
            updateLogList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function loadCurrentUser() {
    const previousUserId = currentUser?.id ?? null;
    const result = await fetchJSON("/api/auth/me", { cache: "no-store" });
    currentUser = result.user;
    lastMentionAlertIds = new Set();

    if (currentUser) {
        showApp();
        updateWelcome();
        await hydrateAppAfterAuth();
        initSocketConnection();
    } else {
        resetClientAuthState({ clearUserStorage: false, userId: previousUserId });
        showAuth();
        switchAuthTab("login");
    }
}

async function hydrateAppAfterAuth() {
    const startupTasks = [
        loadAssignableUsers,
        loadTaskTemplates,
        loadTasks,
        loadCompletedTasks,
        loadPrivateChats,
        loadActivityFeed,
        loadUpdateLog,
        loadAdminUsers,
        loadAnalytics,
    ];

    const results = await Promise.allSettled(startupTasks.map((task) => task()));
    const firstFailure = results.find((result) => result.status === "rejected");
    if (firstFailure?.reason) {
        console.error("[App bootstrap] post-login load failed:", firstFailure.reason);
    }
}

async function requestNotificationsIfNeeded() {
    if (!toggleNotifications.checked || !("Notification" in window)) {
        return;
    }

    if (Notification.permission === "default") {
        try {
            await Notification.requestPermission();
        } catch {
            return;
        }
    }
}

function checkDeadlineNotifications() {
    if (!toggleNotifications.checked || !("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    const notified = JSON.parse(localStorage.getItem("tm_notified") || "[]");
    const nextNotified = new Set(notified);
    const thresholdLabel = formatThresholdLabel(getUpcomingThresholdHours());

    tasksCache.forEach((task) => {
        const taskKey = `task-${task.id}-${task.deadline}`;
        if (isDueSoon(task.deadline) && !nextNotified.has(taskKey)) {
            new Notification(t("notification_task_deadline_soon"), {
                body: `${task.title} is due within ${thresholdLabel}.`,
            });
            nextNotified.add(taskKey);
        }

        task.subtasks.forEach((subtask) => {
            const subtaskKey = `subtask-${subtask.id}-${subtask.deadline}`;
            if (isDueSoon(subtask.deadline) && !nextNotified.has(subtaskKey)) {
                new Notification(t("notification_subtask_deadline_soon"), {
                    body: `${subtask.title} is due within ${thresholdLabel}.`,
                });
                nextNotified.add(subtaskKey);
            }
        });
    });

    localStorage.setItem("tm_notified", JSON.stringify([...nextNotified]));
}

function startNotificationLoop() {
    if (notificationTimer) {
        clearInterval(notificationTimer);
    }
    notificationTimer = setInterval(checkDeadlineNotifications, 60 * 1000);
    checkDeadlineNotifications();
}

