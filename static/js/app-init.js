const konamiCode = [
    "arrowup",
    "arrowup",
    "arrowdown",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "arrowleft",
    "arrowright",
    "b",
    "a",
];
let konamiIndex = 0;

function getRandomEffect(effects, lastUsed = null) {
    if (!effects.length) {
        return null;
    }

    if (effects.length === 1) {
        return effects[0];
    }

    let next;
    do {
        next = effects[Math.floor(Math.random() * effects.length)];
    } while (next === lastUsed);

    return next;
}

function activateEasterEgg() {
    const visualEffects = [
        konamiCat,
        konamiConfetti,
        konamiColorShift,
        konamiFunnyPopup
    ];
    const motionEffects = [
        konamiChaosRun,
        konamiScreenShake
    ];

    const nextVisualEffect = getRandomEffect(visualEffects, lastVisualEffect);
    const nextMotionEffect = getRandomEffect(motionEffects, lastMotionEffect);

    lastVisualEffect = nextVisualEffect;
    lastMotionEffect = nextMotionEffect;
    lastEffect = `${nextVisualEffect?.name || "visual"}:${nextMotionEffect?.name || "motion"}`;

    runKonamiEffect(nextVisualEffect, konamiFunnyPopup);
    runKonamiEffect(nextMotionEffect, konamiScreenShake);
}

function runKonamiEffect(effect, fallbackEffect) {
    try {
        if (typeof effect !== "function") {
            throw new Error("Effect is not callable.");
        }
        effect();
    } catch (error) {
        console.error("[Konami] Effect failed:", effect?.name || "unknown", error);
        try {
            fallbackEffect?.();
        } catch (fallbackError) {
            console.error("[Konami] Fallback effect failed:", fallbackError);
        }
    }
}

function konamiCat() {
    const gifs = [
        "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
        "https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif",
        "https://media.giphy.com/media/13borq7Zo2kulO/giphy.gif"
    ];

    let nextGif;
    do {
        nextGif = gifs[Math.floor(Math.random() * gifs.length)];
    } while (gifs.length > 1 && nextGif === lastCatGif);
    lastCatGif = nextGif;

    const cat = document.createElement("img");
    cat.src = nextGif;
    cat.className = "konami-cat";
    cat.style.top = `${18 + Math.random() * 52}%`;
    cat.style.left = `${18 + Math.random() * 58}%`;
    cat.alt = "Konami cat";

    document.body.appendChild(cat);

    setTimeout(() => {
        cat.classList.add("fade-out");
        setTimeout(() => cat.remove(), 800);
    }, 2600);
}

function konamiChaosRun() {
    if (typeof konamiChaosCleanup === "function") {
        konamiChaosCleanup();
    }

    const items = document.querySelectorAll(".task-card, button");
    if (!items.length) {
        throw new Error("No UI items found for chaos run.");
    }

    function move(e) {
        items.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const dx = rect.x - e.clientX;
            const dy = rect.y - e.clientY;

            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 120) {
                el.style.transform = `translate(${dx * 0.28}px, ${dy * 0.28}px)`;
            } else {
                el.style.transform = "";
            }
        });
    }

    document.addEventListener("mousemove", move);

    konamiChaosCleanup = () => {
        document.removeEventListener("mousemove", move);
        items.forEach((el) => {
            el.style.transform = "";
        });
        konamiChaosCleanup = null;
    };

    setTimeout(() => {
        konamiChaosCleanup?.();
    }, 4000);
}

function konamiFunnyPopup() {
    const sounds = [
        new Audio("https://www.myinstants.com/media/sounds/vine-boom.mp3"),
        new Audio("https://www.myinstants.com/media/sounds/bruh.mp3")
    ];

    if (toggleSounds?.checked) {
        sounds[Math.floor(Math.random() * sounds.length)].play().catch(() => {});
    }

    const msg = document.createElement("div");
    msg.className = "konami-message";
    msg.textContent = [
        "Something is wrong.",
        "The task goblin arrives.",
        "Productivity has been compromised.",
        "You found the cursed shortcut."
    ][Math.floor(Math.random() * 4)];

    document.body.appendChild(msg);

    setTimeout(() => {
        msg.classList.add("fade-out");
        setTimeout(() => msg.remove(), 800);
    }, 2600);
}

function konamiScreenShake() {
    document.body.classList.add("shake");
    setTimeout(() => document.body.classList.remove("shake"), 2200);
}

function konamiColorShift() {
    document.body.classList.add("konami-mode");
    setTimeout(() => document.body.classList.remove("konami-mode"), 3800);
}

function konamiConfetti() {
    for (let i = 0; i < 120; i++) {
        const c = document.createElement("div");
        c.className = "confetti";

        const x = Math.random() * window.innerWidth;
        c.style.left = x + "px";

        c.style.background = `hsl(${Math.random() * 360}, 80%, 60%)`;

        const drift = Math.random() * 140 - 70;
        c.style.setProperty("--drift", drift + "px");

        const duration = Math.random() * 1.8 + 2.2;
        c.style.animationDuration = duration + "s";
        c.style.animationDelay = Math.random() * 0.25 + "s";
        c.style.opacity = String(Math.random() * 0.35 + 0.65);

        const size = Math.random() * 6 + 6;
        c.style.width = size + "px";
        c.style.height = size * 1.6 + "px";

        const rotationStart = Math.random() * 180;
        const rotationEnd = rotationStart + (Math.random() * 540 + 360);
        c.style.setProperty("--rotate-start", rotationStart + "deg");
        c.style.setProperty("--rotate-end", rotationEnd + "deg");

        c.addEventListener("animationend", () => {
            c.remove();
        }, { once: true });

        document.body.appendChild(c);
    }
}

function konamiMessage() {
    konamiFunnyPopup();
}

function konamiLegacyMessage() {
    const messages = [
        "You found the secret 😳",
        "Developer mode activated 🧠",
        "You have too much free time",
        "Productivity +100%",
        "Certified gamer moment 🎮",
        "Task manager has feelings now"
    ];

    const msg = document.createElement("div");
    msg.className = "konami-message";
    msg.textContent = messages[Math.floor(Math.random() * messages.length)];

    document.body.appendChild(msg);

    setTimeout(() => {
        msg.classList.add("fade-out");
        setTimeout(() => msg.remove(), 800);
    }, 1500);
}

document.addEventListener("keydown", (event) => {
    const key = String(event.key).toLowerCase();
    const expectedKey = konamiCode[konamiIndex];
    const konamiDebug = localStorage.getItem("tm_konami_debug") === "true";

    if (konamiDebug) {
        console.debug("[Konami] keydown:", key, "expected:", expectedKey, "index:", konamiIndex);
    }

    if (key === expectedKey) {
        konamiIndex += 1;
        if (konamiDebug) {
            console.debug("[Konami] matched step", konamiIndex, "of", konamiCode.length);
        }

        if (konamiIndex === konamiCode.length) {
            if (konamiDebug) {
                console.debug("[Konami] sequence complete, triggering easter egg");
            }
            activateEasterEgg();
            konamiIndex = 0;
        }
        return;
    }

    konamiIndex = key === konamiCode[0] ? 1 : 0;
    if (konamiDebug) {
        console.debug("[Konami] reset sequence, new index:", konamiIndex);
    }
});

showLoginBtn.addEventListener("click", () => switchAuthTab("login"));
showRegisterBtn.addEventListener("click", () => switchAuthTab("register"));

googleLoginBtn.addEventListener("click", () => {
    alert(t("oauth_google_not_configured"));
});

microsoftLoginBtn.addEventListener("click", () => {
    alert(t("oauth_microsoft_not_configured"));
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("loginUsername").value.trim(),
                password: document.getElementById("loginPassword").value,
            }),
        });

        currentUser = result.user;
        loginForm.reset();
        showApp();
        updateWelcome();
        await hydrateAppAfterAuth();
        initSocketConnection();
    } catch (error) {
        alert(error.message);
    }
});

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("registerUsername").value.trim(),
                contact: document.getElementById("registerContact").value.trim(),
                password: document.getElementById("registerPassword").value,
                confirm_password: document.getElementById("registerConfirmPassword").value,
            }),
        });

        currentUser = result.user;
        registerForm.reset();
        showApp();
        updateWelcome();
        await hydrateAppAfterAuth();
        initSocketConnection();
    } catch (error) {
        alert(error.message);
    }
});

forgotPasswordBtn.addEventListener("click", () => {
    showForgotPasswordRequest();
});

backToLoginBtn.addEventListener("click", () => {
    switchAuthTab("login");
});

requestAnotherTokenBtn.addEventListener("click", () => {
    showForgotPasswordRequest();
});

forgotPasswordRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/auth/request-reset", {
            method: "POST",
            body: JSON.stringify({
                contact: document.getElementById("resetContact").value.trim(),
            }),
        });

        showForgotPasswordReset(result);
    } catch (error) {
        alert(error.message);
    }
});

forgotPasswordResetForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/auth/reset-password", {
            method: "POST",
            body: JSON.stringify({
                contact: document.getElementById("resetContactConfirm").value.trim(),
                token: document.getElementById("resetToken").value.trim(),
                password: document.getElementById("resetPassword").value,
                confirm_password: document.getElementById("resetConfirmPassword").value,
            }),
        });

        alert(result.message);
        forgotPasswordRequestForm.reset();
        forgotPasswordResetForm.reset();
        switchAuthTab("login");
    } catch (error) {
        alert(error.message);
    }
});

logoutBtn.addEventListener("click", async () => {
    try {
        await fetchJSON("/api/auth/logout", { method: "POST" });
        resetClientAuthState({ clearUserStorage: true });
        showAuth();
        switchAuthTab("login");
        document.getElementById("loginUsername")?.focus();
    } catch (error) {
        alert(error.message);
    }
});

if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", () => {
        if (currentUser?.is_headadmin) {
            alert(t("delete_account_root_locked"));
            return;
        }
        openDeleteAccountModal();
    });
}

settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
});

closeSettingsBtn.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
});

closeDeleteAccountModalBtn?.addEventListener("click", closeDeleteAccountModal);
cancelDeleteAccountBtn?.addEventListener("click", closeDeleteAccountModal);

deleteAccountModal?.addEventListener("click", (event) => {
    if (event.target === deleteAccountModal) {
        closeDeleteAccountModal();
    }
});

taskCompletionModal?.addEventListener("click", (event) => {
    if (event.target === taskCompletionModal) {
        closeTaskCompletionModal();
    }
});

startPrivateChatModal?.addEventListener("click", (event) => {
    if (event.target === startPrivateChatModal) {
        closeStartPrivateChatModal();
    }
});

taskTemplateModal?.addEventListener("click", (event) => {
    if (event.target === taskTemplateModal) {
        closeTaskTemplateModal();
    }
});

confirmDeleteAccountBtn?.addEventListener("click", async () => {
    const password = deleteAccountPassword?.value || "";
    if (!password.trim()) {
        alert(t("delete_account_password_required"));
        deleteAccountPassword?.focus();
        return;
    }

    try {
        const result = await fetchJSON("/api/profile", {
            method: "DELETE",
            body: JSON.stringify({ current_password: password }),
        });

        closeDeleteAccountModal();
        resetClientAuthState({ clearUserStorage: true });
        showAuth();
        switchAuthTab("login");
        alert(result.message);
    } catch (error) {
        alert(error.message);
    }
});

closeTaskCompletionModalBtn?.addEventListener("click", closeTaskCompletionModal);
cancelTaskCompletionBtn?.addEventListener("click", closeTaskCompletionModal);
closeStartPrivateChatModalBtn?.addEventListener("click", closeStartPrivateChatModal);
closeTaskTemplateModalBtn?.addEventListener("click", closeTaskTemplateModal);
openTaskTemplateModalBtn?.addEventListener("click", openTaskTemplateModal);
newTaskTemplateBtn?.addEventListener("click", () => {
    resetTaskTemplateEditor();
    renderTaskTemplateList();
    taskTemplateNameInput?.focus();
});
taskTemplateSelect?.addEventListener("change", () => {
    selectedCreateTemplateId = taskTemplateSelect.value ? Number(taskTemplateSelect.value) : null;
    const template = getSelectedTaskTemplate();
    renderTaskTemplatePreview();
    if (template) {
        applyTaskTemplateToCreator(template);
    }
});
addTaskTemplateSubtaskBtn?.addEventListener("click", () => {
    const title = taskTemplateSubtaskInput?.value.trim() || "";
    if (!title) {
        taskTemplateSubtaskInput?.focus();
        return;
    }
    draftTaskTemplateSubtasks = [...draftTaskTemplateSubtasks, { title }];
    if (taskTemplateSubtaskInput) {
        taskTemplateSubtaskInput.value = "";
        taskTemplateSubtaskInput.focus();
    }
    renderTaskTemplateEditorSubtasks();
});
taskTemplateSubtaskInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        addTaskTemplateSubtaskBtn?.click();
    }
});
taskTemplateEditorForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
        name: taskTemplateNameInput?.value.trim() || "",
        description: taskTemplateDescriptionInput?.value.trim() || "",
        default_priority: taskTemplateDefaultPriority?.value || "",
        default_deadline_offset_hours: taskTemplateDeadlineOffsetInput?.value.trim() || "",
        subtasks: draftTaskTemplateSubtasks,
    };

    if (!payload.name) {
        taskTemplateNameInput?.focus();
        return;
    }

    try {
        const template = editingTaskTemplateId
            ? await fetchJSON(`/api/task-templates/${editingTaskTemplateId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            })
            : await fetchJSON("/api/task-templates", {
                method: "POST",
                body: JSON.stringify(payload),
            });

        const nextCache = taskTemplatesCache.filter((item) => item.id !== template.id);
        taskTemplatesCache = [template, ...nextCache].sort((left, right) => right.id - left.id);
        editingTaskTemplateId = template.id;
        fillTaskTemplateEditor(template);
        populateTaskTemplateSelect();
        renderTaskTemplateList();
    } catch (error) {
        alert(error.message);
    }
});
deleteTaskTemplateBtn?.addEventListener("click", async () => {
    if (!editingTaskTemplateId) {
        return;
    }
    try {
        await fetchJSON(`/api/task-templates/${editingTaskTemplateId}`, { method: "DELETE" });
        taskTemplatesCache = taskTemplatesCache.filter((template) => template.id !== editingTaskTemplateId);
        if (selectedCreateTemplateId === editingTaskTemplateId) {
            resetTaskTemplateSelection();
        }
        resetTaskTemplateEditor();
        populateTaskTemplateSelect();
        renderTaskTemplateList();
    } catch (error) {
        alert(error.message);
    }
});
togglePinnedChatBtn?.addEventListener("click", () => {
    const pinnedState = getPinnedChatState();
    if (!pinnedState) {
        return;
    }
    updatePinnedChatState({ minimized: !pinnedState.minimized });
    renderPinnedChatWindow();
});
closePinnedChatBtn?.addEventListener("click", () => {
    clearPinnedChat();
    renderPinnedChatWindow();
});
pinnedChatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const pinnedState = getPinnedChatState();
    const content = pinnedChatInput?.value.trim() || "";
    if (!pinnedState?.taskId || !content) {
        return;
    }

    try {
        await fetchJSON(`/api/tasks/${pinnedState.taskId}/messages`, {
            method: "POST",
            body: JSON.stringify({ content }),
        });
        pinnedChatForm.reset();
    } catch (error) {
        alert(error.message);
    }
});
privateChatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = privateChatInput?.value.trim() || "";
    if (!activePrivateChatId || !content) {
        return;
    }

    try {
        await fetchJSON(`/api/private-chats/${activePrivateChatId}/messages`, {
            method: "POST",
            body: JSON.stringify({ content }),
        });
        privateChatForm.reset();
    } catch (error) {
        alert(error.message);
    }
});
confirmTaskCompletionBtn?.addEventListener("click", confirmPendingTaskCompletion);

languageSelect?.addEventListener("change", () => {
    setLanguage(languageSelect.value);
});

analyticsPeriodSelect?.addEventListener("change", () => {
    loadAnalytics();
});

analyticsChartTypeSelect?.addEventListener("change", () => {
    renderAnalytics();
});

clearPinnedTaskBtn?.addEventListener("click", () => {
    clearPinnedTask({ silent: true });
    updateAllSecondaryViews();
});

toggleTaskCreatorBtn?.addEventListener("click", () => {
    const nextCollapsed = !taskForm?.classList.contains("collapsed");
    setTaskCreatorCollapsed(nextCollapsed);
    if (!nextCollapsed) {
        document.getElementById("taskTitle")?.focus();
    }
});

toggleAdvancedTaskSettingsBtn?.addEventListener("click", () => {
    const open = advancedTaskSettings?.classList.contains("hidden");
    setAdvancedTaskSettingsOpen(open);
});

userDetailPeriodSelect?.addEventListener("change", () => {
    const username = userProfileCache?.user?.username;
    if (username) {
        loadUserProfile(username, { keepPeriod: true });
    }
});

userDetailBackBtn?.addEventListener("click", () => {
    switchPage(userProfileReturnPage || "dashboardPage");
});
userDetailMessageBtn?.addEventListener("click", async () => {
    const username = userProfileCache?.user?.username || "";
    await openDirectChatWithUser(username);
});
startPrivateChatBtn?.addEventListener("click", openStartPrivateChatModal);
privateChatUserSearch?.addEventListener("input", renderPrivateChatUserPicker);

completedTaskUserSearch?.addEventListener("input", () => {
    loadCompletedTasks();
});

clearCompletedTaskSearchBtn?.addEventListener("click", () => {
    if (completedTaskUserSearch) {
        completedTaskUserSearch.value = "";
    }
    loadCompletedTasks();
});

document.addEventListener("click", (event) => {
    const completedUserTrigger = event.target.closest("[data-completed-user]");
    if (completedUserTrigger) {
        event.preventDefault();
        fillCompletedTaskUserSearch(completedUserTrigger.dataset.completedUser || "");
        loadCompletedTasks();
        return;
    }

    const trigger = event.target.closest("[data-user-profile]");
    if (!trigger) {
        return;
    }

    event.preventDefault();
    openUserProfile(trigger.dataset.userProfile || "");
});

languagePickerBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !languagePickerMenu?.classList.contains("hidden");
    if (isOpen) {
        closeLanguagePicker();
    } else {
        openLanguagePicker();
    }
});

languagePickerMenu?.addEventListener("click", (event) => {
    const button = event.target.closest(".language-option");
    if (!button) {
        return;
    }
    const code = button.dataset.languageCode;
    if (!code) {
        return;
    }
    setLanguage(code);
    closeLanguagePicker();
});

themeSelect.addEventListener("change", persistSettings);
upcomingThreshold.addEventListener("change", () => {
    const selected = upcomingThreshold.value;
    localStorage.setItem("tm_upcoming_threshold", selected);

    if (selected !== "custom") {
        localStorage.setItem("tm_upcoming_threshold_custom", selected);
    }

    persistSettings();
});
customThresholdSlider.addEventListener("input", () => {
    const hours = String(Number(customThresholdSlider.value));
    localStorage.setItem("tm_upcoming_threshold", "custom");
    localStorage.setItem("tm_upcoming_threshold_custom", hours);
    updateThresholdControls();
    updateAllSecondaryViews();
    checkDeadlineNotifications();
});
toggleAnimations.addEventListener("change", persistSettings);
toggleNotifications.addEventListener("change", async () => {
    persistSettings();
    await requestNotificationsIfNeeded();
    checkDeadlineNotifications();
});
compactMode.addEventListener("change", persistSettings);
accessibilityMode?.addEventListener("change", persistSettings);
toggleSounds?.addEventListener("change", persistSettings);

navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        switchPage(btn.dataset.page);
    });
});

profileImageInput.addEventListener("change", () => {
    const [file] = profileImageInput.files || [];
    if (!file) {
        pendingProfileImageData = "";
        renderProfileSummary();
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        pendingProfileImageData = typeof reader.result === "string" ? reader.result : "";
        renderProfileSummary();
    };
    reader.readAsDataURL(file);
});

profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(buildProfileUpdatePayload(false)),
        });
        currentUser = result.user;
        pendingProfileImageData = "";
        profileImageInput.value = "";
        updateWelcome();
        if (userProfileCache?.user?.id === currentUser.id) {
            await loadUserProfile(currentUser.username, { keepPeriod: true });
        }
        alert(t("profile_saved"));
    } catch (error) {
        alert(error.message);
    }
});

securityForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const result = await fetchJSON("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(buildProfileUpdatePayload(true)),
        });
        currentUser = result.user;
        pendingProfileImageData = "";
        document.getElementById("profileNewPassword").value = "";
        document.getElementById("profileConfirmPassword").value = "";
        updateWelcome();
        if (userProfileCache?.user?.id === currentUser.id) {
            await loadUserProfile(currentUser.username, { keepPeriod: true });
        }
        alert(t("password_saved"));
    } catch (error) {
        alert(error.message);
    }
});

if (openAssignUsersBtn) {
    openAssignUsersBtn.addEventListener("click", async () => {
        if (!assignableUsers.length) {
            await loadAssignableUsers();
        }
        openAssignUsersModal();
    });
}

if (closeAssignUsersBtn) {
    closeAssignUsersBtn.addEventListener("click", closeAssignUsersModal);
}

if (applyAssignUsersBtn) {
    applyAssignUsersBtn.addEventListener("click", closeAssignUsersModal);
}

if (assignUserSearch) {
    assignUserSearch.addEventListener("input", () => {
        renderAssignableUserList(assignUserSearch.value);
    });
}

if (assignUsersModal) {
    assignUsersModal.addEventListener("click", (event) => {
        if (event.target === assignUsersModal) {
            closeAssignUsersModal();
        }
    });
}

taskMainImageInput?.addEventListener("change", async () => {
    const [file] = taskMainImageInput.files || [];
    if (!file) {
        clearTaskCreateImageState("main");
        return;
    }
    try {
        await handleTaskImageSelection(file, "main", "create");
    } catch (error) {
        clearTaskCreateImageState("main");
        alert(error.message);
    }
});

taskBannerImageInput?.addEventListener("change", async () => {
    const [file] = taskBannerImageInput.files || [];
    if (!file) {
        clearTaskCreateImageState("banner");
        return;
    }
    try {
        await handleTaskImageSelection(file, "banner", "create");
    } catch (error) {
        clearTaskCreateImageState("banner");
        alert(error.message);
    }
});

taskAttachmentsInput?.addEventListener("change", async () => {
    try {
        await handleTaskAttachmentSelection(taskAttachmentsInput.files, "create");
    } catch (error) {
        if (taskAttachmentsInput) {
            taskAttachmentsInput.value = "";
        }
        alert(error.message);
    }
});

clearTaskMainImageBtn?.addEventListener("click", () => clearTaskCreateImageState("main"));
clearTaskBannerImageBtn?.addEventListener("click", () => clearTaskCreateImageState("banner"));
taskIsGlobal?.addEventListener("change", () => updateGlobalTaskControls("create"));
editTaskIsGlobal?.addEventListener("change", () => updateGlobalTaskControls("edit"));
addTaskMaterialBtn?.addEventListener("click", () => addMaterialRow("create"));
addEditTaskMaterialBtn?.addEventListener("click", () => addMaterialRow("edit"));

editTaskMainImageInput?.addEventListener("change", async () => {
    const [file] = editTaskMainImageInput.files || [];
    if (!file) {
        return;
    }
    try {
        await handleTaskImageSelection(file, "main", "edit");
    } catch (error) {
        editTaskMainImageInput.value = "";
        alert(error.message);
    }
});

editTaskBannerImageInput?.addEventListener("change", async () => {
    const [file] = editTaskBannerImageInput.files || [];
    if (!file) {
        return;
    }
    try {
        await handleTaskImageSelection(file, "banner", "edit");
    } catch (error) {
        editTaskBannerImageInput.value = "";
        alert(error.message);
    }
});

editTaskAttachmentsInput?.addEventListener("change", async () => {
    try {
        await handleTaskAttachmentSelection(editTaskAttachmentsInput.files, "edit");
    } catch (error) {
        if (editTaskAttachmentsInput) {
            editTaskAttachmentsInput.value = "";
        }
        alert(error.message);
    }
});

clearEditTaskMainImageBtn?.addEventListener("click", () => {
    editTaskMainImageData = "";
    editTaskRemoveMainImage = true;
    if (editTaskMainImageInput) {
        editTaskMainImageInput.value = "";
    }
    setImagePreview(editTaskMainImagePreview, clearEditTaskMainImageBtn, "", "task_image_preview");
});

clearEditTaskBannerImageBtn?.addEventListener("click", () => {
    editTaskBannerImageData = "";
    editTaskRemoveBannerImage = true;
    if (editTaskBannerImageInput) {
        editTaskBannerImageInput.value = "";
    }
    setImagePreview(editTaskBannerImagePreview, clearEditTaskBannerImageBtn, "", "task_banner_preview");
});

taskAttachmentsList?.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-pending-attachment-btn");
    if (!button) {
        return;
    }
    const index = Number(button.dataset.index);
    if (!Number.isFinite(index)) {
        return;
    }
    pendingTaskAttachments = pendingTaskAttachments.filter((_, itemIndex) => itemIndex !== index);
    renderPendingAttachmentList(taskAttachmentsList, pendingTaskAttachments, "create");
});

editTaskAttachmentsList?.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-pending-attachment-btn");
    if (!button) {
        return;
    }
    const index = Number(button.dataset.index);
    if (!Number.isFinite(index)) {
        return;
    }
    const [removed] = editTaskAttachments.splice(index, 1);
    if (removed?.existing && removed.id) {
        editTaskRemoveAttachmentIds = [...new Set([...editTaskRemoveAttachmentIds, Number(removed.id)])];
    }
    renderPendingAttachmentList(editTaskAttachmentsList, editTaskAttachments, "edit");
});

closeEditTaskModalBtn?.addEventListener("click", closeEditTaskModal);
cancelEditTaskBtn?.addEventListener("click", closeEditTaskModal);

editTaskModal?.addEventListener("click", (event) => {
    if (event.target === editTaskModal) {
        closeEditTaskModal();
    }
});

updateGlobalTaskControls("create");
updateGlobalTaskControls("edit");
setAdvancedTaskSettingsOpen(false);
setTaskCreatorCollapsed(true);
renderTaskMaterialConfigList("create");
renderTaskMaterialConfigList("edit");

taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = taskForm.elements.title.value.trim();
    const description = taskForm.elements.description.value.trim();
    const deadline = taskForm.elements.deadline.value.trim();
    const priority = taskForm.elements.priority.value;
    const membersRaw = taskMembersInput.value.trim();

    const members = membersRaw
        ? membersRaw.split(",").map((item) => item.trim()).filter(Boolean)
        : [];
    const selectedTemplate = getSelectedTaskTemplate();

    if (!title) {
        return;
    }

    try {
        const task = await fetchJSON("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
                title,
                description,
                deadline,
                priority,
                members,
                is_global: Boolean(taskIsGlobal?.checked),
                global_edit_mode: taskGlobalEditMode?.value || "members",
                main_image_data: pendingTaskMainImageData,
                banner_image_data: pendingTaskBannerImageData,
                attachments_data: pendingTaskAttachments,
                materials_data: collectMaterialPayload("create"),
                template_subtasks: selectedTemplate?.subtasks || [],
            }),
        });

        upsertTaskCard(task, true);
        taskComment(task.title);
        taskForm.reset();
        if (taskIsGlobal) taskIsGlobal.checked = false;
        if (taskGlobalEditMode) taskGlobalEditMode.value = "members";
        updateGlobalTaskControls("create");
        resetCreateTaskAdvancedState();
        resetTaskAssignmentSelection();
        setAdvancedTaskSettingsOpen(false);
        setTaskCreatorCollapsed(true);
        resetTaskTemplateSelection();
        closeAssignUsersModal();
        initDatePickers();
    } catch (error) {
        alert(error.message);
    }
});

editTaskForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!editingTaskId) {
        return;
    }

    try {
        const updatedTask = await fetchJSON(`/api/tasks/${editingTaskId}`, {
            method: "PATCH",
            body: JSON.stringify({
                title: editTaskTitle?.value.trim() || "",
                description: editTaskDescription?.value.trim() || "",
                deadline: editTaskDeadline?.value.trim() || "",
                priority: editTaskPriority?.value || "medium",
                is_global: Boolean(editTaskIsGlobal?.checked),
                global_edit_mode: editTaskGlobalEditMode?.value || "members",
                main_image_data: editTaskMainImageData,
                banner_image_data: editTaskBannerImageData,
                attachments_data: editTaskAttachments.filter((item) => !item.existing),
                materials_data: collectMaterialPayload("edit"),
                remove_attachment_ids: editTaskRemoveAttachmentIds,
                remove_main_image: editTaskRemoveMainImage,
                remove_banner_image: editTaskRemoveBannerImage,
            }),
        });

        applyTaskUpdateInPlace(updatedTask);
        closeEditTaskModal();
    } catch (error) {
        alert(error.message);
    }
});

function taskComment(title) {
    const comments = [
        "Another one? alright...",
        "I guess that's important.",
        "You really need to do that?",
        "Fine. Added.",
        "Sure. Why not."
    ];

    const msg = document.createElement("div");
    msg.className = "konami-message";
    msg.textContent = comments[Math.floor(Math.random()*comments.length)];

    document.body.appendChild(msg);

    setTimeout(() => {
        msg.classList.add("fade-out");
        setTimeout(() => msg.remove(), 800);
    }, 1500);
}

[
    searchInput,
    taskFilterPriority,
    taskFilterDeadlineDate,
    taskFilterAssignedUser,
    taskFilterGlobalMode,
    taskFilterCompletion,
    taskSortBy,
    taskFilterInvert,
    taskSortReverse,
].forEach((element) => {
    element?.addEventListener("input", applySearchFilter);
    element?.addEventListener("change", applySearchFilter);
});

clearTaskFiltersBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (taskFilterPriority) taskFilterPriority.value = "all";
    if (taskFilterDeadlineDate) taskFilterDeadlineDate.value = "";
    if (taskFilterAssignedUser) taskFilterAssignedUser.value = "all";
    if (taskFilterGlobalMode) taskFilterGlobalMode.value = "all";
    if (taskFilterCompletion) taskFilterCompletion.value = "all";
    if (taskSortBy) taskSortBy.value = "created_desc";
    if (taskFilterInvert) taskFilterInvert.checked = false;
    if (taskSortReverse) taskSortReverse.checked = false;
    applySearchFilter();
});

document.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
        settingsPanel.classList.add("hidden");
        closeAssignUsersModal();
        closeDeleteAccountModal();
        closeEditTaskModal();
        closeTaskTemplateModal();
        closeLanguagePicker();
    }

    if (event.altKey && event.key.toLowerCase() === "r") {
        const selection = window.getSelection?.().toString().trim() || "";
        if (selection) {
            event.preventDefault();
            speakText(selection);
        }
    }

    if (event.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        switchPage("tasksPage");
        setTaskCreatorCollapsed(false);
        document.getElementById("taskTitle").focus();
    }

    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        switchPage("tasksPage");
        searchInput.focus();
    }
});

document.addEventListener("click", (event) => {
    const button = event.target.closest(".read-aloud-btn");
    if (!button) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    const block = button.closest(".readable-block-wrap")?.querySelector(".readable-block");
    speakText(getReadableTextFromBlock(block));
});

document.addEventListener("click", (event) => {
    if (!languagePickerBtn || !languagePickerMenu) {
        return;
    }
    if (languagePickerBtn.contains(event.target) || languagePickerMenu.contains(event.target)) {
        return;
    }
    closeLanguagePicker();
});

setInterval(() => {
    document.querySelectorAll(".task-card").forEach((card) => {
        const taskId = Number(card.dataset.taskId);
        const task = tasksCache.find((t) => t.id === taskId);
        if (!task) {
            return;
        }

        const countdownLabel = card.querySelector(".countdown-label");
        if (countdownLabel) {
            countdownLabel.textContent = getCountdownText(task.deadline);
            countdownLabel.className = `countdown-label ${isOverdue(task.deadline) ? "overdue" : isDueSoon(task.deadline) ? "soon" : ""}`;
        }
    });
}, 60000);

if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        resolveSpeechVoice();
    };
}

updateProfileVerificationUI();
applyLanguage();
syncFeaturedTaskActionState();
renderSelectedTaskMembers();
renderAdminSummary();
loadCurrentUser();
requestNotificationsIfNeeded();
startNotificationLoop();
window.addEventListener("load", initDatePickers);
